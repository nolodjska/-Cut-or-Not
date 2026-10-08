/* 持仓层（holdings）验收测试 —— 清单 0.4
 *
 * 背景：docs/13 §12.1 把玩家从"一家公司"升级成"持有多家公司的壳"。
 * 引擎已埋 holdings[]、consolidated()、_bankruptcyTick() 换判据、_bankrupt 标记持仓，
 * 但一直**没有验收用例**。本文件补上，锁死 10 条不变量（T1–T9 + T4b）：
 *
 *   T1 新局持仓结构正确（1 家、全资、无负债、未破产）
 *   T2 **无负债恒不破** —— 这是「负债 ≠ 破产」的核心（用户 2026-10-08 定义）
 *   T3 资不抵债 → 触发催债；且日志必须是**现象语言**（不许出现术语）
 *   T4 追保窗口内还清 → 解除（不能一触即死）
 *   T5 逾期未补 → 破产，且 holdings 被标记 bankrupt
 *   T6 现金转负 → 同属死因（illiquid 分支，与 insolvent 并列）
 *   T7 旧存档兼容（无 holdings 字段 → 走 fallback，不许崩）
 *   T8 被收购公司并表：nav 按 control 加权并入、debt 全额并入
 *   T9 已破产的持仓不再并表
 *
 * 用法：node tools/holdings.test.cjs        # 期望全绿
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
  return new GG.Game({ seed: seed, corp: 'trade', npcs: 3, secPerGameHour: 8 });
}
function H(g) {
  const h = g.s.players.find(p => p.isHuman);
  if (!h) throw new Error('找不到玩家');
  return h;
}
/* 把整条 feed 串起来找关键字：feed 条目结构可能变，这里不依赖具体字段名 */
function feedTail(g, n) {
  return JSON.stringify((g.s.feed || []).slice(-(n || 4)));
}

console.log('=== 持仓层（holdings）验收测试 ===\n');

/* ---------------- T1 新局持仓结构 ---------------- */
console.log('T1 新局持仓结构');
ok('恰好 1 家、全资控股、无负债、未破产', () => {
  const g = mk('GG-HOLD-T1'), h = H(g);
  assert(Array.isArray(h.holdings), 'holdings 不是数组：' + typeof h.holdings);
  assert(h.holdings.length === 1, '新局应恰好 1 家持仓，实得 ' + h.holdings.length);
  const x = h.holdings[0];
  assert(x.corpId === h.corp, 'corpId 应与 p.corp 一致：' + x.corpId + ' vs ' + h.corp);
  assert(x.stake === 1, 'stake 应为 1，实得 ' + x.stake);
  assert(x.control === 1, 'control 应为 1，实得 ' + x.control);
  assert(!x.debt, 'debt 应为 0，实得 ' + x.debt);
  assert(!x.bankrupt, 'bankrupt 应为假，实得 ' + x.bankrupt);
});

/* ---------------- T2 无负债恒不破（核心不变量） ---------------- */
console.log('\nT2 无负债恒不破 —— 「负债 ≠ 破产」的核心');
ok('debt=0 时连跑 300 次破产检查都不死、也不设 pressure', () => {
  const g = mk('GG-HOLD-T2'), h = H(g);
  h.debt = 0;
  h.cash = Math.max(h.cash, 5000);
  const sheet = g.consolidated(h);
  assert(sheet.debt === 0, '未做空、无欠款时总负债应为 0，实得 ' + sheet.debt);
  for (let i = 0; i < 300; i++) g._bankruptcyTick();
  assert(h.alive, '无负债的玩家不该破产 —— 这正是「负债≠破产」的定义');
  assert(!h.m.pressure, '无负债的玩家不该被标记催债');
  assert(h.negativeSince == null, '无负债的玩家不该有追保窗口起点');
});

