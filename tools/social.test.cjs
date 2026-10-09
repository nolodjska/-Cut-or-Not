/* 公司名录 · 名次 · 主动联系（§4.6 / §4.9）验收测试
 *
 * 背景：玩家要求「公司列表 + 实时排名榜」与「联系 NPC/其他玩家，发出借钱/合资/决策」。
 * 后续又落了 §4.14 股份转让（含优先购买权）与 §4.11 B 持股门槛。最容易犯的错有四个：
 *   ① 榜用**不同口径**算不同人 ⇒ 名次不可比（假榜）
 *   ② 主动提案**改了状态**（或两边记账不成对）⇒ 仿真里凭空多出钱货
 *   ③ 入股定价算错（按 val×g 而不是 pre/post-money）⇒ 出让方恒亏，或反过来变成印钞
 *   ④ **买卖方向写反**（拿“谁答复”当付款方）⇒ 你买人家的股份，却变成人家付钱给你
 *
 * 本文件锁 10 条不变量（S1–S8，含 S5b）：
 *   S1 名录：行数 = 存活玩家数、按身价严格降序、名次 1..n 连续、含自己
 *   S2 联系守卫：不能联系自己 / 不存在的人；能发出"借钱"
 *   S3 回话**有延迟**：3 游戏小时内 NPC 不回话；推过之后必须给出结果（不能永远挂着）
 *   S4 借钱成交：两边现金成对、我负债↑、对方 loansOut +1
 *   S5 别人买我的股份：**双方身价都不变**（公允价）+ 我持股↓、他 stakes +1
 *   S5b 我买别人的股份：**付款方是我**（方向不许反），双方身价也都不变
 *   S6 入股之后，名册里**真的多出一条**（真·多方名册，不是只有控制人）
 *   S7 优先购买权：向"外人"转让，现有股东可以同价先拿，且第三方白跑一趟会记仇
 *   S8 持股门槛阶梯：多少股 = 什么权（3/5/10/20/30/50/66.7）
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
/* 手造一份“NPC 要买我股份”的提案（等价于 NPC 走 _a_contact 发起 jv）。
   ⚠ 直接调 _settleNew 而不是等 _offerTick 随机选中我 ——
     随机那一层不属于本守卫要锁的东西，用它会让测试变得靠运气。 */
function npcBuyMyStake(g, npc, human, give) {
  const o = {
    i: ++g.s.offersSeq, t: Math.round(g.s.t), from: npc.id, fromName: npc.name,
    to: human.id, kind: 'jv', status: 'open', deadlineT: g.s.t + 1440,
    give, price: Math.round(g.stakePrice(human, give)), outbound: true,
  };
  g.s.offers.push(o);
  return o;
}

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

/* ---------------- S5 别人买我的股份：双方身价都不变 ---------------- */
console.log('\nS5 股份转让不是零和、也不是印钞：按公允价，两边身价都不变');
ok('NPC 买我 20%：他（买方）付钱登股，双方身价都在 1% 内', () => {
  const g = mk('GG-SOC-S5'), h = H(g), npc = others(g)[0];
  npc.cash = 1e6;
  const hv0 = g.consolidated(h).nav, nv0 = g.consolidated(npc).nav;
  const o = npcBuyMyStake(g, npc, h, 0.2);
  const r = g._settleNew(h, o, true);
  assert(r.ok, '前提：应能成交：' + r.msg);
  near(h.holdings[0].stake, 0.8, 1e-6, '卖方持股应降到 80%');
  assert((npc.stakes || []).length === 1, '买方名下应多一笔持股');
  near((npc.stakes || [])[0].stake, 0.2, 1e-6, '买方应占 20%');
  assert((npc.stakes || [])[0].targetPid === h.id, '买方持股的标的应是卖方');
  /* ⚠ 比**字符串**（玩家 id）不能用 near()：Math.abs('P0'-'P0') = NaN，恒失败。 */
  const hv1 = g.consolidated(h).nav, nv1 = g.consolidated(npc).nav;
  assert(Math.abs(hv1 - hv0) / Math.max(1, Math.abs(hv0)) < 0.01,
    '卖方身价必须基本不变（' + hv0.toFixed(0) + ' → ' + hv1.toFixed(0) + '）');
  assert(Math.abs(nv1 - nv0) / Math.max(1, Math.abs(nv0)) < 0.01,
    '买方身价也必须基本不变（' + nv0.toFixed(0) + ' → ' + nv1.toFixed(0) + '）');
});

