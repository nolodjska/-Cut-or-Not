/* ===== part: 07-metrics.js ===== */
Game.prototype.good = function (id) { return this.s.crops[id] || this.s.products[id]; };
Game.prototype.isProduct = function (id) { return !!this.s.products[id]; };
Game.prototype.storageMax = function (p) { return p.storageCap + p.mods.storageBonus; };
Game.prototype.storageUsed = function (p) {
  let n = 0; for (const k in p.storage) n += p.storage[k]; return n;
};
/* 估值价：统一用 TWAP，而不是现货。
   原因（P0）：现货可被自己买上去，若用现货估 NAV，就能"自己抬价→NAV 涨→授信涨→再抬价"。
   结算、净资产、垄断摊牌全部用 twap。 */
Game.prototype.valuePrice = function (id) {
  const g = this.good(id);
  return g ? g.twap : 0;
};
/* 垄断溢价：手里握着某作物 35% 以上流通量时，这批货是能定价的，
   估值给到最高 1.4 倍。没有这一项，"控制市场"在账面上反而等于自残——
   逼仓的人会破产，而他是全场唯一控盘的人（已修）。 */
Game.prototype.controlMult = function (p, cid) {
  if (!this.s.crops[cid]) return 1;        // 加工品不享受垄断溢价
  const share = this.monoShare(p, cid);
  if (share <= 0.35) return 1;
  return 1 + Math.min(0.40, (share - 0.35) * (0.40 / 0.25));
};
Game.prototype.inventoryValue = function (p) {
  let v = 0;
  for (const k in p.storage) v += p.storage[k] * this.valuePrice(k) * this.controlMult(p, k);
  return v;
};
/* 库存成本法估值（授信用，彻底切断自我参照） */
Game.prototype.inventoryCost = function (p) {
  let v = 0;
  for (const k in p.storage) {
    const book = p.avgCost[k];
    const unit = (book && book.c) ? Math.min(book.c, this.valuePrice(k)) : this.valuePrice(k);
    v += p.storage[k] * unit;
  }
  return v;
};
/* 授信额度：成本法资产 ×50%，且有绝对上限。不用 NAV（自我参照会被玩坏） */
Game.prototype.creditLimit = function (p) {
  const corp = CORPS.find(c => c.id === p.corp) || CORPS[0];
  const base = p.cash + p.deposit + this.inventoryCost(p) * 0.8 + this.fixedAssets(p) * 0.8;
  // 金融公司自己就是钱庄：额度上限也按倍数放大（否则 2.5 倍只是个摆设）
  const cap = BAL.maxLoanAbs * (corp.creditMult || 1);
  return Math.max(0, Math.min(base * 0.5 * (corp.creditMult || 1), cap) - p.debt);
};
Game.prototype.loanRateOf = function (p) {
  const corp = CORPS.find(c => c.id === p.corp) || CORPS[0];
  return BAL.loanRateDay * (corp.loanRateMult || 1);
};
/* 固定资产：地块 + 高产地溢价 + 自动化设施 + 仓储扩容。
   必须计入 NAV，否则花钱买自动化/仓储会直接把自己的身家打下去，
   玩家会被系统惩罚"建设"（这是个会计 bug，不是设计选择）。 */
Game.prototype.fixedAssets = function (p) {
  let v = p.plots.reduce((a, pl) => a + BAL.plotCost * (pl.upgraded ? 1.6 : 1), 0);
  const autos = p.plots.filter(pl => pl.auto).length;
  v += autos * BAL.autoPlotCost * 0.70;
  v += (p.workshops || 0) * BAL.workshopCost * 0.80;   // 建好的作坊是能卖钱的厂房
  const extraStorage = Math.max(0, p.storageCap - BAL.storageCap);
  v += (extraStorage / BAL.storageUpgradeStep) * BAL.storageUpgradeCost * 0.6;
  return v;
};
/* 应收贷款（放出去的账）按 ×0.9 计入资产。
   不计的话"放贷"在账面上等于立刻自残：放 2,000 → 净资产掉 2,000。 */