/* ---------------- T3 资不抵债 → 催债 + 现象语言 ---------------- */
console.log('\nT3 资不抵债 → 触发催债，且日志必须是现象语言');
ok('触发 pressure + 记窗口起点 + 日志用「上门催债」且零术语', () => {
  const g = mk('GG-HOLD-T3'), h = H(g);
  h.cash = Math.max(h.cash, 100);          // 现金为正，排除 illiquid 分支
  h.debt = 100000000;                      // 巨额负债 → nav < debt×maintRatio
  const sheet = g.consolidated(h);
  assert(sheet.debt > 0, '总负债应 > 0');
  assert(sheet.nav < sheet.debt * GG.BAL.maintRatio, '前提不成立：并未资不抵债');
  h._warnedNeg = false;
  h.negativeSince = null;
  g._bankruptcyTick();
  assert(h.m.pressure === 1, '应标记催债压力 pressure=1，实得 ' + h.m.pressure);
  assert(h.negativeSince != null, '应记下追保窗口起点');
  assert(h.alive, '刚触发催债不该立刻死（要给 graceHours 窗口）');
  const tail = feedTail(g, 6);
  assert(/上门催债/.test(tail), '日志应出现现象说法「上门催债」：' + tail);
  assert(!/维持线|追保通知|资不抵债|maintRatio|保证金/.test(tail),
    '日志里出现了玩家看不懂的术语：' + tail);
});

/* ---------------- T4 窗口内还清 → 当前态复位 ---------------- */
console.log('\nT4 追保窗口内还清 → 【当前态】必须复位，【历史标记】故意保留');
ok('negativeSince / _warnedNeg 复位；pressure 保留（见下方说明）', () => {
  const g = mk('GG-HOLD-T4'), h = H(g);
  h.cash = Math.max(h.cash, 100);
  h.debt = 100000000;
  h._warnedNeg = false; h.negativeSince = null;
  g._bankruptcyTick();
  assert(h.m.pressure === 1, '前提：应先被催债');
  assert(h.negativeSince != null, '前提：应记下窗口起点');
  h.debt = 0;                              // 还清
  g._bankruptcyTick();
  assert(h.alive, '还清后必须活着');
  assert(h.negativeSince == null, '【当前态】还清后窗口起点必须复位');
  assert(h._warnedNeg === false, '【当前态】还清后"已提醒"必须复位（否则再次催债不再提示）');
  /* pressure 是**历史标记**而非当前状态：全项目只有一处读取它 ——
     engine.js:2261 的 B 生存门槛 `(anyoneDied || p.m.pressure)`，
     语义是"这一局你**经历过**现金流断裂"。所以它**不该**被清掉。
     UI 完全不读它（已 grep 确认），因此不会出现"钱还清了界面还挂着催债"。
     ⚠ 本条最初被我写成"应清除"而误报为 bug —— 是**测试错了，不是代码错了**。 */
  assert(h.m.pressure === 1, 'pressure 是历史标记，应保留（理由见上方注释）');
});

/* T4b：确认这个历史标记确实是 B 门槛"存在过威胁"的那一半 */
ok('无人出局时，"存在过威胁"只能由 pressure 提供', () => {
  const g = mk('GG-HOLD-T4B'), h = H(g);
  h.cash = Math.max(h.cash, 100);
  h.debt = 100000000;
  h._warnedNeg = false; h.negativeSince = null;
  g._bankruptcyTick();                     // 经历一次催债
  h.debt = 0; g._bankruptcyTick();         // 还清
  const anyoneDied = g.s.players.some(p => !p.alive);
  assert(!anyoneDied, '前提：新局不应有人出局');
  assert(h.m.pressure === 1, '前提：历史标记应在');
  const threat = anyoneDied || h.m.pressure;
  /* ⚠ 这里必须用 !! 归一化：引擎里 pressure 存的是**数字 1**（`p.m.pressure = 1`），
     而 `1 === true` 在 JS 里是 false —— 我第一版写成 `assert(threat === true)` 直接误报。
     布尔上下文（如 B 门槛的 `||`）里数字 1 和 true 等价，但**严格相等不等价**。 */
  assert(!!threat, '无人出局 → "存在过威胁"必须由 pressure 这一半提供，否则 B 门槛会空转');
});

