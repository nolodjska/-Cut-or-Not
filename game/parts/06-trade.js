/* ===== part: 06-trade.js ===== */
Game.prototype._impact = function (p, cid, qty, side) {
  const c = this.good(cid);
  const m = p.mods;
  let mult = side === 'buy' ? m.buyImpactMult : m.sellImpactMult;
  if (side === 'sell' && m.dumpBonus) mult *= m.dumpBonus;
  if (p.exportUntil > this.s.t && side === 'sell') mult *= 0.6;
  /* §17.1 收货商：他已经收满今天的量 → 再卖就要吃他的脸色。
     这是“他摊上的那块牌子”背后的机制，也是玩家能自己推出来的规则之一。
     ⚠ 只算作物：收货商 = 产地收购站/粮商，收的是**作物**；
        成品的下家是 §17.2「上门的买家」（街坊/作坊主/豪客），不走这一套。
     ⚠ **按玩家计**（不是全市场）：牌子必须能由玩家自己的行为解释。 */
  if (side === 'sell' && !this.isProduct(cid) && this.dealerSoldToday(p, cid) >= this.dealerQuota(cid)) {
    mult *= BAL.dealerFullMult;
  }
  let imp = c.eta * (qty / c.depth) * mult;
  const dev = c.price / c.anchor - 1;
  if (side === 'buy' && dev > 0) imp *= 1 / (1 + dev * 5);
  if (side === 'sell' && dev < 0) imp *= 1 / (1 + (-dev) * 5);
  return imp;
};

/**
 * 一笔成交。side: 'buy' | 'sell'
 * 返回 { ok, msg, price, gross, fee, impact }
 */
