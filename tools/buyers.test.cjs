/* 上门的买家（§17.2 第 2 撞）验收测试 —— 清单 1.2
 *
 * docs/13 §17.4 说第 2 撞的处境是「**第一次有货但卖不动**」→ 货压手里 → 有人主动上门。
 * 界面目的：「让玩家第一次感觉到**市场不是背景，是有人在外面等我**」。
 *
 * 锁的 10 条：
 *   B1 三类人的脾气差价分明（街坊 < 市价；作坊主 ≥ 市价；豪客最高）
 *   B2 报价是**纯函数** —— 连调两次必须逐位相同（§17.0 判据 3：不能有玩家看不到的原因）
 *   B3 【关键】**不动主 RNG 流** —— 否则每帧渲染都会扰动全局序列，660 局复现全废
 *   B4 「吃腻了」：今天卖他越多，他出价越低
 *   B5 「回头客」：见过 3 次后出价更高（这 5% 就是 brand 终于长出的可见形态）
 *   B6 豪客只来一次
 *   B7 **卖给他不砸价**（货离开世界，price / mmInv 都不动）—— 这是「上门更好」的真正来源
 *   B8 归因句格式正确 + **零术语**（§17.2 明令：需求曲线/价格弹性/派生需求/边际消费倾向/饱和/需求侧）
 *   B9 手里没货 → 没人来
 *   B10 每日总量上限生效（防印钱机）
 *
 * 用法：node tools/buyers.test.cjs      # 期望全绿
 */
const GG = require('../game/engine.js');

const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function mk(seed) { return new GG.Game({ seed: seed, corp: 'grow', npcs: 3, secPerGameHour: 8 }); }
function H(g) { const h = g.s.players.find(p => p.isHuman); if (!h) throw new Error('找不到玩家'); return h; }

/* 挑一个「他确实来了」的日子 —— buyerRoll 随游戏日变，所以扫几天必然扫到。
   这样测的是真实路径（含"来不来"那道闸），而不是把它绕过去。 */
function anyOffer(g, p, type, maxDay) {
  for (let d = 0; d < (maxDay || 60); d++) {
    g.s.t = d * 1440;
    const o = g.buyerOffer(p, type);
    if (o) return o;
  }
  return null;
}
function stock(h) { h.storage = { radish: 400, chili: 300, ginseng: 200 }; }

console.log('=== 上门的买家（§17.2 第 2 撞）验收测试 ===\n');

/* ---------------- B1 三类人的脾气 ---------------- */
console.log('B1 三类人的脾气差价分明');
ok('街坊 < 市价；作坊主 ≥ 市价；豪客最高', () => {
  const g = mk('GG-BUYER-B1'), h = H(g);
  stock(h);
  const o = {};
  for (const t of ['hood', 'workshop', 'tycoon']) {
    o[t] = anyOffer(g, h, t);
    assert(o[t], '前提：扫了 60 天也该遇到 ' + t);
  }
  assert(o.hood.price < g.good(o.hood.cid).price, '街坊应出低于市价的价（他"只认便宜货"）');
  assert(o.workshop.price >= g.good(o.workshop.cid).price * 1.0, '作坊主应出不低于市价的价（他"贵也得买"）');
  assert(o.tycoon.price > o.workshop.price, '豪客出价应最高：豪客 ' + o.tycoon.price + ' vs 作坊主 ' + o.workshop.price);
  assert(o.hood.price < o.workshop.price, '街坊应低于作坊主');
});

/* ---------------- B2 报价是纯函数 ---------------- */
console.log('\nB2 报价是纯函数（§17.0 判据 3）');
ok('同一状态连调两次，结果逐位相同', () => {
  const g = mk('GG-BUYER-B2'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'workshop');
  assert(o, '前提：应找到一次来访');
  const a = JSON.stringify(g.buyerOffer(h, 'workshop'));
  const b = JSON.stringify(g.buyerOffer(h, 'workshop'));
  assert(a === b, '两次调用结果必须一致：' + a + ' vs ' + b);
});

