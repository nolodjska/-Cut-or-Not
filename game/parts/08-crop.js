/* ===== part: 08-crop.js ===== */
Game.prototype.act = function (pid, name, payload) {
  const p = this.s.players.find(x => x.id === pid);
  if (!p) return { ok: false, msg: '没有这个玩家' };
  if (this.s.over) return { ok: false, msg: '赛季已经结束了' };
  const fn = this['_a_' + name];
  if (!fn) return { ok: false, msg: '无效操作：' + name };
  const r = fn.call(this, p, payload || {}) || { ok: true };
  this._syncRng();
  this._flush();
  return r;
};

Game.prototype._a_plant = function (p, d) {
  const cid = d.crop;
  if (!CROP_IDS.includes(cid)) return { ok: false, msg: '没有这种作物' };
  const c = this.s.crops[cid];
  const corp = CORPS.find(x => x.id === p.corp);
  const cost = Math.round(c.seed * corp.seedDiscount * (this.s.rules.doubleLandRent ? 1.25 : 1));
  let idx = d.index;
  if (idx == null) idx = p.plots.findIndex(pl => !pl.crop);
  if (idx < 0 || idx >= p.plots.length) return { ok: false, msg: '没有空地了，先扩一块地' };
  const pl = p.plots[idx];
  if (pl.crop) return { ok: false, msg: '这块地还种着东西' };
  if (p.cash < cost) return { ok: false, msg: '现金不够买种子（' + cost + ' G）' };
  p.cash -= cost;
  const growMin = c.growH * 60 * p.mods.growMult;
  pl.crop = cid; pl.plantedT = this.s.t; pl.matureT = this.s.t + growMin; pl.ready = false;
  return { ok: true, msg: '种下了 ' + c.icon + c.name + '，' + c.growH + ' 游戏小时后可以收割', idx };
};

Game.prototype._a_plantAll = function (p, d) {
  let n = 0, last = null;
  for (let i = 0; i < p.plots.length; i++) {
    if (p.plots[i].crop) continue;
    const r = this._a_plant(p, { crop: d.crop, index: i });
    if (!r.ok) { last = r; break; }
    n++;
  }
  return n ? { ok: true, msg: '一口气种了 ' + n + ' 块地' } : (last || { ok: false, msg: '没有空地' });
};

Game.prototype._harvest = function (p, idx, silent) {
  const pl = p.plots[idx];
  if (!pl || !pl.crop || !pl.ready) return { ok: false, msg: '还没熟' };
  const c = this.s.crops[pl.crop];
  const cid = pl.crop;
  let y = c.yld * p.mods.yieldMult * (pl.upgraded ? BAL.plotUpgradeMult : 1);
  const dis = c.activeYieldMult || 1;
  /* ⚠ 2026-10-08 审计拓出的硬 bug（原来是错的，两个方向都错）：
     原式：y *= (1 + (1 - dis) * (1 - p.mods.disasterMult))
       · disasterMult 默认是 **1** → (1-1)=0 → 乘 1 → **天灾完全不影响收成**
       · 点【g3 抗灾】后变成 0.5 → 1 + 0.5×(1-dis) → 干旱 **+10%**、病虫害 **+25%**
         —— 全游戏唯一针对天灾的天赋，居然把天灾变成了利好
     为什么致命：事件卡上写着「一半的苗子烂在地里」，而玩家据此囤货、
     结果一颗苗都没少；点了抗灾的玩家更会看到“天灾期间产量反涨”，
     直接得出“这游戏的数字是假的”（正是 §17.0 要防的东西）。
     现式：disasterMult 语义 = **损失系数**（默认 1 = 全额减产，0.5 = 减半） */
  if (dis < 1) y *= 1 - (1 - dis) * p.mods.disasterMult;
  if (p.mods.doubleHarvest && this.rng.main.chance(p.mods.doubleHarvest)) y *= 2;
  y = Math.max(1, Math.round(y));
  /* room 必须夹到 ≥0。仓储已经超出上限时（例如刚拍下"稀有种子"、或者降级了仓储），
     room 会是负数，而 Math.min(y, room) 就变成负数 —— 收割会**倒扣**库存，
     实测能把库存扣成 -27（回归测试的不变量检查抓到的）。 */
  const room = Math.max(0, this.storageMax(p) - this.storageUsed(p));
  const stored = Math.min(y, room);
  const wasted = y - stored;
  p.storage[cid] = (p.storage[cid] || 0) + stored;
  const book = p.avgCost[cid] || { q: 0, c: 0 };
  p.avgCost[cid] = { q: book.q + stored, c: (book.q * book.c + 0) / Math.max(1, book.q + stored) };
  const val = stored * this.valuePrice(cid);
  p.m.harvestedValue += val;
  p.m.harvestedUnits += stored;
  this._addCp(p, val * BAL.cpPerHarvestGold);
  pl.crop = null; pl.plantedT = null; pl.matureT = null; pl.ready = false;
  if (!silent) this._log('good', p.name + ' 收成 ' + c.icon + c.name + ' × ' + stored + (wasted ? '（仓满浪费 ' + wasted + '）' : ''), p.id);
  return { ok: true, msg: '收成 ' + c.name + ' × ' + stored + (wasted ? '，仓库满了浪费 ' + wasted : ''), amount: stored };
};

Game.prototype._a_harvest = function (p, d) { return this._harvest(p, d.index, false); };
Game.prototype._a_harvestAll = function (p) {
  let n = 0;
  for (let i = 0; i < p.plots.length; i++) if (p.plots[i].ready) { this._harvest(p, i, true); n++; }
  return n ? { ok: true, msg: '收了 ' + n + ' 块地' } : { ok: false, msg: '没有成熟的地' };
};

Game.prototype._a_buy = function (p, d) {
  const r = this.buy(p, d.crop, d.qty);
  if (r.ok) this._log('trade', p.name + ' 买入 ' + d.qty + ' ' + this.good(d.crop).name + ' @' + round2(r.price) +
    '（手续费 ' + round2(r.fee) + '，价格被推高 ' + (r.impact * 100).toFixed(1) + '%）', p.id);
  return r;
};
/* ---------- §17.1 收货商：额度（按玩家计） ---------- */
/** 你自己一天能卖给他多少。萝卜（absorbDay 800）→ 80。
 *  ⚠ 夹到至少 dealerQuotaMin，避免高端作物（absorbDay 小）额度小到没法玩。 */