/* ---------------- S5b 我买 NPC 的股份（方向不能反） ---------------- */
console.log('\nS5b 我买 NPC 的股份：付款方是我，不是他');
ok('我出钱、他公司进钱、我登股，双方身价都在 2% 内', () => {
  const g = mk('GG-SOC-S5B'), h = H(g), npc = others(g)[0];
  h.cash = 1e6;
  const hc0 = h.cash, nc0 = npc.cash;
  const hv0 = g.consolidated(h).nav, nv0 = g.consolidated(npc).nav;
  const r = g.act(h.id, 'contact', { toPid: npc.id, kind: 'jv', give: 0.2 });
  assert(r.ok, '前提：应能发出：' + r.msg);
  reply(g);
  const o = (g.s.offers || [])[0];
  assert(o.status === 'accepted', '前提：他应答应，实得 ' + o.status);
  assert(h.cash < hc0, '**我**应该付钱（方向写反的话这里会红）');
  assert(npc.cash > nc0, '**他**的公司账应该收到钱');
  assert((h.stakes || []).some(st => st.targetPid === npc.id), '我名下应多一笔持股');
  near(npc.holdings[0].stake, 0.8, 1e-6, '他的持股应降到 80%');
  const hv1 = g.consolidated(h).nav, nv1 = g.consolidated(npc).nav;
  const dB = hv1 - hv0, dS = nv1 - nv0;
  /* ⚠ 不变的应该是**总额**（零和、不印钱），不是“两边都不动”：
     卖方公司按**市价**（估值含行当乘数）卖，买方按**账面**（净资产×股比）入账，
     差额就是控制权溢价 ⇒ 卖方账面赚、买方账面亏，两者**恰好相抵**。
     我第一版断言“两边都不变”，那等于要求“溢价不存在”——与 §4.14 A 要的溢价矛盾。 */
  assert(Math.abs(dB + dS) <= Math.max(1, Math.abs(o.price) * 0.01),
    '买卖必须零和（不印钱）：买方 ' + dB.toFixed(0) + ' + 卖方 ' + dS.toFixed(0) + ' 应≈ 0');
  assert(dB <= 1, '买方不该因为这一笔而变富：他付的是溢价（实得 ' + dB.toFixed(0) + '）');
  assert(dS >= -1, '卖方不该因为这一笔而变穷：他是拿股换钱（实得 ' + dS.toFixed(0) + '）');
});

/* ---------------- S7 优先购买权（§4.14 B） ---------------- */
console.log('\nS7 优先购买权：向“外人”转让，其他股东可以同价先拿');
ok('第三方向卖家出价 → 我作为现有股东把股份拿走，他白跑一趟并记仇', () => {
  const g = mk('GG-SOC-S7'), h = H(g);
  const us = others(g);
  const seller = us[0], buyer = us[1];
  assert(!!buyer, '前提：至少要有两个 NPC');
  h.cash = 1e6;
  g.act(h.id, 'contact', { toPid: seller.id, kind: 'jv', give: 0.2 });
  reply(g);
  assert(g.capTable(seller, seller.corp).rows.some(r => r.pid === h.id), '前提：我应已是他的股东');
  const hc0 = h.cash;
  const buyerCash0 = buyer.cash;
  const o = npcBuyMyStake(g, buyer, seller, 0.2);
  const r = g._settleNew(seller, o, true);
  assert(r.ok, '前提：应能处理：' + r.msg);
  assert(o.rofr === h.id, '优先权应由我行使（我是现有股东），实得 ' + o.rofr);
  assert(!(buyer.stakes || []).some(st => st.targetPid === seller.id), '第三方不该拿到股份');
  assert(buyer.cash === buyerCash0, '第三方不该付钱（他白跑一趟）');
  assert(h.cash < hc0, '行权的我应该付钱');
  const mine = (h.stakes || []).filter(st => st.targetPid === seller.id);
  near(mine.reduce((a, st) => a + st.stake, 0), 0.4, 1e-6, '我应共拿到 40%（20% 原有 + 20% 优先权）');
  assert((buyer.memory.grudge[h.id] || 0) >= 1, '白跑一趟的第三方应该把我记仇');
});