Game.prototype._trade = function (p, cid, qty, side, priceOverride, isLimit, bypassStock) {
  const s = this.s, c = this.good(cid);
  if (!p.alive) return { ok: false, msg: '你已经出局了' };
  qty = Math.floor(qty);
  if (!qty || qty <= 0) return { ok: false, msg: '数量不对' };

  /* 执行价 = 冲击在整个数量上的**积分均值**，而不是"成交前那一瞬间的价格"。
     这是本引擎最严重的漏洞的修法：原来整笔按成交前价格结算、冲击只改下一笔的报价，
     于是"买满 → 立刻卖出"会把价格推高再砸回来，市场状态逐位复原、现金却凭空变多 ——
     实测 200 轮往返净赚 123,231 G，全程没有推进任何游戏时间。
     改用均值后，同规模往返恰好零净额（只剩手续费）。
       买入：∫₀^Q P₀·e^(ηq/depth)dq / Q = P₀·(e^imp − 1)/imp
       卖出：P(q)=P₀·e^(−kq)，均值 = P₀·(1 − e^(−imp))/imp（注意是 1−factor，不是 1−1/factor）*/
  const mktPrice = c.price;
  const imp = this._impact(p, cid, qty, side);
  const factor = Math.exp(side === 'buy' ? imp : -imp);
  let price0 = Math.abs(imp) < 1e-9
    ? mktPrice
    : (side === 'buy' ? mktPrice * (factor - 1) / imp : mktPrice * (1 - factor) / imp);
  /* 限价单的成交价被自己的限价夹住（买单不比限价贵、卖单不比限价便宜）。
     限价单只在价格穿过挂价时成交，所以夹住之后不会优于市价，不产生套利。 */
  if (priceOverride) {
    price0 = side === 'buy' ? Math.min(priceOverride, price0) : Math.max(priceOverride, price0);
  }
  // 品牌溢价：成品卖出时按品牌值加成（最高 +30%），原料不享受
  if (this.isProduct(cid) && side === 'sell' && p.brand > 0) {
    price0 *= 1 + 0.30 * Math.pow(p.brand / 100, 1.5);
  }
  const feeMult = (c.policyMult || 1) * p.mods.feeMult *
    (CORPS.find(x => x.id === p.corp).feeMod || 1) *
    (p.taxfreeUntil > s.t ? 0 : 1);

  if (side === 'buy') {
    // 可买量受做市商库存限制（逼仓时就是把对手盘买空）
    const avail = Math.max(0, Math.floor(c.mmInv));
    if (!bypassStock && !isLimit && qty > avail) return { ok: false, msg: '市场只挂得出 ' + avail + ' 单位，剩下的人都在抢' };
  } else if (this.isProduct(cid) && c.mmInv >= c.mmInvMax) {
    // 加工品有真实的下游需求上限：吃不下就是吃不下（这是加工流不能无限放大的原因）
    return { ok: false, msg: '下游暂时吃不下这么多，等他们把库存消化掉（现有 ' + Math.floor(c.mmInv) + ' / 上限 ' + c.mmInvMax + '）' };
  } else {
    if (!bypassStock && (p.storage[cid] || 0) < qty) return { ok: false, msg: '库存不足（你有 ' + (p.storage[cid] || 0) + ' 单位）' };
  }

  const gross = qty * price0;
  const fee = gross * BAL.marketFee * feeMult;

  if (side === 'buy') {
    if (p.cash < gross + fee) return { ok: false, msg: '现金不足（需要 ' + money(gross + fee) + ' G）' };
    if (!bypassStock && this.storageUsed(p) + qty > this.storageMax(p)) return { ok: false, msg: '仓库放不下了' };
    p.cash -= (gross + fee);
    if (!bypassStock) {
      p.storage[cid] = (p.storage[cid] || 0) + qty;
      const prevQty = (p.avgCost[cid] && p.avgCost[cid].q) || 0;
      const prevAmt = prevQty * ((p.avgCost[cid] && p.avgCost[cid].c) || price0);
      p.avgCost[cid] = { q: prevQty + qty, c: (prevAmt + gross) / (prevQty + qty) };
    }
    c.mmInv -= qty;
  } else {
    const book = p.avgCost[cid] || { q: 0, c: price0 };
    const cost = (book.c || price0) * qty;
    p.cash += (gross - fee);
    if (!bypassStock) {
      const held = p.storage[cid] || 0;
      if (held < qty) {
        /* 上面已经校验过一次，走到这里说明有路径绕过了校验。
           不静默吞掉：clamp 到 0 防止状态被污染，同时把上下文打出来（回归测试里出现过一次
           「钱串儿 库存 radish = -27」，单独复现不出来，所以留一个自己会报案的哨兵）。 */
        p.m.stockLeak = (p.m.stockLeak || 0) + 1;
        this._log('system', '⚠ 内部校验漏了一次：' + p.name + ' 卖出 ' + qty + ' ' + c.name +
          ' 但库存只有 ' + held + '（已按实际库存结算）', p.id);
        qty = held;  // 按实际库存成交
        p.storage[cid] = 0;
        delete p.storage[cid];
      } else {
        p.storage[cid] = held - qty;
        if (p.storage[cid] <= 0) delete p.storage[cid];
      }
    }
    const realized = bypassStock ? 0 : (gross - fee - cost);
    p.realized += realized;
    p.m.realized += realized;
    c.mmInv += qty;
    /* §17.1 收货商：只记**你自己**的（理由见 player.dealerSold 的注释）。
       ⚠ 这里**故意不再累加 c.absorbedToday** —— 那是全市场口径，
          会被 NPC 卖掉，让牌子变成玩家看不见的原因。 */
    if (!this.isProduct(cid)) {
      const today = Math.floor(this.s.t / 1440);
      if (p.dealerSoldDay !== today) { p.dealerSold = {}; p.dealerSoldDay = today; }
      p.dealerSold[cid] = (p.dealerSold[cid] || 0) + qty;
    }
  }
  p.m.feePaid += fee;
  p.m.volume += gross;
  p.m.cropTraded[cid] = (p.m.cropTraded[cid] || 0) + 1;
  p.m.publicTrades += 1;
  s.stats.trades += 1;

  // 价格冲击（imp/factor 已在结算前算好）
  const priceBefore = c.price;
  c.price = Math.max(0.5, c.price * factor);
  c.anchor = Math.max(0.5, c.anchor * Math.pow(factor, c.anchorImpactShare || BAL.anchorImpactShare));
  const dP = c.price - priceBefore;

  p.m.volContrib += Math.abs(dP / priceBefore) * gross;
  if (side === 'sell') p.m.dumpImpactMax = Math.max(p.m.dumpImpactMax, -dP / priceBefore);
  if (side === 'buy' && !bypassStock) {
    const lvl = c.price / c.anchor - 1;
    if (lvl > 0.15) {
      p.m.bubbleArm = {
        crop: cid,
        level: Math.max(lvl, (p.m.bubbleArm && p.m.bubbleArm.crop === cid ? p.m.bubbleArm.level : 0)),
        qty: p.storage[cid] || 0,
        peak: c.price,
      };
    }
  }

  // 结算埋点：收割信用 / 命运共同体信用
  let lost = 0, gained = 0;
  for (const q of s.players) {
    if (q === p || !q.alive) continue;
    const inv = q.storage[cid] || 0;
    if (inv > 0) { if (dP < 0) lost += inv * (-dP); else gained += inv * dP; }
  }
  if (lost > 0) { p.m.harvestCredit += lost; }
  if (gained > 0) { p.m.blessCredit += gained; }
  p.m.creditsGiven += gained;
  p.m.creditsTaken += lost;

  this._addCp(p, gross * BAL.cpPerTradeVolume);
  // 成交必须回话：玩家最想知道"我到手多少"，以及"我这一单把价格推了多远"
  const msg = side === 'buy'
    ? '买入 ' + qty + ' ' + c.name + ' @' + round2(price0) + '，花了 ' + money(gross + fee) + ' G'
    : '卖出 ' + qty + ' ' + c.name + ' @' + round2(price0) + '，到手 ' + money(gross - fee) + ' G';
  return { ok: true, msg, price: price0, gross, fee, impact: imp, qty, side };
};

