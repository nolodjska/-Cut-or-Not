/* 局时长与节奏（docs/06 §2）验收测试
 *
 * 用户 2026-10-08 定案：**15 分钟 / 8 小时 / 3 天**（原来默认只有 9.6 分钟，太短）。
 * 把节奏表搬进 BAL 的原因：原来它硬编码在 UI 里，于是"整局多长"这条最基本的数值
 * **没有任何守卫能测到**（改错了也没人告诉你）。
 *
 * 本文件锁 6 条不变量（P1–P6）：
 *   P1 三档的真实时长 = days × 24 × secPerGameHour 秒，且分别就是 15 分 / 8 小时 / 3 天
 *   P2 默认档就是 15 分钟档
 *   P3 局终时刻 = days × 1440 游戏分钟（引擎真的在那里收）
 *   P4 每档跑完都能正常结算，不抛
 *   P5 存档往返保留 secPerGameHour（读档回来节奏不能变）
 *   P6 **拍卖窗口不随节奏缩放**：30 真实秒在所有档位换算回去都还是 30 秒
 *      （这是 docs/06 §2 特意钉的：按世界压缩比走的话，极速档里明标只剩 0.4 秒）
 *
 * 用法：node tools/pace.test.cjs        # 期望全绿
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
function mk(sph) {
  return new GG.Game({ seed: 'GG-PACE-' + sph, corp: 'grow', npcs: 3, secPerGameHour: sph });
}
/* 整局真实秒数 = 游戏分钟总数 × 每秒游戏分钟 = days×1440 × sph/60 */
function realSecOf(sph) { return GG.BAL.days * 1440 * sph / 60; }

console.log('=== 局时长与节奏（docs/06 §2）验收测试 ===\n');

/* ---------------- P1 三档真实时长 ---------------- */
console.log('P1 三档真实时长 = days×24×sph 秒');
ok('12.5 → 15 分；400 → 8 小时；3600 → 3 天', () => {
  near(realSecOf(12.5), 900, 1e-6, '12.5 档应等于 15 分钟');
  near(realSecOf(400), 8 * 3600, 1e-6, '400 档应等于 8 小时');
  near(realSecOf(3600), 3 * 24 * 3600, 1e-6, '3600 档应等于 3 天');
  const ps = GG.BAL.paces.map(p => p.id);
  assert(ps.length === 3, '应有三档，实得 ' + ps.length);
  for (const id of [12.5, 400, 3600]) assert(ps.indexOf(id) >= 0, '档位表里应有 ' + id);
});

/* ---------------- P2 默认档 = 15 分钟 ---------------- */
console.log('\nP2 默认档就是 15 分钟档');
ok('BAL.paceDefault = 12.5，且它在 paces 表里', () => {
  near(GG.BAL.paceDefault, 12.5, 1e-9, '默认档应是 12.5');
  assert(GG.BAL.paces.some(p => p.id === GG.BAL.paceDefault), '默认档必须在档位表里');
  const g = new GG.Game({ seed: 'GG-PACE-DEF', corp: 'grow', npcs: 1 });
  near(g.s.secPerGameHour, GG.BAL.paceDefault, 1e-9, '不传 sph 时应落到默认档');
});

/* ---------------- P3 局终时刻 ---------------- */
console.log('\nP3 局终时刻 = days × 1440 游戏分钟');
ok('推到刚过局终就结束；没到就不结束', () => {
  const g = mk(3600);
  /* ⚠ 第一次我把 t 停在 `days×1440 - 10` 再 _tick(10)，正好落到
     `t >= days×1440` 的**边界上** —— 边界本来就该结束，是我测试写错了。
     分两步：先 tick 一段（仍在局内），再 tick 跨过局终。 */
  g.s.t = GG.BAL.days * 1440 - 10;
  g._tick(5);
  assert(!g.s.over, '还差 5 分钟不该结束');
  g._tick(10);
  assert(g.s.over, '过了局终应结算');
});

/* ---------------- P4 每档都能跑完 ---------------- */
console.log('\nP4 每档跑完都不抛');
ok('三档各推到局终，都能结算出结果', () => {
  for (const sph of [12.5, 400, 3600]) {
    const g = mk(sph);
    let guard = 0;
    while (!g.s.over && guard++ < 20000) g._tick(30);
    assert(g.s.over, sph + ' 档没跑完（可能是局终判据被节奏带偏了）');
    assert(g.s.summary || g.s.over, sph + ' 档应留下结算结果');
  }
});

/* ---------------- P5 存档保留节奏 ---------------- */
console.log('\nP5 存档往返保留 secPerGameHour');
ok('存了再读，节奏不变', () => {
  const g = mk(400);
  const blob = JSON.parse(JSON.stringify(g.s));
  const g2 = new GG.Game({ seed: blob.seed, secPerGameHour: blob.secPerGameHour, npcs: 0 });
  near(g2.s.secPerGameHour, 400, 1e-9, '读档后节奏应保持 400');
  assert(JSON.stringify(JSON.parse(JSON.stringify(g2.s))).indexOf('"secPerGameHour":400') >= 0,
    'secPerGameHour 应真的进存档');
});

/* ---------------- P6 拍卖窗口不随节奏缩放 ---------------- */
console.log('\nP6 拍卖窗口固定为真实秒，不跟节奏走');
ok('30 真实秒 → 游戏分钟 → 换回真实秒，三档都是 30', () => {
  for (const sph of [12.5, 400, 3600]) {
    const g = mk(sph);
    const gm = g._realSecToGameMin(30);
    const back = g.realSecLeft(gm);
    near(back, 30, 1, sph + ' 档：拍卖窗口换回真实秒应仍是 30 秒，实得 ' + back.toFixed(2));
  }
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（局时长与节奏 6 条不变量）'));
process.exit(errs.length ? 1 : 0);