Game.prototype.receivables = function (p) {
  let v = 0;
  for (const ln of (p.loansOut || [])) v += ln.principal * 0.9;
  return v;
};
Game.prototype.nav = function (p) {
  let shortLiab = 0;
  for (const cid in p.shorts) {
    const pos = p.shorts[cid];
    if (pos && pos.qty > 0) shortLiab += pos.qty * this.valuePrice(cid);
  }
  return p.cash + p.deposit + this.receivables(p) + this.inventoryValue(p) * 0.95 +
    this.fixedAssets(p) * 0.8 - p.debt - shortLiab;
};
Game.prototype.debtRatio = function (p) {
  const assets = p.cash + p.deposit + this.inventoryValue(p) * 0.95 + this.fixedAssets(p) * 0.8;
  if (assets <= 0) return 1;
  return clamp((p.debt + this.shortLiability(p)) / assets, 0, 2);
};
Game.prototype.shortLiability = function (p) {
  let v = 0; for (const cid in p.shorts) if (p.shorts[cid]) v += p.shorts[cid].qty * this.s.crops[cid].price;
  return v;
};

/* 垄断：分子 = 自持库存（深仓天赋藏起来的那部分在局内不计入，摊牌时并入）；
   分母 = 其他持有者的库存 + 未来一段时间的到货量（NPC 日吸纳 × monoAbsorbWeight）。
   注意：做市商库存**不在分母里** —— 你把它买走，它就变成你的分子了。
   早先版本把 mmInv 算进分母，等于要求玩家买下"自己还没买的货"，
   垄断成本荒谬地高，也把门槛与货量混为一谈（已修）。 */
Game.prototype.monoDenom = function (p, cid) {
  const c = this.s.crops[cid];
  if (!c) return 0;
  let others = 0;
  for (const q of this.s.players) if (q.alive && q !== p) others += (q.storage[cid] || 0);
  return others + c.absorbDay * BAL.monoAbsorbWeight;
};
Game.prototype.monoShare = function (p, cid) {
  let best = 0;
  if (cid && !this.s.crops[cid]) return 0;
  const ids = cid ? [cid] : CROP_IDS;
  for (const id of ids) {
    const hidden = this.s.over ? 0 : (p.mods.hiddenStorage || 0);
    const hold = Math.max(0, (p.storage[id] || 0) - hidden);
    if (hold * this.valuePrice(id) < BAL.monoMinValue) continue;   // 太便宜的仓位不算控盘
    const denom = this.monoDenom(p, id);
    const share = denom > 0 ? hold / (hold + denom) : 1;
    if (share > best) best = share;
  }
  return best;
};
Game.prototype.monoNeed = function (p) {
  const crop = this.monoCrop(p);
  return crop ? this.s.crops[crop].mono : 0.6;
};
Game.prototype.monoCrop = function (p) {
  let best = 0, bc = CROP_IDS[0];
  for (const id of CROP_IDS) {
    const hold = p.storage[id] || 0;
    const d = this.monoDenom(p, id);
    const sh = hold / (hold + d);
    // 用「占门槛的比例」比较，消除不同作物门槛差异
    const ratio = sh / this.s.crops[id].mono;
    if (ratio > best) { best = ratio; bc = id; }
  }
  return bc;
};
Game.prototype.monoProx = function (p) {
  const lam = { radish: 0.8, chili: 1.0, ginseng: 1.3 };
  let best = 0, info = null;
  for (const id of CROP_IDS) {
    const d = this.monoDenom(p, id);
    const hold = p.storage[id] || 0;
    const ctrl = hold / (hold + d);
    const prox = (ctrl / this.s.crops[id].mono) * lam[id];
    if (prox > best) { best = prox; info = { crop: id, ctrl, prox }; }
  }
  return { prox: best, ...info };
};

/* ---- 3.5 动作分发 -----------------------------------------------------*/
