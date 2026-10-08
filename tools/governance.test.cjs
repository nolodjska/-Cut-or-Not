/* 股东名册与决议（§4.13/§4.14）验收测试
 *
 * 背景：docs/19 §4.13 要求「名册 / 提案 / 表决 / 四态」。§4.14 特别强调：
 *   **「没人理」与「顶上」不是同一件事** —— 前者是可以重提的沉默，后者是明确的否决。
 *
 * 本文件锁 6 条不变量（G1–G6）：
 *   G1 名册：新局只有自己一条、stake = 1、分母 = 1
 *   G2 提案门槛：持股 ≥10% 才提得了；不到一成被拒
 *   G3 一次只议一件（在议期间再提会被拦）
 *   G4 **四态分开**：没人理 / 通过 / 否决 三种必须落成三种不同状态
 *   G5 分红：现金↓、个人钱包↑，而**并表身价不变**（分红不是印钞）
 *   G6 净资产为负时不许分红（法定顺序第①步：先弥补亏损）
 *
 * 用法：node tools/governance.test.cjs      # 期望全绿
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
/* 把时间推到决议到期之后，再结算一次 */
function expire(g) {
  const dec = (g.s.decisions || []).find(x => x.status === 'open');
  if (dec) g.s.t = dec.dueT + 1;
  g._decisionTick();
  return dec;
}
function lastDec(g) { return (g.s.decisions || [])[(g.s.decisions || []).length - 1]; }

console.log('=== 股东名册与决议（§4.13/§4.14）验收测试 ===\n');

/* ---------------- G1 名册 ---------------- */
console.log('G1 新局名册');
ok('只有自己一条、stake = 1、分母 = 1', () => {
  const g = mk('GG-GOV-G1'), h = H(g);
  const cap = g.capTable(h, h.corp);
  assert(cap.rows.length === 1, '新局名册应只有 1 条，实得 ' + cap.rows.length);
  assert(cap.rows[0].pid === h.id, '那一条应该是自己');
  near(cap.rows[0].stake, 1, 1e-9, '持股应为 1');
  near(cap.total, 1, 1e-9, '分母应为 1');
});

/* ---------------- G2 提案门槛 ---------------- */
console.log('\nG2 提案门槛：持股 ≥10%');
ok('全资可提；降到 5% 被拒', () => {
  const g = mk('GG-GOV-G2'), h = H(g);
  const r = g.act(h.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  assert(r.ok, '全资股东应能提案：' + r.msg);
  const g2 = mk('GG-GOV-G2B'), h2 = H(g2);
  h2.holdings[0].stake = 0.05;
  const r2 = g2.act(h2.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  assert(!r2.ok, '持股 5% 不该有提案权');
});

/* ---------------- G3 一次只议一件 ---------------- */
console.log('\nG3 在议期间不许再提');
ok('第二件提案被拦，且不产生新记录', () => {
  const g = mk('GG-GOV-G3'), h = H(g);
  g.act(h.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  const n = g.s.decisions.length;
  const r = g.act(h.id, 'propose', { kind: 'dividend', ratio: 0.3 });
  assert(!r.ok, '在议期间再提应被拦');
  assert(g.s.decisions.length === n, '被拦时不该新增记录');
});

/* ---------------- G4 四态分开 ---------------- */
console.log('\nG4 四态必须分得开（这是 §4.14 的核心）');
ok('不表态 → 没人理；同意 → 通过；不同意 → 否决', () => {
  const gA = mk('GG-GOV-G4A'), hA = H(gA);
  gA.act(hA.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  expire(gA);
  assert(lastDec(gA).status === 'nobody', '不表态应判「没人理」，实得 ' + lastDec(gA).status);

  const gB = mk('GG-GOV-G4B'), hB = H(gB);
  gB.act(hB.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  gB.act(hB.id, 'vote', { id: lastDec(gB).id, for: true });
  expire(gB);
  assert(lastDec(gB).status === 'pass', '同意应通过，实得 ' + lastDec(gB).status);

  const gC = mk('GG-GOV-G4C'), hC = H(gC);
  gC.act(hC.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  gC.act(hC.id, 'vote', { id: lastDec(gC).id, for: false });
  expire(gC);
  assert(lastDec(gC).status === 'votedown', '不同意应否决，实得 ' + lastDec(gC).status);
  /* 三态两两不同 —— 把「沉默」当成「否决」是这里最容易犯的错 */
  assert(new Set([lastDec(gA).status, lastDec(gB).status, lastDec(gC).status]).size === 3,
    '三种结果必须互不相同');
});

/* ---------------- G5 分红不涨身价 ---------------- */
console.log('\nG5 分红：钱动了，身价不许动');
ok('通过后现金↓、个人钱包↑、并表身价不变', () => {
  const g = mk('GG-GOV-G5'), h = H(g);
  const nav0 = g.consolidated(h).nav;
  g.act(h.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  g.act(h.id, 'vote', { id: lastDec(g).id, for: true });
  const c0 = h.cash, p0 = h.personal || 0;
  expire(g);
  assert(lastDec(g).status === 'pass', '前提：应通过');
  assert(h.cash < c0, '公司现金应减少（拿出去了）');
  assert((h.personal || 0) > p0, '个人钱包应增加（分到手了）');
  near(g.consolidated(h).nav, nav0, 1e-6, '分红必须不涨身价 —— 否则它就是个印钞旋钮');
  /* 法定公积金：拿出去的应少于“现金 × 比例 → 全发”（少了 10%） */
  const pool = Math.floor(c0 * 0.5);
  assert(c0 - h.cash < pool, '应留下 10% 法定公积金（拿出去的少于 ' + pool + '）');
});

/* ---------------- G6 亏损不得分配 ---------------- */
console.log('\nG6 净资产为负 → 不许分钱（先弥补亏损）');
ok('巨额负债下分红不生效、现金不动', () => {
  const g = mk('GG-GOV-G6'), h = H(g);
  h.debt = 1e9;                     // 净资产被压成负
  assert(g.nav(h) <= 0, '前提：净资产应为负，实得 ' + g.nav(h));
  g.act(h.id, 'propose', { kind: 'dividend', ratio: 0.5 });
  g.act(h.id, 'vote', { id: lastDec(g).id, for: true });
  const c0 = h.cash;
  expire(g);
  assert(h.cash === c0, '净资产为负时分红不该生效（先弥补亏损）');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（股东名册与决议 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