/* ---------------- B3 不动主 RNG 流（最关键） ---------------- */
console.log('\nB3 绝不动主 RNG 流（否则 660 局复现全废）');
ok('连调 50 次报价后，主随机序列与未调用的对照组逐位相同', () => {
  const g1 = mk('GG-BUYER-B3'), g2 = mk('GG-BUYER-B3');
  const h1 = H(g1), h2 = H(g2);
  stock(h1); stock(h2);
  for (let i = 0; i < 50; i++) g1.buyerOffer(h1, 'hood');
  const a = [], b = [];
  for (let i = 0; i < 20; i++) a.push(g1.rng.main.next());
  for (let i = 0; i < 20; i++) b.push(g2.rng.main.next());
  assert(JSON.stringify(a) === JSON.stringify(b),
    '主序列被扰动了：调用组 ' + a.slice(0, 3) + ' vs 对照组 ' + b.slice(0, 3));
});

/* ---------------- B4 吃腻了 ---------------- */
console.log('\nB4「吃腻了」：今天卖他越多，他出价越低');
ok('boughtToday 从 0 → 60，出价必须下降', () => {
  const g = mk('GG-BUYER-B4'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'hood');
  assert(o, '前提：应找到一次来访');
  const day = Math.floor(g.s.t / 1440), b = h.buyers.hood;
  b.met = 0; b.day = day; b.boughtToday = 0; b.refusedDay = -1;
  const p0 = g.buyerOffer(h, 'hood').price;
  b.boughtToday = 60;
  const p1 = g.buyerOffer(h, 'hood').price;
  assert(p1 < p0, '卖他 60 单位后出价必须下降：' + p0 + ' → ' + p1);
  /* 顺手校验回吐率是否与 docs/13 §17.2 的例子对得上（60 单位 → 约 0.928 倍） */
  const ratio = p1 / p0;
  assert(Math.abs(ratio - 0.928) < 0.01, '回吐比例应≈0.928（§17.2 的 8.2 例子），实得 ' + ratio.toFixed(4));
});

/* ---------------- B5 回头客 ---------------- */
console.log('\nB5「回头客」：见过 3 次后出价更高（brand 的可见形态）');
ok('met 0 → 3，出价必须上升约 5%', () => {
  const g = mk('GG-BUYER-B5'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'workshop');
  assert(o, '前提：应找到一次来访');
  const day = Math.floor(g.s.t / 1440), b = h.buyers.workshop;
  b.day = day; b.boughtToday = 0; b.refusedDay = -1;
  b.met = 0; const p0 = g.buyerOffer(h, 'workshop').price;
  b.met = 3; const p1 = g.buyerOffer(h, 'workshop').price;
  assert(p1 > p0, '回头客出价必须更高：' + p0 + ' → ' + p1);
  assert(Math.abs(p1 / p0 - GG.BAL.buyerRegularBonus) < 0.02, '应≈' + GG.BAL.buyerRegularBonus + '，实得 ' + (p1 / p0).toFixed(4));
});

/* ---------------- B6 豪客只来一次 ---------------- */
console.log('\nB6 豪客只来一次');
ok('used = true 之后，豪客不再出现', () => {
  const g = mk('GG-BUYER-B6'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'tycoon');
  assert(o, '前提：应找到豪客来访');
  const before = g.buyerOffer(h, 'tycoon');
  assert(before, '前提：此刻应还在');
  const r = g._a_sellTo(h, { type: 'tycoon' });
  assert(r.ok, '前提：这一单应成功（' + (r.msg || '') + '）');
  g.s.t += 1440;
  assert(g.buyerOffer(h, 'tycoon') === null, '卖过之后豪客不应再来');
});

