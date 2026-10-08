/* 把 index.html + engine.js + ui.js 打成单文件 H5（docs/07 §2.10：
   Demo 只发 H5，单文件 + 无后端）。
   用法：node tools/build.mjs  →  dist/割不割-demo.html
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const game = join(root, 'game');

const must = (p) => {
  if (!existsSync(p)) { console.error('❌ 缺少文件：' + p); process.exit(1); }
  return readFileSync(p, 'utf8');
};

const html = must(join(game, 'index.html'));
/* ⚠ engine 已模块化（每文件 ≤1000 行）：实现散在 game/parts/ 下，
   必须用装配器拼出**同一段文本**再内联 —— 不能读 game/engine.js
   （那只是个 Node 入口，里面没有实现）。
   Node 侧（测试/sim）走的是 engine.bundle.load()，与这里同源。 */
const engine = createRequire(import.meta.url)('../game/engine.bundle.js').source();
/* ⚠ ui 也已模块化（每文件 ≤1000 行）：实现散在 game/ui-parts/ 下。
   ui.js 是被当「文本」消费的（lint 扫词 / ui-smoke eval / 两个变体测试做字符串替换），
   所以**不能**把 game/ui.js 换成 Node 入口 —— 那会让文案闸门静默扫到残桩。 */
const ui = createRequire(import.meta.url)('../game/ui.bundle.js').source();
/* ⚠ 样式也已拆到 game/style-*.css（每文件 ≤1000 行），由 style.bundle.js 按序拼回。 */
const css = createRequire(import.meta.url)('../game/style.bundle.js').source();

/* 用正则匹配那对 <script src>，而不是精确字符串。
   踩过的坑：编辑工具把 index.html 换成 CRLF 后，精确匹配 '\n' 会静默失配，
   构建出的产物看着"成功"、实际是个只有 HTML 外壳的空包。 */
const SCRIPT_TAGS = /<script src="engine\.js"><\/script>\s*<script src="ui\.js"><\/script>/;
if (!SCRIPT_TAGS.test(html)) {
  console.error('❌ 构建失败：index.html 里找不到预期的一对 <script src> 标签，无法内联。');
  console.error('   期望形如：<script src="engine.js"></script> 紧跟 <script src="ui.js"></script>');
  process.exit(1);
}

/* 样式同理：index.html 里是三行 <link>，构建时内联成一个 <style>。
   不内联的话，file:// 双击打开会没样式 —— 单文件交付的前提。 */
const LINK_TAGS = /<link rel="stylesheet" href="style-1-base\.css">\s*<link rel="stylesheet" href="style-2-v3\.css">\s*<link rel="stylesheet" href="style-3-fixes\.css">/;
if (!LINK_TAGS.test(html)) {
  console.error('❌ 构建失败：index.html 里找不到预期的三行 <link rel="stylesheet"> 标签，无法内联样式。');
  process.exit(1);
}

const out = html
  .replace(SCRIPT_TAGS, '<script>\n' + engine + '\n</script>\n<script>\n' + ui + '\n</script>')
  .replace(LINK_TAGS, '<style>\n' + css + '\n</style>')
  .replace(/<\/head>/, '<!-- 单文件构建产物：engine.js + ui.js + style-*.css 已内联。源文件在 ../game/ 下。 -->\n</head>');

/* 自检：产物必须比两个脚本之和还大，否则说明没内联成功 */
if (out.length < engine.length + ui.length) {
  console.error('❌ 构建失败：产物（' + out.length + ' 字符）比两个脚本之和（' +
    (engine.length + ui.length) + ' 字符）还小，说明内联没生效。');
  process.exit(1);
}
if (/<script src="/.test(out)) {
  console.error('❌ 构建失败：产物里仍然存在外链 <script src>，file:// 双击会加载不到。');
  process.exit(1);
}
if (/<link rel="stylesheet"/.test(out)) {
  console.error('❌ 构建失败：产物里仍然存在外链 <link rel="stylesheet">，file:// 双击会没样式。');
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const dest = join(root, 'dist', '割不割-demo.html');
writeFileSync(dest, out, 'utf8');

/* 预览外壳：本机 Chrome 的 headless 把布局宽度钉在 504px，--window-size 改不动宽度，
   于是用固定尺寸的 iframe 模拟手机视口来截图。用法：dist/preview.html?auto=1&view=market */
const preview = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>割不割 · 预览</title>
<style>
html,body{margin:0;background:#151a1f;font:12px -apple-system,"PingFang SC",sans-serif}
#bar{color:#8fa3b8;padding:6px 10px}
#wrap{display:flex;justify-content:center;padding:0 8px 16px}
iframe{border:1px solid #22303f;border-radius:14px;display:block;width:390px;height:844px;background:#0b0f14}
</style></head><body>
<div id="bar">手机视口预览 · 390 × 844 · 把 <code>?auto=1&amp;view=market</code> 之类的参数直接加到本页地址后面即可</div>
<div id="wrap"><iframe id="f"></iframe></div>
<script>
var q = location.search.slice(1);
document.getElementById('f').src = 'demo.html' + (q ? '?' + q : '');
</script></body></html>`;
writeFileSync(join(root, 'dist', 'preview.html'), preview, 'utf8');

/* 再写一份 ASCII 文件名的副本：preview.html 的 iframe 指向 demo.html，
   而且无头截图工具对中文路径支持不稳（曾经写出 0 字节）。 */
writeFileSync(join(root, 'dist', 'demo.html'), out, 'utf8');

const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(1) + ' KB';
console.log('✅ 已生成 ' + dest);
console.log('   单文件体积 ' + kb(out) + '（engine ' + kb(engine) + ' + ui ' + kb(ui) + ' + html ' + kb(html) + '）');
