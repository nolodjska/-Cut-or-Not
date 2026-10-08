/* ===== part: 14-npc.js ===== */
Game.prototype._npcTick = function (dt) {
  const s = this.s;
  // 每 30 游戏分钟决策一次，避免抖动
  if (s.t - (s._lastNpcT || -Infinity) < 30) return;
  s._lastNpcT = s.t;
  for (const p of s.players) {
    if (p.isHuman || !p.alive) continue;
    this._npcDecide(p);
  }
};

Game.prototype._npcDecide = function (p) {
  const s = this.s, w = p.w;

  // 1) 自动收割成熟作物
  for (let i = 0; i < p.plots.length; i++) if (p.plots[i].ready) this._harvest(p, i, true);

  // 2) 补种：根据耐心选作物。耐心高→长周期；激进→短周期快速周转
  for (const pl of p.plots) {
    if (pl.crop) continue;
    const cid = w.patience > 0.7 ? 'ginseng' : (w.aggro > 0.6 ? 'chili' : 'radish');
    const c = s.crops[cid];
    const cost = c.seed;
    if (p.cash > cost + p.debt * 0.05) this._a_plant(p, { crop: cid });
  }

  // 3) 卖出：估算自己的成本与当前价（作物与加工品一起处理）
  for (const cid of ALL_GOODS) {
    const held = p.storage[cid] || 0;
    if (held <= 0) continue;
    const c = this.good(cid);          // 加工品也要能卖
    if (!c) continue;
    const book = p.avgCost[cid] || { c: c.base };
    const est = this._npcFairValue(p, cid);
    const margin = (c.price - book.c) / Math.max(1, book.c);
    // 价格高于估值就卖；恐慌时（价格跌破估值 12%）也卖一半止损
    let qty = 0;
    if (c.price > est * (1 + 0.05 - 0.05 * w.patience)) qty = Math.round(held * (0.35 + 0.4 * w.risk));
    else if (c.price < est * 0.88) qty = Math.round(held * 0.3 * w.risk);
    if (p.cash < 500 && held > 5) qty = Math.max(qty, Math.round(held * 0.6));
    if (qty > 0) this._trade(p, cid, Math.min(qty, held), 'sell');
  }

  // 4) 买入：价格低于估值且现金充裕
  for (const cid of ALL_GOODS) {
    const c = this.good(cid);
    if (!c) continue;
    const est = this._npcFairValue(p, cid);
    if (c.price < est * (1 - 0.12 + 0.06 * w.risk) && p.cash > 2000 && c.mmInv > 5) {
      const budget = p.cash * (0.15 + 0.25 * w.aggro);
      const qty = Math.min(Math.floor(budget / c.price), Math.floor(c.mmInv * 0.5));
      if (qty > 0) this._trade(p, cid, qty, 'buy');
    }
  }

  // 5) 攻击行为：激进/报复型会砸盘、放消息、看跌
  const grudge = p.memory.grudge[s.humanId] || 0;
  const humanP = s.players.find(x => x.id === s.humanId);
  const avengerMult = (humanP && humanP.isAvenger && s.t < 1440) ? 1.3 : 1;   // 复仇者第 1 天被重点照顾
  const aggro = (w.aggro + grudge * 0.15 + (p.w.revenge * grudge * 0.1)) * avengerMult;
  if (aggro > 0.75 && this.rng.npc.chance(0.10)) {
    const cid = this.rng.npc.pick(CROP_IDS);
    const c = s.crops[cid];
    const held = p.storage[cid] || 0;
    if (held > 20) {
      const qty = Math.round(held * 0.6);
      const before = c.price;
      this._trade(p, cid, qty, 'sell');
      this._log('bad', p.name + ' 突然大举抛售 ' + c.name + ' × ' + qty + '，价格从 ' +
        round2(before) + ' 砸到 ' + round2(c.price), null);
      p.memory.grudge[s.humanId] = grudge; // 记录仇恨
    } else if (this.rng.npc.chance(0.35 * w.aggro)) {
      this._npcRumor(p, cid);
    }
  }
  // 6) 看跌（激进型 + 规则允许）
  if (w.risk > 0.7 && this.rng.npc.chance(0.06)) {
    const cid = this.rng.npc.pick(CROP_IDS);
    const c = s.crops[cid];
    if (this._npcFairValue(p, cid) < c.price * 0.95 && p.cash > 3000) {
      const qty = Math.min(Math.floor(p.cash * 0.2 / (c.price * BAL.shortMargin)), Math.floor(c.mmInv));
      if (qty > 0) this._a_short(p, { crop: cid, qty });
    }
  }
  // 6.5) 制造型 NPC 会加工
  if (p.workshops > 0 && p.craftJobs.length < p.workshops) {
    for (const pd of PRODUCTS) {
      if ((p.storage[pd.from] || 0) >= pd.need && p.cash > 200) {
        const r = this._a_craft(p, { product: pd.id });
        if (r.ok) break;
      }
    }
  }
  // 6.6) 制造型 NPC 会建作坊；金融型 NPC 会放贷
  if ((CORPS.find(c => c.id === p.corp) || {}).canLend && p.cash > 6000 && this.rng.npc.chance(0.25)) {
    const need = this.s.players.filter(x => !x.isHuman && x.alive && x.cash < 1200)[0];
    if (need) this._a_lend(p, { pid: need.id, amount: Math.floor(Math.min(p.cash * 0.4, 3000)) });
  }
  if (p.corp === 'make' && p.cash > 5000 && p.workshops < 3 && this.rng.npc.chance(0.3)) {
    this._a_buildWorkshop(p);
  }
  // 7) 扩张
  if (p.cash > 6000 && p.plots.length < 6) this._a_expand(p);
  if (p.cash > 4000 && this.storageUsed(p) > this.storageMax(p) * 0.9) this._a_upgradeStorage(p);
  if (p.cash > 5000) {
    const free = p.plots.findIndex(pl => !pl.auto);
    if (free >= 0 && this.rng.npc.chance(0.3)) this._a_buyAuto(p, { index: free });
  }
  // 8) 天赋自动选
  if (p.talentOffers && p.talentOffers.length) this._a_talent(p, { id: this.rng.npc.pick(p.talentOffers) });
};