/* 报价：给 UI 用。不做状态变更，纯计算。
   返回该笔成交的预计均价、总额、手续费、价格冲击、以及"最多能做多少"。 */
Game.prototype.quote = function (p, cid, qty, side) {
  const c = this.good(cid);
  qty = Math.max(0, Math.floor(qty || 0));
  /* 投入品（牌价、无冲击）：照实回一个固定价的报价，
     避免 UI 或别处误用通用报价时算出 NaN（本项目 NAV 被 NaN 污染过一次）。 */
  if (this.isInput(cid)) {
    const corp = CORPS.find(x => x.id === p.corp);
    const unit = c.base * (c.kind === 'seed' ? (corp.seedDiscount || 1) : 1);
    const fm = (p.mods.feeMult || 1) * (corp.feeMod || 1);
    const fr = BAL.marketFee * fm;
    const fee = unit * qty * fr;
    const room = this.storageMax(p) - this.storageUsed(p);
    const maxQty = side === 'buy'
      ? Math.max(0, Math.floor(Math.min(p.cash / Math.max(0.01, unit * (1 + fr)), room)))
      : 0;
    return { qty, avgPrice: unit, gross: unit * qty, fee, total: unit * qty + fee,
             impactPct: 0, priceAfter: unit, maxQty, feeRate: fr, fixed: true };
  }
  const feeMult = (c.policyMult || 1) * p.mods.feeMult *
    (CORPS.find(x => x.id === p.corp).feeMod || 1) * (p.taxfreeUntil > this.s.t ? 0 : 1);
  const imp = this._impact(p, cid, qty, side);
  const factor = Math.exp(side === 'buy' ? imp : -imp);
  /* 必须和 _trade 用同一个公式，否则面板报的价和实际成交价系统性不一致
     （审核实测：面板 2,321.9 G vs 实际 2,170.0） */
  const avg = Math.abs(imp) < 1e-9
    ? c.price
    : (side === 'buy' ? c.price * (factor - 1) / imp : c.price * (1 - factor) / imp);
  const gross = qty * avg;
  const fee = gross * BAL.marketFee * feeMult;
  let maxQty = Infinity;
  if (side === 'buy') {
    const afford = p.cash / Math.max(0.01, avg * (1 + BAL.marketFee * feeMult));
    const room = this.storageMax(p) - this.storageUsed(p);
    maxQty = Math.max(0, Math.floor(Math.min(afford, room, Math.max(0, c.mmInv))));
  } else {
    maxQty = Math.max(0, Math.floor(p.storage[cid] || 0));
  }
  return {
    qty, avgPrice: avg, gross, fee, total: side === 'buy' ? gross + fee : gross - fee,
    impactPct: (factor - 1) * 100, priceAfter: c.price * factor, maxQty,
    feeRate: BAL.marketFee * feeMult,
  };
};

