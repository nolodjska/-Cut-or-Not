/* 公司名录 · 名次 · 主动联系（§4.6 / §4.9）验收测试
 *
 * 背景：玩家要求「公司列表 + 实时排名榜」与「联系 NPC/其他玩家，发出借钱/合资/决策」。
 * 最容易犯的错有三个：
 *   ① 榜用**不同口径**算不同人 ⇒ 名次不可比（假榜）
 *   ② 主动提案**改了状态**（或两边记账不成对）⇒ 仿真里凭空多出钱货
 *   ③ 入股定价算错（按 val×g 而不是 pre/post-money）⇒ 出让方恒亏，或反过来变成印钞
 *
 * 本文件锁 6 条不变量（S1–S6）：
 *   S1 名录：行数 = 存活玩家数、按身价严格降序、名次 1..n 连续、含自己
 *   S2 联系守卫：不能联系自己 / 不存在的人；能发出"借钱"
 *   S3 回话**有延迟**：3 游戏小时内 NPC 不回话；推过之后必须给出结果（不能永远挂着）
 *   S4 借钱成交：两边现金成对、我负债↑、对方 loansOut +1
 *   S5 入股成交：**双方身价都不变**（公允价）+ 我持股↓、对方 stakes +1
 *   S6 入股之后，名册里**真的多出一条**（真·多方名册，不是只有控制人）
 *
 * 用法：node tools/social.test.cjs        # 期望全绿
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
function H(g) { const h = g.s.players.find(p => p.isHuman); if (!h) throw new Error('找不到玩家'); return h; }
function others(g) { return g.s.players.filter(p => !p.isHuman && p.alive); }
function openOut(g) { return (g.s.offers || []).filter(o => o.outbound && o.status === 'open'); }
/* 把时间推过"回话延迟"，再跑一次提案 tick */
function reply(g) { g.s.t += 200; g._offerTick(); }

console.log('=== 公司名录 · 名次 · 主动联系（§4.6/§4.9）验收测试 ===\n');

/* ---------------- S1 名录与名次 ---------------- */
console.log('S1 名录与名次');
ok('行数 = 存活玩家数、严格降序、名次连续、含自己', () => {
  const g = mk('GG-SOC-S1'), h = H(g);
  const rows = g.standings();
  const alive = g.s.players.filter(p => p.alive).length;
  assert(rows.length === alive, '行数应等于存活玩家数（' + rows.length + ' vs ' + alive + '）');
  for (let i = 1; i < rows.length; i++) {
    assert(rows[i - 1].nav >= rows[i].nav, '必须按身价降序（第 ' + i + ' 行乱了）');
  }
  for (let i = 0; i < rows.length; i++) assert(rows[i].rank === i + 1, '名次必须 1..n 连续');
  assert(rows.some(r => r.pid === h.id && r.isHuman), '榜里必须有自己');
  for (const r of rows) assert(typeof r.corpName === 'string' && r.corpName.length, '每行都要有公司名');
});

/* ---------------- S2 联系守卫 ---------------- */
console.log('\nS2 联系守卫');
ok('不能联系自己 / 不存在的人；能发出借钱', () => {
  const g = mk('GG-SOC-S2'), h = H(g), npc = others(g)[0];
  assert(!g.act(h.id, 'contact', { toPid: h.id, kind: 'borrow' }).ok, '不该能联系自己');
  assert(!g.act(h.id, 'contact', { toPid: 'P-nobody', kind: 'borrow' }).ok, '不该能联系不存在的人');
  const r = g.act(h.id, 'contact', { toPid: npc.id, kind: 'borrow' });
  assert(r.ok, '应能发出借钱请求：' + r.msg);
  assert(openOut(g).length === 1, '应有一条在等的提议');
});

/* ---------------- S3 回话有延迟 ---------------- */
console.log('\nS3 回话有延迟，但不会永远挂着');
ok('3 游戏小时内仍开着；推过之后必须给出结果', () => {
  const g = mk('GG-SOC-S3'), h = H(g), npc = others(g)[0];
  npc.cash = 1e6;                              // 前提：他有钱借
  g.act(h.id, 'contact', { toPid: npc.id, kind: 'borrow' });
  g.s.t += 60; g._offerTick();
  assert(openOut(g).length === 1, '1 小时内不该有回音（要让人觉得真的在谈）');
  reply(g);
  assert(openOut(g).length === 0, '推过延迟后必须给出结果，不能一直挂着');
});

