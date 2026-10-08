/* 产物自检 —— dist 里那份单文件 HTML 到底对不对。
 *
 * 为什么要有它：构建"成功"只说明 build.mjs 没抛错，不说明产物里
 * **真的是同一段文本**。本项目真发生过：换掉 engine.js 之后，
 * 文案闸门一直在扫 11 行残桩却报绿（静默失效）。
 * 所以这里对产物做**逐字节反查**：装配器给的文本，必须原封不动出现在 dist 里。
 *
 * 用法：node tools/dist-check.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const NAME = '割不割-demo.html';
const FILE = path.join(DIST_DIR, NAME);

let bad = 0;
const fail = (m) => { console.error('  ❌ ' + m); bad++; };
const pass = (m) => console.log('  ✅ ' + m);

if (!fs.existsSync(FILE)) {
  console.error('❌ 产物不存在：' + FILE + '\n   先跑：node tools/build.mjs');
  process.exit(1);
}
const s = fs.readFileSync(FILE, 'utf8');
console.log('产物：dist/' + NAME + '　' + (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB\n');

/* 1) 不许有外链（file:// 双击打不开的根因） */
console.log('[1] 外链检查（file:// 双击必须能跑）');
if (s.includes('<script src=')) fail('产物里还有外链 <script src>'); else pass('无外链 <script src>');
if (/<link\s+rel="stylesheet"/.test(s)) fail('产物里还有外链 <link rel="stylesheet">'); else pass('无外链 <link rel="stylesheet">');

/* 2) 三份源码必须**逐字节**出现在产物里 */
console.log('\n[2] 内联源码逐字节反查（装配器 vs 产物）');
const partsOf = (label, getSrc) => {
  let src;
  try { src = getSrc(); } catch (e) { fail(label + '：装配器取源码失败 ' + e.message); return; }
  const n = src.length;
  if (s.includes(src)) pass(label + '：' + n + ' 字符，原封不动在产物里');
  else {
    /* 找最长公共前缀，定位第一处差异，别只说"不相等" */
    let i = 0;
    const at = s.indexOf(src.slice(0, 60));
    const head = at >= 0 ? at : 0;
    while (i < n && s[head + i] === src[i]) i++;
    fail(label + '：' + n + ' 字符，产物里**找不到这一整段**（最长匹配到第 ' + i + ' 字符）');
    console.error('      装配器 ...' + JSON.stringify(src.slice(Math.max(0, i - 60), i + 60)));
    console.error('      产物   ...' + JSON.stringify(s.slice(Math.max(0, head + i - 60), head + i + 60)));
  }
};
partsOf('engine', () => require('../game/engine.bundle.js').source());
partsOf('ui    ', () => require('../game/ui.bundle.js').source());
partsOf('css   ', () => require('../game/style.bundle.js').source());

/* 3) 样式块必须**完整无损**。
   ⚠ 统计时先剥掉 HTML 注释：注释里的 <style> 是纯文本，**无害**。
     本项目真踩过这个坑：我在 index.html 的注释里写了字面量 <style>，
     让这个自检误报“会截断样式”。判据要比被测对象更严谨，否则就是假警报。 */
console.log('\n[3] 样式块完整性');
let cssSrc = '';
try { cssSrc = require('../game/style.bundle.js').source(); } catch (e) { /* [2] 已报过 */ }
const realBlock = '<style>\n' + cssSrc + '\n</style>';
const noCmt = s.replace(/<!--[\s\S]*?-->/g, '');
const headAt = noCmt.indexOf(realBlock);
if (!cssSrc) console.log('  （跳过：取不到 CSS）');
else if (headAt >= 0) pass('样式块 = style 开标签 + 装配器 CSS + 闭标签，逐字节完整（' + cssSrc.length + ' 字符）');
else fail('样式块不完整：开/闭标签之间不是装配器给的那段 CSS');

const idxAll = (needle, hay) => { const r = []; for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) r.push(i); return r; };
const openAt = idxAll('<style>', noCmt);
const closeAt = idxAll('</style>', noCmt);
const inCmt = idxAll('<style>', s).length - openAt.length;
console.log('  ℹ️ 注释之外：<style> ' + openAt.length + ' 处 / </style> ' + closeAt.length + ' 处' +
  (inCmt ? '；注释里另有 ' + inCmt + ' 处（纯文本，无害）' : ''));

if (headAt >= 0) {
  const beforeOpen = openAt.filter(p => p !== headAt && p < headAt);
  const afterOpen = openAt.filter(p => p !== headAt && p > headAt);
  if (beforeOpen.length) fail('有 ' + beforeOpen.length + ' 处 <style> 在真实样式块**之前**且不在注释里 —— 会截断样式');
  else if (afterOpen.length) pass('另有 ' + afterOpen.length + ' 处 <style> 在样式块**之后**（在 <script> 内，不影响 head 样式）');

  const headCloseAt = headAt + realBlock.length - '</style>'.length;
  const beforeClose = closeAt.filter(p => p < headCloseAt);
  if (beforeClose.length) fail('有 ' + beforeClose.length + ' 处 </style> 在真实样式块**之前** —— 样式块被截断');
}

/* 4) 页面骨架该在的都在 */
console.log('\n[4] 页面骨架');
const missing = [];
for (const id of ['id="app"', 'id="view"', 'id="feed"', 'id="tabs"', 'id="top"', 'id="ovStart"']) {
  if (!s.includes(id)) missing.push(id);
}
if (missing.length) fail('缺骨架元素：' + missing.join(', ')); else pass('骨架元素齐全（6 个）');

console.log(bad ? '\n❌ 产物自检失败：' + bad + ' 项' : '\n✅ 产物自检全部通过');
process.exit(bad ? 1 : 0);
