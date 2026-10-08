/* 公司账（§4.12）验收测试 —— 「公司账上的钱不是股东的钱」的落地守卫
 *
 * 背景：docs/19 §4.12 要把 §4.8 那个洞堵上。洞长这样：
 *   · 公司现金与个人现金原本是同一口锅 ⇒ 玩家可以直接把公司的钱花在自己身上
 *   · 主控公司原本**全额**并表、不乘持股 ⇒ 卖掉自己公司 30% 股份 = 印钞
 *
 * 本文件锁 6 条不变量（F1–F6）：
 *   F1 新局：个人钱包为 0；持股 = 1 时并表口径与旧口径**逐位一致**（不许悄悄改账）
 *   F2 提取：现金↓、个人钱包↑、负债↑，而**身价不变** ← 防印钞的核心
 *   F3 上限：超过“公司现金 × 持股 × 0.8”被拒，且状态一动不动
 *   F4 **防印钞哨兵**：把持股降到 0.7 后，并表身价**不得高于**降之前
 *   F5 旧存档：没有 personal 字段时 nav 仍是有限数、并表不崩
 *   F6 提取确实抬高了负债率（拿多了照样会被催债，不是白拿）
 *
 * 用法：node tools/finance.test.cjs        # 期望全绿
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

console.log('=== 公司账（§4.12）验收测试 ===\n');

/* ---------------- F1 新局口径 ---------------- */
console.log('F1 新局：个人钱包为 0，且持股 = 1 时口径与旧算法逐位一致');
ok('personal 为 0；consolidated.nav === nav(p)（stake=1 的等价性）', () => {
  const g = mk('GG-FIN-F1'), h = H(g);
  assert(h.personal === 0, '新局个人钱包应为 0，实得 ' + h.personal);
  assert(h.holdings[0].stake === 1, '前提：新局持股为 1');
  near(g.consolidated(h).nav, g.nav(h), 1e-9, '持股 1 时并表身价必须与单公司口径一致（不许悄悄改账）');
});

/* ---------------- F2 提取（防印钞的核心） ---------------- */
console.log('\nF2 从公司拿钱：钱动了，但身价不许动');
ok('拿走 100 G：现金 −100、个人钱包 +100、负债 +100、身价不变', () => {
  const g = mk('GG-FIN-F2'), h = H(g);
  const nav0 = g.consolidated(h).nav;
  const c0 = h.cash, p0 = h.personal || 0, d0 = h.debt;
  const r = g.act(h.id, 'take', { amount: 100 });
  assert(r.ok, '提取应成功：' + r.msg);
  near(h.cash, c0 - 100, 1e-9, '公司现金应 −100');
  near(h.personal, p0 + 100, 1e-9, '个人钱包应 +100');
  near(h.debt, d0 + 100, 1e-9, '应按同额计一笔负债（这是“不是白拿”的体现）');
  near(g.consolidated(h).nav, nav0, 1e-6, '身价必须不变 —— 拿公司钱不是印钞');
});

/* ---------------- F3 上限 ---------------- */
console.log('\nF3 提取上限：公司还得留钱周转');
ok('超过“公司现金 × 持股 × 0.8”被拒，且状态一动不动', () => {
  const g = mk('GG-FIN-F3'), h = H(g);
  const cap = Math.floor(h.cash * h.holdings[0].stake * 0.8);
  const c0 = h.cash, d0 = h.debt;
  const r = g.act(h.id, 'take', { amount: cap + 1 });
  assert(!r.ok, '超过上限必须被拒');
  near(h.cash, c0, 1e-9, '被拒时不该动公司现金');
  near(h.debt, d0, 1e-9, '被拒时不该记负债');
  const r2 = g.act(h.id, 'take', { amount: cap });
  assert(r2.ok, '正好等于上限应当允许：' + r2.msg);
});

/* ---------------- F4 防印钞哨兵 ---------------- */
console.log('\nF4 防印钞哨兵：卖自己公司的股份，身价不许反而变高');
ok('持股 1 → 0.7 后，并表身价必须 ≤ 改之前', () => {
  const g = mk('GG-FIN-F4'), h = H(g);
  const before = g.consolidated(h).nav;
  assert(before > 0, '前提：身价应为正');
  h.holdings[0].stake = 0.7;                 // 等价于“卖掉了 30%”
  const after = g.consolidated(h).nav;
  assert(after <= before + 1e-9,
    '卖掉 30% 后身价反而涨了 —— 这就是印钞（before ' + before.toFixed(1) + ' → after ' + after.toFixed(1) + '）');
});

/* ---------------- F5 旧存档兼容 ---------------- */
console.log('\nF5 旧存档：没有 personal 字段也不许崩');
ok('delete personal 后 nav 仍是有限数、并表不抛', () => {
  const g = mk('GG-FIN-F5'), h = H(g);
  delete h.personal;
  const v = g.nav(h);
  assert(typeof v === 'number' && isFinite(v), 'nav 应为有限数，实得 ' + v);
  const s = g.consolidated(h);
  assert(isFinite(s.nav) && isFinite(s.debt), '并表数值应为有限数');
});

/* ---------------- F6 拿钱是有代价的 ---------------- */
console.log('\nF6 提取会抬高负债率（拿多了照样会被催债）');
ok('提取后负债率上升', () => {
  const g = mk('GG-FIN-F6'), h = H(g);
  const r0 = g.debtRatio(h);
  g.act(h.id, 'take', { amount: Math.floor(h.cash * 0.5) });
  const r1 = g.debtRatio(h);
  assert(r1 > r0, '拿钱应抬高负债率（r0 ' + r0.toFixed(3) + ' → r1 ' + r1.toFixed(3) + '）');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（公司账 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
