/* ⚠ 这个文件**已经不是 UI 的实现**。
 *
 * 实现已按「每个文件 ≤1000 行」的规则拆到 `game/ui-parts/` 下，
 * 由 `game/ui.bundle.js` 装配成完整源码文本。
 *
 * 谁在用它（**全部读装配器，不读本文件**）：
 *   - tools/build.mjs              内联进单文件 HTML
 *   - tools/lint-copy.cjs          文案扫描（带覆盖率下限，防止扫到残桩）
 *   - tools/ui-smoke.cjs           eval 做界面冒烟
 *   - tools/speed-btn.test.cjs     变体测试做字符串替换
 *   - tools/tab-click-race.test.cjs  同上
 *
 * 这个文件留着只是为了：
 *   ① 让 tools/build.mjs 的正则仍能找到 index.html 里那对 <script src> 占位标签
 *   ② 给来人指路
 *
 * ⚠⚠ 要改 UI：改 `game/ui-parts/` 下对应的那一片，**别改这里**。
 *     如果你正在"修 ui.js 里的某行文案"，请先想一下：
 *     这段话大概率在 ui-parts/ 的某一片里，改错地方不会生效。
 *
 * ⚠ 另一个必须知道的后果：**`game/index.html` 不能直接双击打开了**。
 *   它是构建模板 —— 必须 `node tools/build.mjs` 之后打开 `dist/割不割-demo.html`。
 *   （engine.js 模块化之后这条就已经成立，这里只是把它写明白。）
 */
if (typeof module !== 'undefined' && module.exports) {
  /* Node 侧：给出装配器，便于调试时 require 到这里。 */
  module.exports = require('./ui.bundle.js');
} else if (typeof console !== 'undefined') {
  console.error('⚠ game/ui.js 已不是 UI 实现（已拆到 game/ui-parts/）。' +
    '请先构建：node tools/build.mjs，然后打开 dist/割不割-demo.html');
}