Game.prototype.buy = function (p, cid, qty) {
  if (this.isInput(cid)) return this._buyInput(p, cid, qty);
  return this._trade(p, cid, qty, 'buy');
};
/* 投入品**只能买、不能卖**（docs/19 §4.15）：买来是为了用，倒手炒农资不是本作玩法。 */
Game.prototype.sell = function (p, cid, qty) {
  if (this.isInput(cid)) return { ok: false, msg: '这一档东西买来就是为了用，不能倒手卖。' };
  return this._trade(p, cid, qty, 'sell');
};

/* ---- 投入品：固定牌价的买入通道（docs/19 §4.15）-------------------------
   为什么不复用 _trade：_trade 深依赖 mmInv / depth / anchorImpactShare 算价格冲击
   与可买量，而投入品**没有这些字段也不该有**（牌价不该被买上去）。
   与其在通用路径里到处加 if（每加一处都是一个 NaN 风险点），不如给它一条窄通道：
     ① 校验现金与仓位 ② 按牌价扣款 ③ 入库并更新均价。
   代价：投入品不进 m.cropTraded / 收货商 / 垄断统计 —— 本来也不该进。 */
Game.prototype._buyInput = function (p, id, qty) {
  const g = this.s.inputs && this.s.inputs[id];
  if (!g) return { ok: false, msg: '没有这种东西' };
  qty = Math.max(0, Math.floor(qty || 0));
  if (qty <= 0) return { ok: false, msg: '数量要大于 0' };
  /* 种子按公司折扣计价（docs/19 §4.15-D）：种植公司的 8 折从“播种时打折”
     挪到“买入时打折”——同一笔钱，但账要记在**买**这一步，不然播种的账是虚的。 */
  const corp = CORPS.find(x => x.id === p.corp);
  const unit = g.base * (g.kind === 'seed' ? (corp.seedDiscount || 1) : 1);
  const feeMult = (p.mods.feeMult || 1) * (corp.feeMod || 1);
  const fee = unit * qty * BAL.marketFee * feeMult;
  const total = unit * qty + fee;
  const room = this.storageMax(p) - this.storageUsed(p);
  if (qty > room) return { ok: false, msg: '仓里放不下了（还能放 ' + room + ' 单位）' };
  if (p.cash < total) return { ok: false, msg: '现金不够（要 ' + Math.round(total) + ' G）' };
  p.cash -= total;
  const prevQty = p.storage[id] || 0;
  const prevAmt = prevQty * ((p.avgCost[id] && p.avgCost[id].c) || unit);
  p.storage[id] = prevQty + qty;
  p.avgCost[id] = { q: prevQty + qty, c: (prevAmt + unit * qty) / (prevQty + qty) };
  p.m.feePaid += fee;
  p.m.volume += unit * qty;
  return { ok: true, msg: '买了 ' + qty + ' ' + g.name + '，花了 ' + money(total) + ' G', qty, gross: unit * qty, fee };
};

/* ---- 3.4 库存 / 估值 ---------------------------------------------------*/
/* 统一的"货"访问器：作物（crops）与加工品（products）共享交易/库存/估值代码。
   垄断判定仍然只算作物 —— 加工品不参与控盘，否则会出现"垄断辣酱"这种怪东西。 */
