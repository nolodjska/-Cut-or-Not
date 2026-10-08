/* ===== part: 10-plot.js ===== */
Game.prototype._a_expand = function (p) {
  if (p.plots.length >= BAL.maxPlots) return { ok: false, msg: '已经是上限 ' + BAL.maxPlots + ' 块地了' };
  const n = p.plots.length - BAL.startPlots;            // 0 表示扩第 5 块
  const idx = clamp(n, 0, BAL.plotExpandCost.length - 1);
  const cost = BAL.plotExpandCost[idx] * (this.s.rules.doubleLandRent ? 1.3 : 1);
  if (p.cash < cost) return { ok: false, msg: '扩地要 ' + money(cost) + ' G' };
  p.cash -= cost;
  p.plots.push({ crop: null, plantedT: null, matureT: null, auto: false, upgraded: false });
  this._log('money', p.name + ' 扩了一块地（第 ' + p.plots.length + ' 块，花了 ' + money(cost) + ' G）', p.id);
  return { ok: true, msg: '扩地成功，现在有 ' + p.plots.length + ' 块地' };
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

