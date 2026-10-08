/* 样式装配器 —— index.html 的分片样式（每文件 ≤1000 行）按序拼回一份完整 CSS。
 *
 * ⚠ 这是样式顺序的**唯一来源**：tools/build.mjs（内联进单文件 HTML）
 *   与 tools/lint-copy.cjs（扫文案）都读这里，保证"扫的 = 发布的"。
 *
 * 为什么可以这样拼：CSS 是声明式的，按序拼接与原来写在同一个 <style> 里等价
 *   （浏览器按出现顺序应用，层叠规则不变）。
 */
const fs = require('node:fs');
const path = require('node:path');

/* 顺序 = 原 <style> 块里的出现顺序，不能随便调（后写的覆盖先写的） */
const ORDER = [
  'style-1-base.css',    // 设计令牌 + 布局 + 美术资产
  'style-2-v3.css',      // v3 纸感层 1~18 节
  'style-3-fixes.css',   // v3 后半 A~H（含布局权威层与悬停修复）
];

/** 读一个分片，剥掉那一行 `/* ===== part: xxx ===== *\/` 标记头 */
function readPart(f) {
  const t0 = fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
  let t = t0.endsWith('\n') ? t0.slice(0, -1) : t0;
  const nl = t.indexOf('\n');
  const first = nl < 0 ? t : t.slice(0, nl);
  if (first.indexOf('/* ===== part:') === 0) t = nl < 0 ? '' : t.slice(nl + 1);
  return t;
}

function source() {
  const miss = ORDER.filter(f => !fs.existsSync(path.join(__dirname, f)));
  if (miss.length) throw new Error('缺少样式分片：' + miss.join(', '));
  return ORDER.map(readPart).join('\n');
}

module.exports = { ORDER, readPart, source };
