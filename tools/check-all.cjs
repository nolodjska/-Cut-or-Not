/* 一键全量：把所有守卫串起来跑，每项一行结论。
 *
 * 为什么要有它：本次会话我在 PowerShell 里拼长检查命令，
 * **连续 4 次栽在引号/转义上**（`\"` 被吞、`'x'$VAR` 语法非法、正则被 shell 改写、
 *   `node -e` 里的反斜杠被吃掉）。
 * 与其继续和 shell 打架，不如把"跑哪几个检查"固化进文件 ——
 * 顺手它就成了这个项目的「提交前一把过」。
 *
 * 用法：node tools/check-all.cjs
 */
const { spawnSync } = require('child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

/* [显示名, 命令, 认哪一行算结论] */
const STEPS = [
  /* 语法自检放第一项：它最便宜，而且能报出**具体文件与行号** ——
     其它守卫只会说“ui.js 加载即抛错”，那等于没说是谁写的错。
     （2026-10-08 我两次把注释写坏，两次都是靠手工逐个 --check 才定位的。） */
  ['语法自检   ', 'node tools/syntax-check.cjs',         /语法自检/],
  ['构建       ', 'node tools/build.mjs',                 /单文件体积/],
  ['产物自检   ', 'node tools/dist-check.cjs',            /产物自检/],
  ['接线自检   ', 'node tools/wiring-check.cjs',          /接线自检/],
  ['文案闸门   ', 'node tools/lint-copy.cjs',             /^结论/],
  ['UI 冒烟    ', 'node tools/ui-smoke.cjs',              /全部通过|项失败/],
  ['开局浮层   ', 'node tools/start-overlay.test.cjs',    /全部通过|项失败/],
  ['速度键     ', 'node tools/speed-btn.test.cjs',        /全部通过|项失败/],
  ['页签点击竞态', 'node tools/tab-click-race.test.cjs',   /全部通过|项失败/],
  ['收货商     ', 'node tools/dealer.test.cjs',           /全部通过|项失败/],
  ['上门的买家 ', 'node tools/buyers.test.cjs',           /全部通过|项失败/],
  ['新手增收   ', 'node tools/newbie.test.cjs',           /主线是赚的|项失败/],
  ['持仓层     ', 'node tools/holdings.test.cjs',         /全部通过|项失败/],
  ['投入品层   ', 'node tools/inputs.test.cjs',           /全部通过|项失败/],
  ['公司账     ', 'node tools/finance.test.cjs',          /全部通过|项失败/],
  ['迁移守卫·引擎', 'node tools/parts-verify.cjs',         /全部通过|失败/],
  ['迁移守卫·UI ', 'node tools/ui-verify.cjs',            /全部通过|失败/],
  ['660 局仿真 ', 'node tools/sim.cjs 60 8',              /不变量异常/],
];

let failed = 0;
console.log('=== 一键全量检查 ===\n');
for (const [name, cmd, pick] of STEPS) {
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = out.split(/\r?\n/).map(s => s.trim()).filter(s => s && pick.test(s)).pop()
    || out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '(无输出)';
  /* ⚠ 通过判据**不能只看退出码**（原来就是，于是埋了个很坏的坑）：
     只要子工具把失败写在结论行里、却仍然 process.exit(0)，"全绿"的假象就成立了。
     2026-10-08 我就撞上过：sim.cjs 明明打「不变量异常：❌ 48 条」（48/660 局崩在
     一个 undefined 上），check-all 却给了 15 项全绿 —— 一个不会变红的守卫
     比没有守卫更危险，它会把"48 局崩溃"包装成"已通过"。
     所以：结论行本身也是判据。用 ❌ 这个字形（全套工具抛结论时都用它），
     不另写词表 —— 词表会漏，而且 "✅ 全部通过（失败 0 项）" 这种句子会被误伤。 */
  const bad = line.indexOf('❌') >= 0;
  const ok = r.status === 0 && !bad;
  if (!ok) failed++;
  /* 把"是退出码拦下的"还是"结论行拦下的"分开写：否则下次又分不清是谁报的错。 */
  const why = ok ? '' : (r.status !== 0 ? '（退出码 ' + r.status + '）' : '（结论行报错）');
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + '  ' + line + why);
}
console.log(failed ? '\n❌ 全量检查失败：' + failed + ' 项' : '\n✅ 全量检查全部通过');
process.exit(failed ? 1 : 0);
