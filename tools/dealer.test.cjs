/* 收货商（§17.1 第 1 撞）验收测试 —— 清单 1.1
 *
 * 为什么单独一个文件：docs/13 §17.4 说「**第 1 撞是全局成败点**（08 §2.4）」。
 * 这么关键的东西不能只靠手感，必须有可执行的不变量锁住。
 *
 * 锁的 8 条：
 *   D1 牌子上的数字 = 日吸纳 − 当日已收，且随卖出**当场**减少（判据 1 当场可见）
 *   D2 收满后价格冲击放大 = BAL.dealerFullMult
 *   D3 **收满后仍必须能卖** —— 拒绝会把「有货卖不掉 + 缺现金」变成死局
 *   D4 归因句格式正确，且**零术语**（§17.1 明令：做市商/库存偏离/保留价/逆向选择/流动性/mmInv/报价价差）
 *   D5 归因句**只发给玩家**（NPC 每 30 分钟卖一笔，给他们也发会直接洗版）
 *   D6 日切后胃口回满（牌子从「收满了」变回「今日还收 N 单位」）
 *   D7 **成品不受影响** —— 收货商 = 产地收购站/粮商，收的是作物；成品走 §17.2
 *   D8 【判据 3 的精髓】**他改价的原因必须能从玩家可见状态推出**
 *
 * 用法：node tools/dealer.test.cjs      # 期望全绿
 */
const GG = require('../game/engine.js');

const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function near(a, b, eps, msg) {
  if (!(Math.abs(a - b) <= (eps == null ? 1e-9 : eps))) throw new Error((msg || '') + ' 期望 ' + b + '，实得 ' + a);
}
function mk(seed, sph) { return new GG.Game({ seed: seed, corp: 'grow', npcs: 3, secPerGameHour: sph || 8 }); }
function H(g) { const h = g.s.players.find(p => p.isHuman); if (!h) throw new Error('找不到玩家'); return h; }
function feedTail(g, n) { return JSON.stringify((g.s.feed || []).slice(-(n || 4))); }

console.log('=== 收货商（§17.1 第 1 撞）验收测试 ===\n');

/* ---------------- D1 牌子数字当场可见 ---------------- */
console.log('D1 牌子数字 = 日吸纳 − 当日已收，且随卖出当场减少');
ok('卖出 100 单位萝卜后，当日已收 = 100', () => {
  const g = mk('GG-DEALER-D1'), h = H(g);
  assert(g.s.crops.radish.absorbDay === 800, '前提：萝卜的日吸纳量应为 800');
  /* ⚠ 2026-10-08 改口径：额度**按玩家计**（原先全市场口径会让 NPC 把牌子吃光） */
  assert(g.dealerQuota('radish') === 80, '萝卜额度应 = absorbDay×0.10 = 80，实得 ' + g.dealerQuota('radish'));
  h.storage.radish = 500;
  h.cash = 5000;
  const r = g._a_sell(h, { crop: 'radish', qty: 100 });
  assert(r.ok, '前提：这笔卖出应成功（' + (r.msg || '') + '）');
  assert(g.dealerSoldToday(h, 'radish') === 100,
    '你自己卖了 100 就应记 100（不看 NPC），实得 ' + g.dealerSoldToday(h, 'radish'));
});

/* ---------------- D2 收满放大 ---------------- */
console.log('\nD2 收满后价格冲击放大 = BAL.dealerFullMult');
ok('冲击倍数精确等于 dealerFullMult', () => {
  const g = mk('GG-DEALER-D2'), h = H(g);
  h.dealerSoldDay = Math.floor(g.s.t / 1440);
  h.dealerSold = { radish: 0 };
  const i1 = g._impact(h, 'radish', 50, 'sell');
  h.dealerSold.radish = g.dealerQuota('radish');       // 刚好收满
  const i2 = g._impact(h, 'radish', 50, 'sell');
  assert(i1 > 0, '前提：未收满时冲击应为正');
  near(i2 / i1, GG.BAL.dealerFullMult, 1e-9, '收满后的冲击倍数');
});

/* ---------------- D3 收满后仍能卖（防死局） ---------------- */
console.log('\nD3 收满后仍必须能卖 —— 拒绝会让玩家被锁死');
ok('收满 3 倍之后，卖出依然成功且真的拿到钱', () => {
  const g = mk('GG-DEALER-D3'), h = H(g);
  h.dealerSoldDay = Math.floor(g.s.t / 1440);
  h.dealerSold = { radish: g.dealerQuota('radish') * 3 };
  h.storage.radish = 50;
  h.cash = 100;
  const r = g._a_sell(h, { crop: 'radish', qty: 50 });
  assert(r.ok, '收满后仍必须能卖（否则「有货卖不掉又缺现金」= 死局）：' + (r.msg || ''));
  assert(h.cash > 100, '卖出必须真的拿到钱，现金 ' + h.cash);
  assert((h.storage.radish || 0) === 0, '货应已卖出');
});

