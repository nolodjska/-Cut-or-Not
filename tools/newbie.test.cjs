/* 新手主线体检 —— 2026-10-08 试玩员实测触发的新体检
 *
 * 试玩员原话：「我玩了整整一局，什么都没做错（就是种→收→卖这一条主线），
 *             结果净资产反而变少了（10,000 → 9,577）。」
 *
 * 这是**漏斗杀手**：新手按引导走一遍却不赚钱，后面所有设计都不用谈了
 * （docs/08 §2.4「前 5 分钟决定成败」、docs/13 §17.4）。
 *
 * 两种口径都跑：
 *   ① 单轮 —— 种满 → 熟 → 一键收割 → 全卖（对应"前 5 分钟"）
 *   ② 三轮 —— 重复三次（对应试玩员实际玩的 3 天局，因为多轮才能看出价格漂移的影响）
 *
 * 用法：node tools/newbie.test.cjs
 */
const GG = require('../game/engine.js');

function H(g) { return g.s.players.find(p => p.isHuman); }
/* 手上家底 = 现金 + 库存按现价估值（新手最直观的「我赚了没有」口径） */
function purse(g, h) {
  let v = 0;
  for (const cid of Object.keys(h.storage)) v += (h.storage[cid] || 0) * g.valuePrice(cid);
  return h.cash + v;
}
function mk(seed) { return new GG.Game({ seed: seed, corp: 'grow', npcs: 8, secPerGameHour: 8 }); }

/** 走一轮完整主线，返回这一轮的净变化 */
function cycle(g, h, cid) {
  const hid = g.s.humanId;
  const p0 = purse(g, h), c0 = h.cash;
  g.act(hid, 'plantAll', { crop: cid });
  const seedSpent = c0 - h.cash;
  const need = g.s.crops[cid].growH * 60;
  const t0 = g.s.t;
  for (let i = 0; i < 4000 && g.s.t < t0 + need + 5; i++) g.advanceReal(1);
  g.act(hid, 'harvestAll');
  const got = h.storage[cid] || 0;
  const pxBefore = g.good(cid).price;
  const r = g.act(hid, 'sell', { crop: cid, qty: got });
  const pxAfter = g.good(cid).price;
  return { d: purse(g, h) - p0, seedSpent, got, pxBefore, pxAfter, ok: r.ok, msg: r.msg };
}

const SEEDS = ['GG-NEWBIE-1', 'GG-NEWBIE-2', 'GG-NEWBIE-3', 'GG-NEWBIE-4', 'GG-NEWBIE-5'];

/* ---------- ① 单轮：前 5 分钟 ---------- */
console.log('=== 新手主线体检 ① 单轮（种满萝卜 → 熟 → 收 → 全卖）===\n');
let oneAvg = 0, oneWin = 0;
for (const sd of SEEDS) {
  const g = mk(sd), h = H(g);
  const p0 = purse(g, h);
  const x = cycle(g, h, 'radish');
  oneAvg += x.d; if (x.d > 0) oneWin++;
  console.log(`${sd}  种子花 ${Math.round(x.seedSpent)} · 收到 ${x.got} 萝卜 · ` +
    `行价 ${x.pxBefore.toFixed(2)}→${x.pxAfter.toFixed(2)} · 手上家底 ${Math.round(p0)}→${Math.round(purse(g, h))} ` +
    `(${x.d >= 0 ? '+' : ''}${Math.round(x.d)})` + (x.ok ? '' : '  ⚠ 卖出失败：' + x.msg));
}
oneAvg /= SEEDS.length;
console.log(`\n单轮：跑赢 ${oneWin}/${SEEDS.length}　平均 ${oneAvg >= 0 ? '+' : ''}${Math.round(oneAvg)}`);

/* ---------- ② 三轮：3 天局 ---------- */
console.log('\n=== 新手主线体检 ② 三轮（模拟试玩员的 3 天局）===\n');
let threeAvg = 0, threeWin = 0;
for (const sd of SEEDS) {
  const g = mk(sd), h = H(g);
  const p0 = purse(g, h);
  const ds = [];
  for (let k = 0; k < 3; k++) ds.push(cycle(g, h, 'radish'));
  const d = purse(g, h) - p0;
  threeAvg += d; if (d > 0) threeWin++;
  console.log(`${sd}  三轮分别 ${ds.map(x => (x.d >= 0 ? '+' : '') + Math.round(x.d)).join(' / ')} · ` +
    `行价 ${ds[0].pxBefore.toFixed(2)}→${ds[2].pxAfter.toFixed(2)} · 合计 ${d >= 0 ? '+' : ''}${Math.round(d)}`);
}
threeAvg /= SEEDS.length;
console.log(`\n三轮：跑赢 ${threeWin}/${SEEDS.length}　平均 ${threeAvg >= 0 ? '+' : ''}${Math.round(threeAvg)}`);

/* 期望：新手走完主线必须**不亏**。不设更高门槛（真实上限要靠经营技巧），
   只锁底线：引导路径不能把人教成"越玩越穷"。 */
const pass = oneAvg > 0 && threeAvg > 0;
console.log('\n' + (pass
  ? '✅ 主线是赚的（单轮 + 三轮都为正）—— 新手按引导走会变富'
  : '❌ 主线在亏 —— 新手什么都不做错却变穷，这是漏斗杀手'));
process.exit(pass ? 0 : 1);