Game.prototype._npcFairValue = function (p, cid) {
  const c = this.good(cid);
  // 估值 = 锚 + 私有噪声（信息敏感度越低，噪声越大）
  const noise = (this.rng.npc.next() - 0.5) * 2 * (1 - p.w.info) * 0.25;
  return c.anchor * (1 + noise);
};

Game.prototype._npcRumor = function (p, cid) {
  const c = this.s.crops[cid];
  c.rumorMult = 1 - 0.08;
  c.rumorUntil = this.s.t + 180;
  this._log('intel', '有人在传' + c.name + '要跌的消息，价格应声走低', null);
};

/* ---- 3.7 破产与收购 ---------------------------------------------------*/
Game.prototype._bankrupt = function (p, why) {
  const s = this.s;
  // 金蝉脱壳天赋
  const keepRatio = p.mods.escapeRope ? 0.20 : 0;
  const kept = {};
  let leftoverVal = 0;
  for (const cid in p.storage) {
    const n = p.storage[cid];
    const k = Math.floor(n * keepRatio);
    if (k > 0) kept[cid] = k;
    leftoverVal += (n - k) * this.valuePrice(cid);      // 加工品也要估值
  }
  // 强制变卖（折价 30%，并砸盘）
  for (const cid in p.storage) {
    const n = p.storage[cid] - (kept[cid] || 0);
    if (n > 0) {
      const c = this.good(cid);
      if (!c) continue;
      const factor = Math.exp(-c.eta * (n / c.depth));   // 用市场深度，不用对手盘库存
      c.price = Math.max(0.5, c.price * factor);
      c.mmInv = Math.min(c.mmInvMax || 1e9, c.mmInv + n);
      c.anchor *= Math.pow(factor, c.anchorImpactShare || BAL.anchorImpactShare);
    }
  }
  const recovered = leftoverVal * (1 - BAL.liquidationHaircut);
  p.cash += recovered;
  p.storage = kept;

  const debtBefore = p.debt;
  let debtLeft = Math.max(0, p.debt - p.cash);
  p.cash = Math.max(0, p.cash - p.debt);
  p.debt = 0;
  if (p.mods.escapeRope) debtLeft *= 0.7;

  // 土地进入拍卖（破产资产包）
  const plots = p.plots.filter(pl => pl.upgraded || true).length;
  this._queueBankruptLot(p, plots);

  /* 持仓层（docs/13 §7.4）：破产的是“某一家公司”，【全部持仓】都破产你才出局。
     现阶段每家玩家恒有 1 条持仓（开局只能选一家），所以行为与旧版逐位一致。
     ⚠ 收购层接上后，必须把上面的清算范围收到“破产的那一家”，而不是整个玩家。 */
  if (Array.isArray(p.holdings)) {
    for (const h of p.holdings) if (h.corpId === p.corp) h.bankrupt = true;
  }
  p.alive = false;
  p.bankruptT = s.t;
  p.bankruptCount++;
  p.m.bankruptLeftover = debtLeft;
  p.m.bankruptAt = s.t;
  p.m.bankruptProx = this.monoProx(p).prox;
  p.m.bankruptNav = this.nav(p);
  this._log('bad', '💀 ' + p.name + ' 出局了（' + why + '）。欠债 ' + money(debtLeft) + ' G，' +
    plots + ' 块地和存货被挂上拍卖台。', null);

  // 有人接手他留下的债务 → 记债权人
  const creditor = s.players.find(x => x.alive && !x.isHuman);
  if (creditor) creditor.m.acquisitions++;
};