/* ---------------- B7 卖给他不砸价 ---------------- */
console.log('\nB7 卖给他不砸价（「上门更好」的真正来源）');
ok('成交后 price 与 mmInv 都不变', () => {
  const g = mk('GG-BUYER-B7'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'workshop');
  assert(o, '前提：应找到一次来访');
  const c = g.good(o.cid);
  const price0 = c.price, inv0 = c.mmInv, cash0 = h.cash, held0 = h.storage[o.cid] || 0;
  const before = g.quote(h, o.cid, o.qty, 'sell');
  const r = g._a_sellTo(h, { type: 'workshop' });
  assert(r.ok, '成交应成功（' + (r.msg || '') + '）');
  assert(c.price === price0, '行价不该动：' + price0 + ' → ' + c.price);
  assert(c.mmInv === inv0, '市场库存不该动：' + inv0 + ' → ' + c.mmInv);
  assert(h.cash > cash0, '现金应增加');
  assert((h.storage[o.cid] || 0) === held0 - o.qty, '货应正好少了 ' + o.qty + ' 单位');
  /* 与砸盘对照：同样的量砸到市场上，均价会更低 —— 这才解释得了"上门更好" */
  assert(before && typeof before.avgPrice === 'number',
    '前提：应能拿到砸盘的均价做对照');
  console.log('     对照：同样 ' + o.qty + ' 单位砸盘均价 ' + before.avgPrice.toFixed(3) +
    '（滑点 ' + before.impactPct.toFixed(2) + '%） · 他出 ' + o.price + '（且不砸价）');
});

/* ---------------- B8 归因句 + 零术语 ---------------- */
console.log('\nB8 归因句格式正确，且零术语');
ok('含「今天已经买了」+「再卖他」，且不含任何术语', () => {
  const g = mk('GG-BUYER-B8'), h = H(g);
  stock(h);
  const o = anyOffer(g, h, 'hood');
  assert(o, '前提：应找到一次来访');
  g._a_sellTo(h, { type: 'hood' });
  const tail = JSON.stringify((g.s.feed || []).slice(-4));
  assert(/今天已经买了/.test(tail), '应有归因句「今天已经买了」：' + tail);
  assert(/再卖他/.test(tail), '归因句应含「再卖他」：' + tail);
  const BANNED = /需求曲线|价格弹性|派生需求|边际消费倾向|饱和|需求侧/;
  assert(!BANNED.test(tail), '§17.2 明令禁词出现在玩家可见文案里：' + tail);
});

/* ---------------- B9 手里没货 ---------------- */
console.log('\nB9 手里没货 → 没人来');
ok('storage 清空后，三个人都不出现', () => {
  const g = mk('GG-BUYER-B9'), h = H(g);
  h.storage = {};
  for (let d = 0; d < 30; d++) {
    g.s.t = d * 1440;
    for (const t of ['hood', 'workshop', 'tycoon']) {
      assert(g.buyerOffer(h, t) === null, '没货时 ' + t + ' 不该来');
    }
  }
});

/* ---------------- B10 每日上限 ---------------- */
console.log('\nB10 每日总量上限生效（防印钱机）');
ok('手里的货远超上限时，他一次最多只买 cap+成长 那么多', () => {
  const g = mk('GG-BUYER-B10'), h = H(g);
  h.storage = { radish: 99999 };
  g.s.t = 0;
  const o = anyOffer(g, h, 'hood', 5);
  assert(o, '前提：应找到一次来访');
  const day = Math.floor(g.s.t / 1440);
  const cap = Math.floor(GG.BAL.buyers.hood.cap + GG.BAL.buyers.hood.growPerDay * day);
  assert(o.qty === cap, '第 ' + day + ' 天应正好是上限 ' + cap + '，实得 ' + o.qty);
  assert(o.qty < 99999, '必须有上限，绝不能让他把 99999 单位全买了');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（上门的买家 10 条不变量）'));
process.exit(errs.length ? 1 : 0);
