/* ui 装配器 —— **所有消费者的唯一共同来源**。
 *
 * tools/build.mjs、lint-copy、ui-smoke、speed-btn.test、tab-click-race.test
 * **都调这里**拿 UI 源码文本，保证"扫的 / 测的 / 发布的"是同一段文本。
 *
 * 为什么可以这样拼：ui.js 原来是一个 IIFE，函数体就是一个普通函数作用域，
 * 所以把函数体切成 parts、按序拼接，语义完全不变。
 *
 * ⚠ 注意与 engine 的关键差别：**ui.js 是被当「文本」消费的**（lint 要扫字符串、
 *   ui-smoke 要 eval、speed-btn/tab-race 要做字符串替换还原旧写法）。
 *   所以这里只提供 `source()`（文本），**没有 `load()`**，也**不能**把 game/ui.js
 *   换成 Node 入口 —— 那会让文案闸门静默扫到残桩。
 */
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = require('./ui.parts.js');
const PARTS_DIR = path.join(__dirname, 'ui-parts');
const MARKER = /^\/\* ===== part: .+ ===== \*\/$/;

const HEAD = `/* ============================================================================
 * 《割不割》Demo UI 层
 * ----------------------------------------------------------------------------
 * 只做三件事：读 engine 的 state、渲染、把点击翻译成 GG.act()。
 * 任何数值计算都问引擎（quote / nav / creditLimit / monoShare），UI 不自己算。
 *
 * 文案规则（docs/07 §2.8.3 红线词表）：玩家可见文案里不出现
 * 投资/收益/理财/提现/充值/股票/K线/做空/杠杆/保证金/爆仓/割韭菜 等词。
 * 统一替换为：本钱/进账/走势/看跌/押金/被动清盘/价差收割。
 * ==========================================================================*/
(function () {
'use strict';
`;

const FOOT = '})();\n';

/** 读一个 part，并按统一规则规范化（去掉标记头 + 恰好一个末尾换行） */
function readPart(f) {
  const fp = path.join(PARTS_DIR, f);
  let t = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  const nl = t.indexOf('\n');
  if (nl >= 0 && MARKER.test(t.slice(0, nl))) t = t.slice(nl + 1);
  return t;
}

/** 工厂体文本（== 原 ui.js 的 IIFE 体） */
function body() {
  const missing = MANIFEST.filter(f => !fs.existsSync(path.join(PARTS_DIR, f)));
  if (missing.length) throw new Error('缺少 ui 模块：' + missing.join(', ') +
    '\n（清单在 game/ui.parts.js；parts 目录见 game/ui-parts/）');
  return MANIFEST.map(readPart).join('\n');
}

/** 完整的 UI 源码文本（浏览器内联、lint 扫描、ui-smoke eval 都用这份） */
function source() { return HEAD + body() + '\n' + FOOT; }

module.exports = { MANIFEST, PARTS_DIR, readPart, body, source };
