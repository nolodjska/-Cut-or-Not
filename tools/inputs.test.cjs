/* 投入品层（INPUTS）验收测试 —— docs/19 §4.15 的落地守卫
 *
 * 背景：市场原来只有 3 作物 + 3 加工品，种子是"点一下种地就自动扣钱"。
 * §4.15 要求：种子与农资**要在市场买**、只能买不能卖、有牌价不浮动。
 *
 * 本文件锁 6 条不变量（I1–I6）：
 *   I1 新局有 inputs 容器：6 条、牌价 = base、不浮动、twap 有值（防空值传染）
 *   I2 买入：扣现金、入库、均价对、有手续费；**牌价不受影响**（买不涨价）
 *   I3 只能买不能卖：sell 被明确拒绝（不是静默失败）
 *   I4 播种耗种：库存 −1，且**不再重复扣种子钱**（防双重收费）
 *   I5 手头没种时播种：自动补一包，仍能种下（保住新手第一分钟）
 *   I6 旧存档兼容：没有 inputs 容器时不崩、且走回"播种扣现金"的老路径
 *
 * 用法：node tools/inputs.test.cjs        # 期望全绿
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
  const g = new GG.Game({ seed: seed, corp: corp || 'trade', npcs: 3, secPerGameHour: 8 });
  g.s.rules.doubleLandRent = false;   // 固定住，免得随机规则把账搅乱
  return g;
}
function H(g) {
  const h = g.s.players.find(p => p.isHuman);
  if (!h) throw new Error('找不到玩家');
  return h;
}

console.log('=== 投入品层（INPUTS）验收测试 ===\n');

/* ---------------- I1 容器与牌价 ---------------- */
console.log('I1 新局的投入品容器');
ok('6 条、牌价 = base、不浮动、twap 有值', () => {
  const g = mk('GG-IN-I1'), s = g.s;
  assert(s.inputs && typeof s.inputs === 'object', 's.inputs 没建起来');
  assert(GG.INPUT_IDS.length === 6, '应有 6 条投入品，实得 ' + GG.INPUT_IDS.length);
  for (const id of GG.INPUT_IDS) {
    const it = s.inputs[id];
    assert(it, '缺 ' + id);
    assert(it.price === it.base && it.twap === it.base && it.anchor === it.base,
      id + ' 的牌价/估值应恒等于 base（实得 ' + it.price + '/' + it.twap + '）');
    assert(it.hasSpot === false, id + ' 不该参与现货浮动');
    assert(typeof it.twap === 'number' && isFinite(it.twap), id + ' 的 twap 必须是有限数（否则 NAV 会被 NaN 污染）');
  }
  /* 种子与作物必须同价：两处数字漂移是本项目犯过的错 */
  for (const c of GG.CROPS) {
    near(s.inputs['seed_' + c.id].base, c.seed, 1e-9, '种子牌价应等于 CROPS[c].seed（单一事实来源）');
  }
});

/* ---------------- I2 买入 ---------------- */
console.log('\nI2 买入：扣钱、入库、不涨价');
ok('买 3 包种子：现金按 牌价×(1+费率) 减少，库存 +3，作物/种子价都不变', () => {
  const g = mk('GG-IN-I2'), h = H(g);
  const id = 'seed_radish';
  const px0 = g.s.inputs[id].price;
  const cropPx0 = g.s.crops.radish.price;
  const c0 = h.cash, s0 = h.storage[id] || 0;
  const r = g.buy(h, id, 3);
  assert(r.ok, '买入应成功：' + r.msg);
  assert((h.storage[id] || 0) === s0 + 3, '库存应 +3');
  assert(h.cash < c0, '现金应减少');
  assert(Math.abs((c0 - h.cash) - 3 * px0) < 3 * px0 * 0.05, '现金减少额应约等于 3×牌价（加少量手续费）');
  assert(g.s.inputs[id].price === px0, '买投入品**不该**把它的价推高（它是牌价）');
  assert(g.s.crops.radish.price === cropPx0, '买种子也不该影响作物行价');
  near(h.avgCost[id].q, s0 + 3, 1e-9, '均价簿的数量应同步');
});

/* ---------------- I3 只能买不能卖 ---------------- */
console.log('\nI3 只能买、不能卖');
ok('卖出投入品被明确拒绝（不是静默失败）', () => {
  const g = mk('GG-IN-I3'), h = H(g);
  g.buy(h, 'seed_radish', 2);
  const c0 = h.cash, s0 = h.storage['seed_radish'];
  const r = g.sell(h, 'seed_radish', 1);
  assert(!r.ok, '卖投入品必须被拒');
  assert(h.cash === c0, '被拒时不该动钱');
  assert(h.storage['seed_radish'] === s0, '被拒时不该动库存');
});

/* ---------------- I4 播种耗种（不双重收费） ---------------- */
console.log('\nI4 播种消耗库存里的种子，且不再扣种子钱');
ok('先买一包 → 播种：库存 −1、现金不变（无地租时）', () => {
  const g = mk('GG-IN-I4'), h = H(g);
  const id = 'seed_radish';
  g.buy(h, id, 1);
  const c0 = h.cash, s0 = h.storage[id] || 0;
  const r = g.act(h.id, 'plant', { crop: 'radish' });
  assert(r.ok, '应能种下：' + r.msg);
  assert(!h.storage[id], '那一包种子应被吃掉');
  near(h.cash, c0, 1e-9, '种子钱已在“买”那一步付过，播种**不该**再扣一次');
  assert(h.plots.some(pl => pl.crop === 'radish'), '地里应种上了萝卜');
});

/* ---------------- I5 手头没种 → 自动补一包 ---------------- */
console.log('\nI5 手头没种子时播种：自动补一包（保住新手第一分钟）');
ok('直接播种也能成功，钱按市场价出，且消息里说清种子从哪来', () => {
  const g = mk('GG-IN-I5'), h = H(g);
  assert(!h.storage['seed_radish'], '前提：手头没有种子');
  const c0 = h.cash;
  const r = g.act(h.id, 'plant', { crop: 'radish' });
  assert(r.ok, '手头没种也应能种下（自动补货）：' + r.msg);
  assert(h.cash < c0, '补货要花钱（按市场价）');
  assert(/顺手在市场上买/.test(r.msg), '消息里应说清种子是顺手买的：' + r.msg);
  assert(!h.storage['seed_radish'], '补的那包应直接被吃掉');
});

/* ---------------- I6 旧存档兼容 ---------------- */
console.log('\nI6 旧存档（没有 inputs 容器）不崩，且走回老路径');
ok('删掉 s.inputs 后：isInput 为假、播种按现金扣、不抛异常', () => {
  const g = mk('GG-IN-I6'), h = H(g);
  assert(g.isInput('seed_radish'), '前提：新局应有投入品');
  delete g.s.inputs;
  assert(!g.isInput('seed_radish'), '没有容器时 isInput 应为假（不许抛）');
  assert(g.good('seed_radish') === undefined, '没有容器时取不到货（但不许抛）');
  /* 旧档的 rules 没有 seedMustBuy → 播种走老路径 */
  delete g.s.rules.seedMustBuy;
  const c0 = h.cash;
  const r = g.act(h.id, 'plant', { crop: 'radish' });
  assert(r.ok, '旧路径下应能种下：' + r.msg);
  assert(h.cash < c0, '旧路径：播种时直接按种价扣现金');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（投入品层 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
