/* ===== part: 13-talent.js ===== */
Game.prototype._addCp = function (p, amount) {
  p.cp += amount * (p.isHuman ? 1 : BAL.npcCpMult);
  while (p.level - 1 < BAL.cpLevels.length && p.cp >= BAL.cpLevels[p.level - 1]) {
    p.level++;
    p.talentOffers = this._rollTalents(p);
    this._log('good', '★ ' + p.name + ' 升到 Lv' + p.level + '，可以选一个天赋', p.id);
  }
};

Game.prototype._rollTalents = function (p) {
  const owned = new Set(p.talents);
  const pool = TALENTS.filter(t => !owned.has(t.id));
  if (!pool.length) return null;
  const treePref = { grow: 'grow', trade: 'market', intel: 'market', shell: 'fight' }[p.corp];
  const r = this.rng.talent.shuffle(pool);
  const out = [];
  // 保证至少 1 张来自本公司主色谱系
  const pref = r.find(t => t.tree === treePref);
  if (pref) out.push(pref.id);
  for (const t of r) {
    if (out.length >= 3) break;
    if (!out.includes(t.id)) out.push(t.id);
  }
  return out;
};

Game.prototype._a_talent = function (p, d) {
  if (!p.talentOffers) return { ok: false, msg: '现在没有可选天赋' };
  if (!p.talentOffers.includes(d.id)) return { ok: false, msg: '这张卡不在你的选择里' };
  const t = TALENTS.find(x => x.id === d.id);
  p.talents.push(t.id);
  t.apply(p);
  p.talentOffers = null;
  this._log('good', '★ ' + p.name + ' 点亮天赋【' + t.name + '】：' + t.desc, p.id);
  return { ok: true, msg: '天赋【' + t.name + '】已生效' };
};
Game.prototype._a_reroll = function (p) {
  if (p.freeReroll <= 0) return { ok: false, msg: '本局的重抽已经用掉了' };
  if (!p.talentOffers) return { ok: false, msg: '现在没有可选天赋' };
  p.freeReroll--;
  p.talentOffers = this._rollTalents(p);
  return { ok: true, msg: '换了一批' };
};

/* 建作坊：制造公司的产能来源。每间作坊同时只能跑一批。 */
Game.prototype._a_buildWorkshop = function (p) {
  const cost = p.workshops === 0 ? BAL.workshopCost : BAL.workshopCost2;
  if (p.cash < cost) return { ok: false, msg: '建一间作坊要 ' + money(cost) + ' G' };
  p.cash -= cost;
  p.workshops += 1;
  this._log('money', p.name + ' 建了第 ' + p.workshops + ' 间作坊（' + money(cost) + ' G）', p.id);
  return { ok: true, msg: '作坊建好了，现在有 ' + p.workshops + ' 条产线' };
};

/* 加工：吃原料，若干游戏小时后出成品。这是制造公司的全部意义。 */
Game.prototype._a_craft = function (p, d) {
  const pd = this.s.products[d.product];
  if (!pd) return { ok: false, msg: '没有这个配方' };
  if (p.workshops <= 0) return { ok: false, msg: '你还没有作坊，先建一间（' + BAL.workshopCost + ' G）' };
  if (p.craftJobs.length >= p.workshops) return { ok: false, msg: '产线占满了（' + p.craftJobs.length + '/' + p.workshops + '），等这批出货' };
  const have = p.storage[pd.from] || 0;
  if (have < pd.need) return { ok: false, msg: '原料不够：需要 ' + pd.need + ' ' + this.s.crops[pd.from].name + '，你有 ' + have };
  const room = this.storageMax(p) - this.storageUsed(p) + pd.need;   // 吃掉原料后腾出的位置
  if (room < pd.out) return { ok: false, msg: '仓库放不下成品，先腾点空间' };
  const corp = CORPS.find(c => c.id === p.corp) || CORPS[0];
  const fee = 20;
  if (p.cash < fee) return { ok: false, msg: '加工费要 ' + fee + ' G' };
  p.cash -= fee;
  // 扣原料（用移动平均法结转成本，方便算加工毛利）
  const book = p.avgCost[pd.from] || { q: have, c: this.s.crops[pd.from].price };
  const unitCost = book.c || this.s.crops[pd.from].price;
  p.storage[pd.from] = have - pd.need;
  if (p.storage[pd.from] <= 0) delete p.storage[pd.from];
  const hours = pd.hours * (corp.craftSpeed || 1) * p.mods.growMult;
  p.craftJobs.push({
    pid: pd.id, startedT: this.s.t, doneT: this.s.t + hours * 60,
    out: pd.out, costBasis: unitCost * pd.need,
  });
  this._log('trade', p.name + ' 开了一批【' + pd.name + '】(' + pd.need + ' ' + this.s.crops[pd.from].name +
    ' → ' + pd.out + ' ' + pd.name + '，' + hours.toFixed(1) + ' 游戏小时后出货)', p.id);
  return { ok: true, msg: '开产：' + hours.toFixed(1) + ' 游戏小时后出 ' + pd.out + ' 个' + pd.name };
};

