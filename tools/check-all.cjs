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
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + '  ' + line);
}
console.log(failed ? '\n❌ 全量检查失败：' + failed + ' 项' : '\n✅ 全量检查全部通过');
process.exit(failed ? 1 : 0);
