/* ===== part: 12-shorts.js ===== */
Game.prototype._a_short = function (p, d) {
  const cid = d.crop, c = this.s.crops[cid];
  const qty = Math.floor(d.qty);
  if (!qty || qty <= 0) return { ok: false, msg: '数量不对' };
  if (!CROP_IDS.includes(cid)) return { ok: false, msg: '没有这种作物' };
  // 规则不允许裸卖空时，必须先借到货（借货池 = 对手盘库存）
  if (!this.s.rules.nakedShort && c.mmInv < qty)
    return { ok: false, msg: '借不到货。对手盘只剩 ' + Math.floor(Math.max(0, c.mmInv)) + ' 单位可借' };
  const notional = qty * c.price;
  const margin = notional * BAL.shortMargin * p.mods.shortMarginMult;
  if (p.cash < margin) return { ok: false, msg: '押金需要 ' + money(margin) + ' G（名义本金的 ' + Math.round(BAL.shortMargin * p.mods.shortMarginMult * 100) + '%）' };
  const r = this._trade(p, cid, qty, 'sell', c.price, true, true);
  if (!r.ok) return r;
  p.cash -= margin;                       // 卖出所得已在 _trade 内入账，押金另行冻结
  const pos = p.shorts[cid] || { qty: 0, entry: c.price, margin: 0, fee: 0 };
  pos.entry = (pos.entry * pos.qty + c.price * qty) / (pos.qty + qty);
  pos.qty += qty;
  pos.margin += margin;
  pos.fee = pos.fee || 0;
  p.shorts[cid] = pos;
  p.m.shortCount++;
  p.m.aggression += 15;
  this._log('trade', p.name + ' 借货卖出 ' + qty + ' ' + c.name + ' @' + round2(c.price) +
    '（押金 ' + money(margin) + ' G，价格被砸低 ' + (r.impact * 100).toFixed(1) + '%）', p.id);
  return { ok: true, msg: '建仓完成：' + qty + ' 单位 ' + c.name + '，押金 ' + money(margin) + ' G。价格反向涨 30% 会被动清盘。' };
};

Game.prototype._a_cover = function (p, d) {
  const cid = d.crop, pos = p.shorts[cid];
  if (!pos || pos.qty <= 0) return { ok: false, msg: '你没有这个方向的仓位' };
  const qty = Math.min(Math.floor(d.qty || pos.qty), pos.qty);
  const c = this.s.crops[cid];
  const fee = qty * c.price * BAL.marketFee * p.mods.feeMult;
  if (p.cash < qty * c.price + fee) return { ok: false, msg: '现金不足，买不回来' };
  const r = this._trade(p, cid, qty, 'buy', c.price, true, true);
  if (!r.ok) return r;
  const marginShare = pos.margin * (qty / pos.qty);
  const profit = qty * (pos.entry - c.price) - fee;
  p.cash += marginShare;                    // 释放押金
  p.realized += profit;
  p.m.realized += profit;
  pos.margin -= marginShare;
  pos.qty -= qty;
  if (pos.qty <= 0) delete p.shorts[cid];
  this._log(profit >= 0 ? 'good' : 'bad', p.name + ' 平掉 ' + qty + ' 单位 ' + c.name + ' 的看跌仓位，' +
    (profit >= 0 ? '赚了 ' : '亏了 ') + money(Math.abs(profit)) + ' G', p.id);
  return { ok: true, msg: '平仓完成，' + (profit >= 0 ? '赚' : '亏') + ' ' + money(Math.abs(profit)) + ' G' };
};

