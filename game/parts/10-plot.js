/* ===== part: 10-plot.js ===== */
/* 地价（docs/19 §4.16）：使用 × 地段。
   锚点 = “粮田 · 城郊” = plotExpandCost[idx] 本身 ⇒
   默认地块的价钱与加这条机制之前**逐位一致**。
   ⚠ 单独立成一个函数，是因为 §4.16 要求市场面板与记账读**同一个价** ——
     两处各算一遍必然对不上（本项目在别处踩过“面板价 vs 成交价”不一致）。 */
Game.prototype.landPrice = function (p, d) {
  const n = (p && p.plots ? p.plots.length : BAL.startPlots) - BAL.startPlots;
  const idx = clamp(n, 0, BAL.plotExpandCost.length - 1);
  const use = (d && d.use) || 'grain';
  const district = (d && d.district) || 'suburb';
  const um = BAL.landUseMult[use] == null ? 1 : BAL.landUseMult[use];
  const dm = BAL.landDistrictMult[district] == null ? 1 : BAL.landDistrictMult[district];
  return Math.round(BAL.plotExpandCost[idx] * um * dm * (this.s.rules.doubleLandRent ? 1.3 : 1));
};
/* “使用”对单产的影响（docs/19 §4.16）。粮田 = 1.0 ⇒ 默认地块算出来与以前完全一样。
   旧存档的地块没有 use 字段 ⇒ 这是 undefined ⇒ 走默认 1.0（不会被改单产）。 */
Game.prototype.plotUseYield = function (pl) {
  if (!pl) return 1;
  const v = BAL.landUseYield[pl.use];
  return v == null ? 1 : v;
};

Game.prototype._a_expand = function (p, d) {
  if (p.plots.length >= BAL.maxPlots) return { ok: false, msg: '已经是上限 ' + BAL.maxPlots + ' 块地了' };
  const use = (d && d.use) || 'grain';
  const district = (d && d.district) || 'suburb';
  const cost = this.landPrice(p, { use, district });
  if (p.cash < cost) return { ok: false, msg: '这块地要 ' + money(cost) + ' G' };
  p.cash -= cost;
  p.plots.push({ crop: null, plantedT: null, matureT: null, auto: false, upgraded: false, use, district });
  const nm = (BAL.landUseName[use] || '地');
  /* 文案说“现象与价钱”，不说“使用/地段/溢价率”这类表格语言。 */
  this._log('money', p.name + ' 买下一块' + nm + '（第 ' + p.plots.length + ' 块，花了 ' + money(cost) + ' G）', p.id);
  return { ok: true, msg: '买下一块' + nm + '（第 ' + p.plots.length + ' 块），现在有 ' + p.plots.length + ' 块地' };
};

Game.prototype._a_upgradePlot = function (p, d) {
  const pl = p.plots[d.index];
  if (!pl) return { ok: false, msg: '没有这块地' };
  if (pl.upgraded) return { ok: false, msg: '已经是高产地了' };
  if (p.cash < BAL.plotUpgradeCost) return { ok: false, msg: '要 ' + money(BAL.plotUpgradeCost) + ' G' };
  p.cash -= BAL.plotUpgradeCost; pl.upgraded = true;
  return { ok: true, msg: '这块地单产提升到 ' + BAL.plotUpgradeMult + ' 倍' };
};
Game.prototype._a_buyAuto = function (p, d) {
  const pl = p.plots[d.index];
  if (!pl) return { ok: false, msg: '没有这块地' };
  if (pl.auto) return { ok: false, msg: '已经是自动地了' };
  if (p.cash < BAL.autoPlotCost) return { ok: false, msg: '要 ' + money(BAL.autoPlotCost) + ' G' };
  p.cash -= BAL.autoPlotCost; pl.auto = true;
  return { ok: true, msg: '这块地会自动收割并补种（放置化）' };
};
Game.prototype._a_upgradeStorage = function (p) {
  const cost = Math.round(BAL.storageUpgradeCost * (this.s.rules.doubleStoragePrice ? 1.5 : 1));
  if (p.cash < cost) return { ok: false, msg: '要 ' + money(cost) + ' G' };
  p.cash -= cost; p.storageCap += BAL.storageUpgradeStep;
  return { ok: true, msg: '仓储上限 +' + BAL.storageUpgradeStep + '，现在是 ' + this.storageMax(p) };
};

Game.prototype._a_loan = function (p, d) {
  const limit = this.creditLimit(p);
  const amt = Math.min(Math.floor(d.amount || 0), Math.floor(limit));
  if (amt <= 0) return { ok: false, msg: '额度用完了（授信 = 资产成本法 ×50%，且总额有上限）' };
  p.cash += amt; p.debt += amt;
  this._log('money', p.name + ' 借入 ' + money(amt) + ' G，日息 ' + (BAL.loanRateDay * 100).toFixed(1) + '%', p.id);
  return { ok: true, msg: '到账 ' + money(amt) + ' G（负债 ' + money(p.debt) + '，剩余额度 ' + money(this.creditLimit(p)) + '）' };
};
Game.prototype._a_repay = function (p, d) {
  const amt = Math.min(Math.floor(d.amount || 0), p.cash, p.debt);
  if (amt <= 0) return { ok: false, msg: '没有可还的' };
  p.cash -= amt; p.debt -= amt;
  return { ok: true, msg: '还了 ' + money(amt) + ' G' };
};