/* ---------------- D4 归因句 + 零术语 ---------------- */
console.log('\nD4 归因句格式正确，且零术语');
ok('归因句含「老赵压到」+ 牌子状态，且不含任何术语', () => {
  const g = mk('GG-DEALER-D4'), h = H(g);
  h.dealerSoldDay = Math.floor(g.s.t / 1440);
  h.dealerSold = { radish: 0 };
  h.storage.radish = 500;
  g._a_sell(h, { crop: 'radish', qty: 100 });
  const tail = feedTail(g, 5);
  assert(/老赵压到/.test(tail), '应有归因句「老赵压到」：' + tail);
  assert(/今天还能收|他今天收够了/.test(tail), '归因句应带上牌子状态：' + tail);
  const BANNED = /做市商|库存偏离|保留价|逆向选择|流动性|mmInv|报价价差/;
  assert(!BANNED.test(tail), '§17.1 明令禁词出现在玩家可见文案里：' + tail);
});

/* ---------------- D5 归因句只发给玩家 ---------------- */
console.log('\nD5 归因句只发给玩家（防 NPC 洗版）');
ok('NPC 卖出时不得产生归因句', () => {
  const g = mk('GG-DEALER-D5'), h = H(g);
  const npc = g.s.players.find(p => !p.isHuman && p.alive);
  assert(npc, '前提：应存在存活的 NPC');
  npc.storage.radish = 200;
  const before = (g.s.feed || []).length;
  g._a_sell(npc, { crop: 'radish', qty: 30 });
  const added = (g.s.feed || []).slice(before).map(x => JSON.stringify(x)).join('');
  assert(!/老赵压到/.test(added), 'NPC 卖出不该发归因句（每 30 分钟一笔会洗版）：' + added);
});

/* ---------------- D6 日切恢复 ---------------- */
console.log('\nD6 日切后额度归零（牌子从「今天收够了」变回「今天还能收 N 单位」）');
ok('跨过一个游戏日后，你自己的当日额度归零', () => {
  /* secPerGameHour = 0.2 → 1 游戏日 = 24 × 0.2 = 4.8 真实秒。
     故意走 advanceReal（公开 API），与 tools/sim.cjs 的口径一致。 */
  const g = mk('GG-DEALER-D6', 0.2), h = H(g);
  const t0 = g.s.t;
  h.dealerSoldDay = Math.floor(t0 / 1440);
  h.dealerSold = { radish: g.dealerQuota('radish') };
  assert(g.dealerSoldToday(h, 'radish') > 0, '前提：当天应已记上卖出量');
  g.advanceReal(7);
  assert(g.s.t > t0 + 1440, '前提：时间应推进超过 1 天（t0=' + t0 + '，t=' + g.s.t + '）');
  assert(g.dealerSoldToday(h, 'radish') === 0, '日切后额度应归零（牌子回满）');
});

/* ---------------- D7 成品不受影响 ---------------- */
console.log('\nD7 成品不受收货商影响（成品走 §17.2 上门的买家）');
ok('把成品标成收满，冲击一点不变', () => {
  const g = mk('GG-DEALER-D7'), h = H(g);
  const pid = GG.PRODUCT_IDS[0];
  /* 成品：dealerQuota 恒为 0 → 永远不可能“收满” */
  assert(g.dealerQuota(pid) === 0, '成品的收货商额度必须是 0');
  h.dealerSoldDay = Math.floor(g.s.t / 1440);
  const i0 = g._impact(h, pid, 10, 'sell');
  h.dealerSold = { [pid]: 99999 };
  const i1 = g._impact(h, pid, 10, 'sell');
  near(i1, i0, 1e-12, '成品不该受收货商收满影响');
});

/* ---------------- D8 判据 3 的精髓：不能有玩家看不到的原因 ---------------- */
console.log('\nD8【§17.0 判据 3 精髓】他改价的原因必须能从玩家可见状态推出');
ok('同样的可见状态必须给出同样的价；且卖得越多冲击越大', () => {
  const g = mk('GG-DEALER-D8'), h = H(g);
  h.dealerSoldDay = Math.floor(g.s.t / 1440);
  h.dealerSold = { radish: 0 };
  const a = g._impact(h, 'radish', 100, 'sell');
  const b = g._impact(h, 'radish', 100, 'sell');
  near(a, b, 1e-12, '同样的可见状态必须给出同样的价 —— 否则玩家学到的是「这游戏随机」');
  const small = g._impact(h, 'radish', 10, 'sell');
  const big = g._impact(h, 'radish', 200, 'sell');
  assert(big > small, '卖得越多冲击必须越大（§17.0 判据 2 要有方向感）');
  h.dealerSold.radish = g.dealerQuota('radish');
  const full = g._impact(h, 'radish', 10, 'sell');
  assert(full > small, '收满后同样的量必须更吃亏（玩家可见的原因：他今天收够了）');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（收货商 8 条不变量）'));
process.exit(errs.length ? 1 : 0);
