/* engine 的 Node 入口（测试与 tools/sim.cjs 用 require 加载）。
 *
 * ⚠ 这里**没有实现**：实现已按「每文件 ≤1000 行」的规则拆到 game/parts/ 下，
 *   由 game/engine.bundle.js 按 game/engine.parts.js 的清单拼回同一段文本。
 *
 * 浏览器不走这个文件：tools/build.mjs 会把 engine.bundle.source() 内联进单文件 HTML，
 * 所以 Node 与浏览器跑的是**同一段文本**（有测试守着）。
 *
 * 要改引擎：改 game/parts/ 下对应的那一片，别改这里。
 */
module.exports = require('./engine.bundle.js').load();
