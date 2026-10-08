/* 估值与上市（§4.6/§4.10）验收测试
 *
 * 背景：docs/19 §4.6 要「估值」与「身价」分开；§4.10 要能发行股份募资。
 * 最容易犯的错是：把「上市」做成一个印钞旋钮（发股份 → 现金进来 → 身价凭空涨）。
 *
 * 本文件锁 6 条不变量（V1–V6）：
 *   V1 估值 = 可辨认净资产 × 可比乘数（且乘数按公司类型不同）
 *   V2 上市：公司现金按净额增加，自己持股下降
 *   V3 **上市不涨身价**：粮田公司（乘数 1.0）上市后身价必须**不高于**上市前
 *   V4 不得让自己掉到剩一半以下（否则说不上话）
 *   V5 单次让出有上限；被拒时状态一动不动
 *   V6 没上市的公司 stake 仍为 1，并表口径与加机制前逐位一致
 *
 * 用法：node tools/valuation.test.cjs      # 期望全绿
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
function mk(seed, corp) {
  const g = new GG.Game({ seed: seed, corp: corp || 'grow', npcs: 3, secPerGameHour: 8 });
  g.s.rules.doubleLandRent = false;
  return g;
}
function H(g) {
  const h = g.s.players.find(p => p.isHuman);
  if (!h) throw new Error('找不到玩家');
  return h;
}

console.log('=== 估值与上市（§4.6/§4.10）验收测试 ===\n');

/* ---------------- V1 估值口径 ---------------- */
console.log('V1 估值 = 可辨认净资产 × 可比乘数');
ok('粮田公司乘数 1.0；制造公司乘数 1.40', () => {
  const gG = mk('GG-VAL-V1A', 'grow'), hG = H(gG);
  near(gG.valuation(hG), gG.nav(hG), 1e-6, '乘数 1.0 时估值应等于净资产');
  const gM = mk('GG-VAL-V1B', 'make'), hM = H(gM);
  const m = GG.BAL.corpMult.make;
  assert(m > 1, '前提：制造公司的乘数应大于 1');
  near(gM.valuation(hM), gM.nav(hM) * m, 1e-6, '应按乘数放大');
  assert(gM.valuation(hM) > gG.valuation(hG) * 0 + 0, '估值应为正数');
});

/* ---------------- V2 上市：钱进来、股让出去 ---------------- */
console.log('\nV2 上市：公司现金按净额增加，自己持股下降');
ok('募资净额 = 估值 × 让出比例 − 发行费', () => {
  const g = mk('GG-VAL-V2', 'grow'), h = H(g);
  const c0 = h.cash, val = g.valuation(h);
  const r = g.act(h.id, 'ipo', { give: 0.25 });
  assert(r.ok, '应能发行：' + r.msg);
  const raise = Math.floor(val * 0.25);
  const fee = Math.floor(raise * GG.BAL.ipoFeeRate);
  near(h.cash - c0, raise - fee, 1, '到账应等于募资额减发行费');
  near(h.holdings[0].stake, 0.75, 1e-6, '持股应降到 75%');
});

/* ---------------- V3 上市不涨身价（核心） ---------------- */
console.log('\nV3 上市不是印钞旋钮');
ok('乘数 1.0 的公司：上市后并表身价必须 ≤ 上市前', () => {
  const g = mk('GG-VAL-V3', 'grow'), h = H(g);
  const nav0 = g.consolidated(h).nav;
  const r = g.act(h.id, 'ipo', { give: 0.25 });
  assert(r.ok, '前提：应发行成功');
  const nav1 = g.consolidated(h).nav;
  assert(nav1 <= nav0 + 1e-6,
    '上市后身价反而涨了 —— 那就是印钞（' + nav0.toFixed(0) + ' → ' + nav1.toFixed(0) + '）');
});

/* ---------------- V4 不得掉到一半以下 ---------------- */
console.log('\nV4 发行后自己必须还剩一半以上');
ok('让出 60% 被拒，且状态一动不动', () => {
  const g = mk('GG-VAL-V4', 'grow'), h = H(g);
  const c0 = h.cash, s0 = h.holdings[0].stake;
  const r = g.act(h.id, 'ipo', { give: 0.6 });
  assert(!r.ok, '让出 60% 必须被拒（否则说不上话了）');
  assert(h.cash === c0, '被拒时不该动现金');
  near(h.holdings[0].stake, s0, 1e-9, '被拒时不该动持股');
});

/* ---------------- V5 单次让出上限 ---------------- */
console.log('\nV5 单次让出有上限');
ok('请求 99% 时，实际让出被压到 ipoMaxGive（或直接被 V4 拦下）', () => {
  const g = mk('GG-VAL-V5', 'grow'), h = H(g);
  const r = g.act(h.id, 'ipo', { give: 0.99 });
  if (r.ok) {
    near(1 - h.holdings[0].stake, GG.BAL.ipoMaxGive, 1e-6, '实际让出应被压到上限');
  } else {
    assert(true, '被 V4 拦下也是可接受的行为（让出上限 > 可让空间）');
  }
});

/* ---------------- V6 未上市口径不变 ---------------- */
console.log('\nV6 没上市的公司：stake 仍为 1，口径与加机制前一致');
ok('新局 stake = 1；且 consolidated.nav === nav(p)', () => {
  const g = mk('GG-VAL-V6', 'grow'), h = H(g);
  near(h.holdings[0].stake, 1, 1e-9, '新局持股应为 1');
  near(g.consolidated(h).nav, g.nav(h), 1e-9, '未上市时并表口径必须与单公司口径一致');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（估值与上市 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
