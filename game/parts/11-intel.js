/* ===== part: 11-intel.js ===== */
Game.prototype._a_intel = function (p, d) {
  const s = this.s;
  const tier = d.tier || 'insider';
  const corp = CORPS.find(x => x.id === p.corp);
  const r = this.s.rules;
  if (tier === 'free') {
    const q = this.s.eventQueue.find(x => x.fired && !x.ended) || this.s.eventQueue.find(x => !x.fired);
    if (!q) return { ok: false, msg: '市场上暂时没什么风声' };
    const ev = EVENT_POOL.find(e => e.id === q.id);
    const at = Math.floor(q.at / 60) + ' 时';
    const msg = q.fired
      ? '正在发生：' + ev.name + (q.crop ? '（' + this.s.crops[q.crop].name + '）' : '（全场）')
      : '风声：' + at + ' 前后可能有动静，方向偏' + (q.anchorMult > 1 ? '涨' : '跌') + '，具体看不清。' +
        (r.intelPublic ? '（本局消息灵通，信息更准）' : '');
    return { ok: true, msg, kind: 'free' };
  }
  const price = Math.round(BAL.intelInsiderPrice * corp.intelMod);
  // 情报不是无限刷的：同一条内幕只能买一次，且两次购买之间有等待
  if (s.t < (p.intelCdT || 0)) {
    const waitH = ((p.intelCdT - s.t) / 60).toFixed(1);
    return { ok: false, msg: '线人还在外面打听（' + waitH + ' 游戏小时后有新消息）' };
  }
  const bought = (p.m.intelEvents = p.m.intelEvents || []);
  const upcoming = this.s.eventQueue.find(x => !x.fired && !bought.includes(x.at));
  if (!upcoming) return { ok: false, msg: '线人说：最近没有新的风声了。这钱省下来吧。' };
  if (p.cash < price) return { ok: false, msg: '要 ' + price + ' G' };
  p.cash -= price;
  p.intelCdT = s.t + BAL.intelCooldownH * 60;
  bought.push(upcoming.at);
  const acc = BAL.intelInsiderAcc + (corp.intelAccBonus || 0);
  const ev = EVENT_POOL.find(e => e.id === upcoming.id);
  const correct = this.rng.main.chance(acc);
  const atH = Math.floor(upcoming.at / 60);
  const when = '第 ' + (Math.floor(atH / 24) + 1) + ' 天 ' + (atH % 24) + ' 时';
  let crop = upcoming.crop, dir = upcoming.anchorMult > 1 ? '涨' : '跌';
  if (!correct) { crop = this.rng.main.pick(CROP_IDS.filter(c => c !== upcoming.crop)); dir = dir === '涨' ? '跌' : '涨'; }
  const text = '内幕：' + when + ' 前后【' + ev.name + '】，' +
    (crop ? this.s.crops[crop].name : '全场') + ' 价格偏' + dir + '。';
  p.m.intelBought++;
  /* correct 只用于内部结算（最佳线报商 + 卖消息定价），UI 不许显示单条真假 ——
     否则 80% 准确率会被玩家变成 100%（审核发现的）。 */
  p.m.intelKnown.push({ qid: upcoming.at, correct, crop, dir, verdict: '待验证' });
  this._log('intel', p.name + ' 买到一条内幕情报', p.id);
  const comm = corp.intelCommission;
  return { ok: true, msg: text + (comm ? '（情报公司抽成 ' + (comm * 100) + '% 已计入你的营收）' : ''), kind: 'insider', correct };
};

Game.prototype._a_sellIntel = function (p, d) {
  const corp = CORPS.find(x => x.id === p.corp);
  if (!corp.intelCommission) return { ok: false, msg: '你的公司类型不靠卖消息赚钱' };
  const known = p.m.intelKnown.filter(k => !k.sold);
  if (!known.length) return { ok: false, msg: '你手上没有可卖的情报，先买一条' };
  const k = known[0];
  // 同一条消息可以卖给多个买家，但越往后越不值钱（消息会扩散）
  k.soldTo = k.soldTo || [];
  const buyers = this.s.players.filter(x => !x.isHuman && x.alive && !k.soldTo.includes(x.id));
  if (!buyers.length) { k.sold = true; return { ok: false, msg: '这条消息能卖的人都卖过了' }; }
  const buyer = buyers[0];
  const decay = Math.pow(0.6, k.soldTo.length);
  const base = 420 * (k.correct ? 1.4 : 0.7) * (0.6 + p.reputation / 100) * decay;
  const price = Math.round(base * (this.s.rules.intelPublic ? 1.2 : 1));
  k.soldTo.push(buyer.id);
  if (k.soldTo.length >= 3) k.sold = true;
  p.cash += price;
  p.m.intelSold++;
  if (k.correct) p.m.intelCorrect++;
  p.reputation = clamp(p.reputation + (k.correct ? 2 : -6), 0, 100);
  this._log('intel', p.name + ' 把情报卖给 ' + buyer.name + '，进账 ' + money(price) + ' G' +
    (k.correct ? '' : '（是条假消息，信誉受损）'), p.id);
  return { ok: true, msg: '卖掉一条情报，进账 ' + money(price) + ' G（信誉 ' + Math.round(p.reputation) + '）' };
};

Game.prototype._a_rumor = function (p, d) {
  const s = this.s;
  const cost = Math.round(BAL.rumorCost * p.mods.rumorCostMult);
  // 冷却：谣言是稀缺弹药，不能连点（也保护 UX 与新手不被自己的手速坑）
  if (s.t < (p.rumorCdT || 0)) {
    const wait = ((p.rumorCdT - s.t) / 60).toFixed(1);
    return { ok: false, msg: '放消息的渠道要缓一缓（' + wait + ' 游戏小时后）' };
  }
  if (p.cash < cost) return { ok: false, msg: '要 ' + cost + ' G' };
  p.cash -= cost;
  p.rumorCdT = s.t + BAL.rumorCooldownH * 60;
  const c = this.s.crops[d.crop];
  const dir = d.dir === 'up' ? 1 : -1;
  const shift = BAL.rumorShift * p.mods.rumorShiftMult * dir;
  const exposed = this.rng.main.chance(BAL.rumorExposeChance);
  c.rumorMult = 1 + shift * (exposed ? 0.5 : 1);
  c.rumorUntil = this.s.t + BAL.rumorDurH * 60;
  p.m.rumorCount++;
  p.m.aggression += 10;
  if (exposed) {
    p.m.rumorExposed++;
    p.reputation = clamp(p.reputation - 10, 0, 100);
    this._log('bad', p.name + ' 放出关于' + c.name + '的消息，被人当场拆穿（信誉 −10）', p.id);
    return { ok: true, msg: '消息放出去了，但被人拆穿——效果减半，信誉受损' };
  }
  this._log('intel', '市场上开始流传关于' + c.name + '的传闻，价格向' + (dir > 0 ? '上' : '下') + '偏了 ' + Math.abs(shift * 100).toFixed(0) + '%', null);
  return { ok: true, msg: '传闻生效：' + c.name + ' 价格锚 ' + (dir > 0 ? '+' : '−') + Math.abs(shift * 100).toFixed(0) + '%，持续 ' + BAL.rumorDurH + ' 游戏小时' };
};