/* ---------------- T5 逾期未补 → 破产 + 标记持仓 ---------------- */
console.log('\nT5 逾期未补 → 破产，且 holdings 被标记 bankrupt');
ok('超过 graceHours 后破产，持仓被标记', () => {
  const g = mk('GG-HOLD-T5'), h = H(g);
  h.cash = Math.max(h.cash, 100);
  h.debt = 100000000;
  /* 把窗口起点推到已逾期 */
  h.negativeSince = g.s.t - (GG.BAL.graceHours + 1) * 60;
  h._warnedNeg = true;
  g._bankruptcyTick();
  assert(!h.alive, '逾期未补应破产');
  assert(h.holdings.every(x => x.bankrupt === true), '破产后所有持仓都应标记 bankrupt');
});

/* ---------------- T6 现金转负也是死因 ---------------- */
console.log('\nT6 现金转负（illiquid）与资不抵债（insolvent）并列');
ok('无负债但现金为负 + 逾期 → 同样破产', () => {
  const g = mk('GG-HOLD-T6'), h = H(g);
  h.debt = 0;                              // 无负债 → insolvent 恒不成立
  h.cash = -1;                             // 只剩 illiquid
  h.negativeSince = g.s.t - (GG.BAL.graceHours + 1) * 60;
  h._warnedNeg = true;
  g._bankruptcyTick();
  assert(!h.alive, '现金转负且逾期应破产（illiquid 分支）');
});

/* ---------------- T7 旧存档兼容 ---------------- */
console.log('\nT7 旧存档兼容（无 holdings 字段不许崩）');
ok('delete holdings 后 consolidated() 仍返回合理数值', () => {
  const g = mk('GG-HOLD-T7'), h = H(g);
  const before = g.consolidated(h);
  delete h.holdings;
  const after = g.consolidated(h);
  assert(typeof after.nav === 'number' && isFinite(after.nav), 'nav 应为有限数，实得 ' + after.nav);
  assert(typeof after.debt === 'number' && isFinite(after.debt), 'debt 应为有限数，实得 ' + after.debt);
  near(after.nav, before.nav, 1e-6, 'fallback 后 nav 应与原主控公司口径一致');
});

/* ---------------- T8 被收购公司并表 ---------------- */
console.log('\nT8 被收购公司并表：nav 按 control 加权、debt 全额');
ok('并入一家 60% 控股、负债 500 的公司：nav +1200、debt +500', () => {
  const g = mk('GG-HOLD-T8'), h = H(g);
  const s0 = g.consolidated(h);
  h.holdings.push({ corpId: 'grow', stake: 0.6, control: 0.6, debt: 500, navSnapshot: 2000, bankrupt: false });
  const s1 = g.consolidated(h);
  near(s1.nav - s0.nav, 2000 * 0.6, 1e-6, 'nav 增量应 = navSnapshot × control');
  near(s1.debt - s0.debt, 500, 1e-6, 'debt 增量应 = 被收购公司的负债全额');
});

/* ---------------- T9 破产持仓不再并表 ---------------- */
console.log('\nT9 已破产的持仓不再并表');
ok('把上一家标记 bankrupt 后，并表数值回到并入前', () => {
  const g = mk('GG-HOLD-T9'), h = H(g);
  const s0 = g.consolidated(h);
  const held = { corpId: 'grow', stake: 0.6, control: 0.6, debt: 500, navSnapshot: 2000, bankrupt: false };
  h.holdings.push(held);
  assert(g.consolidated(h).nav - s0.nav > 1, '前提：并入后 nav 应增加');
  held.bankrupt = true;
  const s2 = g.consolidated(h);
  near(s2.nav, s0.nav, 1e-6, '破产持仓不该再贡献 nav');
  near(s2.debt, s0.debt, 1e-6, '破产持仓不该再贡献 debt');
});

console.log('\n' + (errs.length
  ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ')
  : '✅ 全部通过（持仓层 10 条不变量）'));
process.exit(errs.length ? 1 : 0);