Game.prototype._forceCover = function (p, cid, why) {
  const pos = p.shorts[cid];
  if (!pos) return;
  const c = this.s.crops[cid];
  const qty = pos.qty;
  const cost = qty * c.price;
  p.cash += pos.margin;                     // 押金全部用于买回
  const cashAfterMargin = p.cash;           // 记下“加完押金”的现金，用来算买回到底花了多少
  delete p.shorts[cid];
  this._trade(p, cid, qty, 'buy', c.price, true, true);
  /* ⚠ 2026-10-08 审计拓到的金额 bug：原来这里打的是 p.cash，那是**清盘后的全部现金**
     （= 原现金 + 押金 − 买回成本），不是“剩余押金”。
     一个钱包 10,000 G、押金 1,000 G 的玩家会看到“剩余押金 9,850 G 退回”——
     直接印在吐司上的错误金额。现在打真实退回的押金。 */
  const back = Math.max(0, pos.margin - (cashAfterMargin - p.cash));
  if (p.cash < 0) {
    const short = -p.cash;
    p.debt += short; p.cash = 0;
    this._log('bad', '⚠ ' + p.name + ' 的 ' + c.name + ' 看跌仓位被动清盘，押金不够，缺口 ' + money(short) + ' G 转为负债', p.id);
  } else {
    this._log('bad', p.name + ' 的 ' + c.name + ' 看跌仓位被动清盘，' +
      '剩余押金 ' + money(back) + ' G 退回（' + why + '）', p.id);
  }
  p.m.aggression += 5;
  void cost;
};

Game.prototype._a_shell = function (p, d) {
  const corp = CORPS.find(x => x.id === p.corp);
  if (p.shell.owned === 0) {
    if (p.cash < BAL.shellCost) return { ok: false, msg: '注册一间皮包公司要 ' + BAL.shellCost + ' G' };
    p.cash -= BAL.shellCost;
    p.shell.owned = 1; p.shell.cover = 30; p.shell.on = 1;
    this._log('money', p.name + ' 注册了一间没有名字的公司', p.id);
    return { ok: true, msg: '皮包公司已注册。隐蔽度会随时间成长，越高越难被识破。' };
  }
  // 加厚隐蔽度
  const cost = Math.round(BAL.shellCoverPerUnit * 100 * 10 * (corp.shellGrowthMult || 1));
  if (p.cash < cost) return { ok: false, msg: '加厚隐蔽度要 ' + money(cost) + ' G' };
  p.cash -= cost;
  p.shell.cover = clamp(p.shell.cover + 10, 0, 100);
  return { ok: true, msg: '隐蔽度提升到 ' + Math.round(p.shell.cover) };
};
Game.prototype._a_shellToggle = function (p, d) {
  if (!p.shell.owned) return { ok: false, msg: '你还没有皮包公司' };
  p.shell.on = d.on ? 1 : 0;
  return { ok: true, msg: d.on ? '交易走皮包公司通道（隐蔽但慢）' : '交易走自己名下' };
};
Game.prototype._shellTick = function (dt) {
  const s = this.s;
  for (const p of s.players) {
    if (!p.alive || !p.shell.owned || !p.shell.on) continue;
    const corp = CORPS.find(x => x.id === p.corp);
    p.shell.cover = clamp(p.shell.cover + 0.05 * (corp.shellGrowthMult || 1) * (dt / 60), 0, 100);
    const expose = BAL.shellExposeBase * (1 - p.shell.cover / 100) * (dt / 60);
    if (this.rng.main.chance(expose)) {
      p.shell.on = 0; p.shell.cover = Math.max(0, p.shell.cover - 40);
      const frozen = Math.round(this.inventoryValue(p) * 0.3);
      p.cash -= frozen * 0.1;
      p.reputation = clamp(p.reputation - 5, 0, 100);
      /* ⚠ 文案必须与机制一致（2026-10-08 审计拓到）：代码只 `Math.max(0, cover - 40)`，
         不是清零——而隐蔽度是屏幕上一条显式进度条，玩家会照着“清零”去估被识破的概率。 */
      this._log('bad', '⚠ ' + p.name + ' 的皮包公司被识破了：通道关闭，罚金 ' + money(frozen * 0.1) + ' G，隐蔽度掉了 40', p.id);
    } else {
      p.m.shellTrades++;
    }
  }
};