/* 加工进度：出货 + 品牌成长 */
Game.prototype._craftTick = function (dt) {
  const s = this.s;
  for (const p of s.players) {
    if (!p.alive || !p.craftJobs.length) continue;
    const rest = [];
    for (const job of p.craftJobs) {
      if (s.t < job.doneT) { rest.push(job); continue; }
      const pd = s.products[job.pid];
      let out = job.out;
      // 品牌成长：出货越多品牌越硬（有天赋则更快）
      const corp = CORPS.find(c => c.id === p.corp) || CORPS[0];
      /* 品牌要慢慢积累。原来每件 +2，9 批就顶到 100（+30% 溢价），"需要时间积累"这条设计就没了。
         改成每件 +0.6：一局认真做 40 批大约到 48 分。 */
      p.brand = clamp(p.brand + out * 0.6 * (corp.brandGrowthMult || 1), 0, 100);
      // 出货同样受仓储上限约束（原来直接加，能把仓库顶到超额）
      const room2 = Math.max(0, this.storageMax(p) - this.storageUsed(p));
      const put = Math.min(out, room2);
      if (put < out) this._log('info', p.name + ' 的仓库放不下，' + (out - put) + ' 个' + pd.name + '损耗掉了', p.id);
      out = put;
      if (out > 0) p.storage[pd.id] = (p.storage[pd.id] || 0) + out;
      const val = out * this.valuePrice(pd.id);
      p.m.craftedValue += val;
      p.m.craftedUnits += out;
      p.m.harvestedValue += 0;             // 加工不算种地收成（不要让 D 分虚高）
      this._addCp(p, val * BAL.cpPerHarvestGold);
      this._log('good', p.name + ' 的【' + pd.name + '】出货 ×' + out + '（品牌 ' + Math.round(p.brand) + '）', p.id);
    }
    p.craftJobs = rest;
  }
};

/* 放贷（金融公司专属）：钱放出去生息，但对手倒了就是坏账 */
Game.prototype._a_lend = function (p, d) {
  const corp = CORPS.find(c => c.id === p.corp) || CORPS[0];
  if (!corp.canLend) return { ok: false, msg: '只有金融公司能做这门生意' };
  const target = this.s.players.find(x => x.id === d.pid && !x.isHuman && x.alive);
  if (!target) return { ok: false, msg: '找不到这个借款人' };
  const amount = Math.floor(d.amount || 0);
  if (amount <= 0) return { ok: false, msg: '借多少？' };
  if (p.cash < amount) return { ok: false, msg: '你手上没这么多现金' };
  /* 本金必须真的交到对方手上。原来只从自己账上扣、钱凭空消失，
     到期却从对手现金里强制划走本息 = "无风险 4%/天 + 抽干对手流动性"。 */
  p.cash -= amount;
  target.cash += amount;
  target.debt += amount;
  p.loansOut.push({ toPid: target.id, principal: amount, rateDay: 0.04, dueT: this.s.t + 2 * 1440 });
  p.m.lentTotal += amount;
  this._log('money', p.name + ' 放了 ' + money(amount) + ' G 给 ' + target.name + '（日息 4%，两天后到期）', p.id);
  return { ok: true, msg: '放出去了，两天后收回本息（对手倒下就是坏账）' };
};

Game.prototype._a_deposit = function (p, d) {
  const amt = Math.min(Math.floor(d.amount || 0), Math.floor(p.cash));
  if (amt <= 0) return { ok: false, msg: '没有可存的钱' };
  p.cash -= amt; p.deposit += amt;
  return { ok: true, msg: '存了 ' + money(amt) + ' G' };
};
Game.prototype._a_withdraw = function (p, d) {
  const amt = Math.min(Math.floor(d.amount || 0), Math.floor(p.deposit));
  if (amt <= 0) return { ok: false, msg: '没有可取的存款' };
  p.deposit -= amt; p.cash += amt;
  return { ok: true, msg: '取了 ' + money(amt) + ' G' };
};

/* ---- 3.6 NPC AI --------------------------------------------------------*/