/* ---------------- S4 借钱成交，两边成对 ---------------- */
console.log('\nS4 借钱成交：两边成对');
ok('我现金↑ / 负债↑，对方现金↓ / 放出的账 +1', () => {
  const g = mk('GG-SOC-S4'), h = H(g), npc = others(g)[0];
  npc.cash = 50000;
  const c0 = h.cash, d0 = h.debt, n0 = npc.cash, ln0 = npc.loansOut.length;
  const r = g.act(h.id, 'contact', { toPid: npc.id, kind: 'borrow' });
  assert(r.ok, '前提：应能发出');
  const o = openOut(g)[0];
  assert(o && o.amount > 0, '前提：金额应为正');
  reply(g);
  assert(h.cash > c0, '我应拿到钱');
  near(npc.cash, n0 - (h.cash - c0), 1, '两边现金必须成对（一方多多少，另一方少多少）');
  near(h.debt, d0 + (h.cash - c0), 1, '我这边应记等额负债');
  assert(npc.loansOut.length === ln0 + 1, '对方应多一笔放出去的账');
});

/* ---------------- S5 入股：双方身价都不变 ---------------- */
console.log('\nS5 入股不是零和、也不是印钞：按公允价，两边身价都不变');
ok('我持股↓、对方 stakes +1，且双方并表身价都在 1% 内', () => {
  const g = mk('GG-SOC-S5'), h = H(g), npc = others(g)[0];
  npc.cash = 1e6;
  const hv0 = g.consolidated(h).nav, nv0 = g.consolidated(npc).nav;
  const r = g.act(h.id, 'contact', { toPid: npc.id, kind: 'jv', give: 0.2 });
  assert(r.ok, '前提：应能发出入股邀请：' + r.msg);
  reply(g);
  const o = (g.s.offers || [])[0];
  assert(o.status === 'accepted', '前提：他应答应（现金充足且价不吃亏），实得 ' + o.status);
  near(h.holdings[0].stake, 0.8, 1e-6, '我的持股应降到 80%');
  assert((npc.stakes || []).length === 1, '对方名下应多一笔持股');
  near((npc.stakes || [])[0].stake, 0.2, 1e-6, '他应占 20%');
  const hv1 = g.consolidated(h).nav, nv1 = g.consolidated(npc).nav;
  assert(Math.abs(hv1 - hv0) / Math.max(1, Math.abs(hv0)) < 0.01,
    '出让方身价必须基本不变（' + hv0.toFixed(0) + ' → ' + hv1.toFixed(0) + '）');
  assert(Math.abs(nv1 - nv0) / Math.max(1, Math.abs(nv0)) < 0.01,
    '入股方身价也必须基本不变（' + nv0.toFixed(0) + ' → ' + nv1.toFixed(0) + '）');
});

/* ---------------- S6 真·多方名册 ---------------- */
console.log('\nS6 入股之后名册里真的多出一条');
ok('capTable 从 1 条变 2 条，且两条股比相加 = 1', () => {
  const g = mk('GG-SOC-S6'), h = H(g), npc = others(g)[0];
  npc.cash = 1e6;
  const cap0 = g.capTable(h, h.corp);
  assert(cap0.rows.length === 1, '入股前名册应只有控制人一条，实得 ' + cap0.rows.length);
  g.act(h.id, 'contact', { toPid: npc.id, kind: 'jv', give: 0.2 });
  reply(g);
  const cap1 = g.capTable(h, h.corp);
  assert(cap1.rows.length === 2, '入股后名册应有两条，实得 ' + cap1.rows.length);
  const sum = cap1.rows.reduce((a, r) => a + r.stake, 0);
  near(sum, 1, 1e-6, '两条股比相加应等于 100%');
  assert(cap1.rows[0].stake >= cap1.rows[1].stake, '名册应按股比降序');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（名录·名次·主动联系 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
