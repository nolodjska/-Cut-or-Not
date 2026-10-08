/* 地皮（§4.16）验收测试
 *
 * 背景：docs/19 §4.16 要把地分成「使用 × 地段」。本刀只落**使用**（因为它会改单产，
 * 是个真选择）；地段目前只影响价、不影响玩法，所以不进 UI。
 *
 * 本文件锁 6 条不变量（M1–M6）：
 *   M1 **默认价与加机制之前逐位一致**（加机制不许顺手改平衡）
 *   M2 使用倍率有序：设施用地 > 经济作物地 > 粮田
 *   M3 单产：经济作物地 > 粮田 > 设施用地
 *   M4 扩地会把“使用”写进地块，且默认仍是粮田价
 *   M5 地块上限仍然拦得住
 *   M6 旧存档的地块没有 use 字段时，单产倍率必须是 1（不改老账）
 *
 * 用法：node tools/land.test.cjs        # 期望全绿
 */
const GG = require('../game/engine.js');

const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function near(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= (eps == null ? 1e-6 : eps))) throw new Error((msg || '') + ' 期望 ' + b + '，实得 ' + a);
}
function mk(seed) {
  const g = new GG.Game({ seed: seed, corp: 'trade', npcs: 3, secPerGameHour: 8 });
  g.s.rules.doubleLandRent = false;
  return g;
}
function H(g) {
  const h = g.s.players.find(p => p.isHuman);
  if (!h) throw new Error('找不到玩家');
  return h;
}

console.log('=== 地皮（§4.16）验收测试 ===\n');

/* ---------------- M1 默认价必须与旧口径一致 ---------------- */
console.log('M1 默认地价 = 加机制之前（逐位一致）');
ok('默认（粮田）价 === plotExpandCost[idx]', () => {
  const g = mk('GG-LAND-M1'), h = H(g);
  const idx = Math.max(0, Math.min(GG.BAL.plotExpandCost.length - 1, h.plots.length - GG.BAL.startPlots));
  near(g.landPrice(h, {}), GG.BAL.plotExpandCost[idx], 1e-9, '默认地价必须与旧口径逐位一致');
  near(g.landPrice(h, { use: 'grain' }), GG.BAL.plotExpandCost[idx], 1e-9, '粮田就是基准价');
});

/* ---------------- M2 使用倍率有序 ---------------- */
console.log('\nM2 使用倍率有序：设施 > 经济作物 > 粮田');
ok('价格单调递增', () => {
  const g = mk('GG-LAND-M2'), h = H(g);
  const pG = g.landPrice(h, { use: 'grain' });
  const pC = g.landPrice(h, { use: 'cash' });
  const pF = g.landPrice(h, { use: 'facility' });
  assert(pC > pG, '经济作物地应比粮田贵（' + pC + ' vs ' + pG + '）');
  assert(pF > pC, '设施用地应最贵（' + pF + ' vs ' + pC + '）');
});

/* ---------------- M3 单产 ---------------- */
console.log('\nM3 单产：经济作物 > 粮田 > 设施用地');
ok('倍率关系正确，且粮田 = 1', () => {
  const g = mk('GG-LAND-M3');
  const yG = g.plotUseYield({ use: 'grain' });
  const yC = g.plotUseYield({ use: 'cash' });
  const yF = g.plotUseYield({ use: 'facility' });
  near(yG, 1, 1e-9, '粮田单产倍率必须是 1（否则默认地块被改了单产）');
  assert(yC > yG, '经济作物地单产应更高');
  assert(yF < yG, '设施用地单产应更低');
});

/* ---------------- M4 扩地写入使用 ---------------- */
console.log('\nM4 扩地把“使用”写进地块');
ok('买一块经济作物地：属性写上、钱按贵价扣、默认买地仍是粮田价', () => {
  const g = mk('GG-LAND-M4'), h = H(g);
  h.cash = 100000;
  const c0 = h.cash, n0 = h.plots.length;
  const r = g.act(h.id, 'expand', { use: 'cash' });
  assert(r.ok, '应能买下：' + r.msg);
  assert(h.plots.length === n0 + 1, '地块数应 +1');
  assert(h.plots[h.plots.length - 1].use === 'cash', '新地块应记下使用类型');
  assert(c0 - h.cash > GG.BAL.plotExpandCost[0], '经济作物地应比粮田贵');
  const g2 = mk('GG-LAND-M4B'), h2 = H(g2);
  h2.cash = 100000;
  const c1 = h2.cash;
  g2.act(h2.id, 'expand', {});
  near(c1 - h2.cash, GG.BAL.plotExpandCost[0], 1e-9, '不指定时仍按粮田价（默认不变）');
});

/* ---------------- M5 上限 ---------------- */
console.log('\nM5 地块上限仍然拦得住');
ok('到 maxPlots 后被拒，且不动钱', () => {
  const g = mk('GG-LAND-M5'), h = H(g);
  h.cash = 1e9;
  while (h.plots.length < GG.BAL.maxPlots) {
    const r = g.act(h.id, 'expand', {});
    if (!r.ok) break;
  }
  assert(h.plots.length === GG.BAL.maxPlots, '应先扩到上限，实得 ' + h.plots.length);
  const c0 = h.cash;
  const r = g.act(h.id, 'expand', {});
  assert(!r.ok, '到上限后应被拒');
  assert(h.cash === c0, '被拒时不该动钱');
});

/* ---------------- M6 旧存档兼容 ---------------- */
console.log('\nM6 旧存档的地块没有 use 字段 → 单产倍率必须是 1');
ok('plotUseYield({}) === 1，且不抛', () => {
  const g = mk('GG-LAND-M6');
  near(g.plotUseYield({}), 1, 1e-9, '缺 use 时应按 1 处理（不改老账单产）');
  near(g.plotUseYield(null), 1, 1e-9, 'null 也不该抛');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（地皮 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