/* ---------------- S8 持股门槛阶梯（§4.11 B） ---------------- */
console.log('\nS8 持股门槛阶梯：多少股 = 什么权');
ok('全资含控股与特别决议；买到 55% 时门槛提示往上走', () => {
  const g = mk('GG-SOC-S8'), h = H(g), npc = others(g)[0];
  h.cash = 1e7;
  const r0 = g.rights(h);
  near(r0.stake, 1, 1e-6, '全资时持股应为 1');
  assert(r0.list.some(x => x.indexOf('控股') >= 0), '全资应含“控股”');
  assert(r0.list.some(x => x.indexOf('特别决议') >= 0), '全资应含“特别决议”');
  g.act(h.id, 'contact', { toPid: npc.id, kind: 'jv', give: 0.55 });
  reply(g);
  const r1 = g.rights(h, npc.id);
  near(r1.stake, 0.55, 1e-6, '应持 55%');
  assert(r1.list.some(x => x.indexOf('控股') >= 0), '55% 应含“控股”');
  assert(!r1.list.some(x => x.indexOf('特别决议') >= 0), '55% 不该含“特别决议”');
  assert(r1.next && Math.abs(r1.next.at - 0.667) < 1e-9, '下一道门槛应是 66.7%，实得 ' +
    (r1.next && r1.next.at));
  const r2 = g.rights(npc, h.id);
  near(r2.stake, 0, 1e-6, '没持股的人应该是 0');
  assert(r2.list.length === 0, '没持股就不该有任何权利');
  assert(r2.next && Math.abs(r2.next.at - 0.03) < 1e-9, '第一道门槛应是 3%');
});

/* ---------------- S6 真·多方名册（我有别人公司的股份 ⇒ **他的**名册里多一条） ---------------- */
console.log('\nS6 入股之后，对方的名册里真的多出一条');
ok('他的 capTable 从 1 条变 2 条、含我这条，且股比相加 = 1', () => {
  const g = mk('GG-SOC-S6'), h = H(g), npc = others(g)[0];
  h.cash = 1e6;
  /* ⚠ 我买的是**他的**公司 ⇒ 要看**他的**名册。
     我第一版查了自己的名册（当然还是 1 条）—— 测错了对象。 */
  const cap0 = g.capTable(npc, npc.corp);
  assert(cap0.rows.length === 1, '入股前他的名册应只有控制人一条，实得 ' + cap0.rows.length);
  g.act(h.id, 'contact', { toPid: npc.id, kind: 'jv', give: 0.2 });
  reply(g);
  const cap1 = g.capTable(npc, npc.corp);
  assert(cap1.rows.length === 2, '入股后他的名册应有两条，实得 ' + cap1.rows.length);
  assert(cap1.rows.some(r => r.pid === h.id), '名册里应有我这条');
  const sum = cap1.rows.reduce((a, r) => a + r.stake, 0);
  near(sum, 1, 1e-6, '两条股比相加应等于 100%');
  assert(cap1.rows[0].stake >= cap1.rows[1].stake, '名册应按股比降序');
});

