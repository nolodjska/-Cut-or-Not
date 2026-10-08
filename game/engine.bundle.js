/* engine 装配器 —— **Node 与浏览器的唯一共同来源**。
 *
 * game/engine.js（Node 入口，测试与 tools/sim.cjs 用）和 tools/build.mjs（单文件内联）
 * **都调这里**，保证两边跑的**是同一段文本**。
 * 否则就会出现最坏的情况：测试跑的是 A、玩家跑的是 B。
 *
 * 为什么可以这样拼：原 engine.js 是 UMD，工厂函数体就是一个普通函数作用域，
 * 所以把函数体切成 parts、按序拼接，语义完全不变（已验证逐字节相等）。
 */
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST = require('./engine.parts.js');
const PARTS_DIR = path.join(__dirname, 'parts');
const MARKER = /^\/\* ===== part: .+ ===== \*\/$/;

const HEAD = `/* ============================================================================
 * 《割不割》核心引擎 v0.1 (demo-0.1)
 * ----------------------------------------------------------------------------
 * 设计约束（来自 docs/07 技术架构与社交合规）：
 *   - 纯逻辑：无 DOM、无 Date.now、无 Math.random、无 wx.*
 *   - 随机全部来自注入的种子 PRNG（可复现，同种子逐位相同）
 *   - 状态可 JSON 序列化（存档）；RNG 状态为普通 number，BigInt 不进状态
 *   - 引擎与 UI 解耦：UI 只读 state + 调 act()，不反向写状态
 *   - 时间权威：调用方推进 advanceReal(秒)，引擎内部按游戏分钟结算
 *
 * 交付形态：UMD（浏览器 window.GG / Node require）
 * ----------------------------------------------------------------------------
 * 2026-10-08 模块化（项目规则：每个文件 ≤1000 行）：
 *   实现已拆到 game/parts/ 下，按 game/engine.parts.js 的清单拼装。
 *   本文件由 game/engine.bundle.js 生成 —— 不要在前缀/后缀里写实现。
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';
`;

const FOOT = '});\n';

/** 读一个 part，并按统一规则规范化（去掉标记头 + 恰好一个末尾换行） */
function readPart(f) {
  const fp = path.join(PARTS_DIR, f);
  let t = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  const nl = t.indexOf('\n');
  if (nl >= 0 && MARKER.test(t.slice(0, nl))) t = t.slice(nl + 1);
  return t;
}

/** 工厂体文本 == 原 engine.js 的工厂体（tools/parts-verify.cjs 逐字节验证过） */
function body() {
  const missing = MANIFEST.filter(f => !fs.existsSync(path.join(PARTS_DIR, f)));
  if (missing.length) throw new Error('缺少 engine 模块：' + missing.join(', ') +
    '\n（清单在 game/engine.parts.js；parts 目录见 game/parts/）');
  return MANIFEST.map(readPart).join('\n');
}

/** 完整的 UMD 源码文本（浏览器内联用这份） */
function source() { return HEAD + body() + '\n' + FOOT; }

/** Node 侧求值，取出 module.exports（即 window.GG 的那个对象） */
function load() {
  const m = { exports: {} };
  /* 故意不用 vm：new Function 的开销更小，且这里不需要沙箱隔离
     （引擎本来就是纯逻辑、无 require、无 IO） */
  new Function('module', 'exports', 'globalThis', source())(m, m.exports, globalThis);
  return m.exports;
}

module.exports = { MANIFEST, PARTS_DIR, readPart, body, source, load };