/* ---------------- S9 随售权（tag-along，§4·14 C） ---------------- */
console.log('\nS9 随售权：大股东易主时，小股东收到“同价一起卖”的邀约，可以跟也可以留');
ok('玩家小股东：连收两次“跟卖”，都跟 ⇒ 持股清零、卖方公司账进钱、不超过买方现金', () => {
  const g = mk('GG-SOC-S9'), h = H(g), seller = others(g)[0], buyer = others(g)[1];
  assert(!!buyer, '前提：至少两个 NPC');
  h.cash = 1e6; buyer.cash = 1e7; seller.cash = 1e6;
  /* ① 我先买下 seller 公司 20%（成为小股东，走正经链路） */
  g.act(h.id, 'contact', { toPid: seller.id, kind: 'jv', give: 0.2 });
  reply(g);
  assert((h.stakes || []).some(st => st.targetPid === seller.id), '前提：我应先持有 20%');
  /* ② 另一个 NPC（买家）来收 seller 的控制权：80% ⇒ 超过 50% ⇒ 触发随售 */
  const o = npcBuyMyStake(g, buyer, seller, 0.2);   // 先只买 20%（不足 50%）——不会触发
  g._settleNew(seller, o, true);
  assert(!o.tag, '卖方没失去控制权时，不该发随售邀约（我这条断言锁“触发条件”）');
  /* ③ 买家再买 55% ⇒ seller 持股 0.8-0.55=0.25 <0.5 ⇒ 易主 ⇒ 我收到随售邀约 */
  const o2 = npcBuyMyStake(g, buyer, seller, 0.55);
  const mineBefore = (h.holdings || []).find(x => x.corpId === h.corp);
  const sellerCash0 = seller.cash;
  g._settleNew(seller, o2, true);
  assert(o2.tag && o2.tag.kind === 'tag', '易主时应给小股东发一份 tag 邀约');
  assert(o2.tag.to === h.id, '邀约应发给玩家（小股东）');
  const fair = o2.tag.price;
  /* ④ 我接受 ⇒ 走 _decideOffer（真实入口，不是直接调 _settleTag） */
  const r = g._decideOffer(h, o2.tag.i, true);
  assert(r.ok, '接受随售应成交：' + r.msg);
  assert(o2.tag.status === 'accepted', 'tag 邀约状态应为 accepted');
  assert(seller.cash > sellerCash0, '卖方**公司账**应收到钱（同一条口径，不进老板口袋）');
  /* ⚠ 我是**小股东/卖方** ⇒ 我的 stakes 里这家应被划走；`via:'tag'` 那条记在**买方**名下。
     我第一版在两个对象上搞反了（去查自己 stakes 里有没有 via:tag）。 */
  assert(!(h.stakes || []).some(st => st.targetPid === seller.id), '我（小股东）的持股应被划走');
  assert((buyer.stakes || []).some(st => st.targetPid === seller.id && st.via === 'tag'),
    '买方 stakes 里应记录这笔 via:tag 的过户');
  /* ⑤ 拒绝分支见下一个用例（另开一局）。 */
});

ok('我可以选择“留”：拒绝随售 ⇒ 状态 declined、持股一分不动', () => {
  const g = mk('GG-SOC-S9B'), h = H(g), seller = others(g)[0], buyer = others(g)[1];
  h.cash = 1e6; buyer.cash = 1e7; seller.cash = 1e6;
  g.act(h.id, 'contact', { toPid: seller.id, kind: 'jv', give: 0.2 });
  reply(g);
  const o = npcBuyMyStake(g, buyer, seller, 0.55);
  g._settleNew(seller, o, true);
  assert(o.tag, '前提：应收到 tag 邀约');
  const mine0 = (h.stakes || []).filter(st => st.targetPid === seller.id)
    .reduce((a, st) => a + st.stake, 0);
  g._decideOffer(h, o.tag.i, false);
  const mine1 = (h.stakes || []).filter(st => st.targetPid === seller.id)
    .reduce((a, st) => a + st.stake, 0);
  near(mine1, mine0, 1e-9, '拒绝后持股必须一分不动');
  assert(o.tag.status === 'declined', 'tag 邀约状态应为 declined');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（名录·名次·主动联系·转让·门槛·随售 12 条不变量）'));
process.exit(errs.length ? 1 : 0);
