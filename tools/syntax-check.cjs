/* 语法自检：把 game/parts 与 game/ui-parts 里每个源文件都解析一遍。
 *
 * 为什么要单独有一项：
 *   2026-10-08 我三次把注释写坏（后两次是同一个坑的三个面）：
 *     ① HTML 注释被提前闭合 ⇒ 后面几行变成**页面上的可见文字**（文案闸门拦下的）；
 *     ② JS 注释的收尾符之后又塞了两行 ⇒ ui.js 报 “Invalid or unexpected token”；
 *     ③ 更荒唐的：本文件自己的头注释里为了“说明这件事”，把收尾符原样写了一遍
 *        ⇒ 注释在那一行就断了，于是**新守卫自己语法就不对**（跑起来直接 Node 崩）。
 *   ② 的症状**指不出是哪个文件哪一行**（构建产物只会说 ui.js 加载失败），
 *   我只好临时写脚本逐个 `node --check` 才定位到 08-chrome.js:18。
 *   这一项就是那次手工排查的固化：**最便宜、最先跑、且能报出文件名与行号**。
 *
 * ⚠ 写注释的铁律（我自己踩了三次）：**注释里永远不要出现注释收尾符的那两个字符**，
 *   要说它就写“注释收尾符”。这一类错静态检查很难兜，纯靠人记住。
 *
 * 用法：node tools/syntax-check.cjs
 */
const fs = require('fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['game/parts', 'game/ui-parts'];

let bad = 0, n = 0;
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.js')) continue;
    n++;
    const rel = d + '/' + f;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      /* vm.Script 只解析不执行：既能拿到 SyntaxError，又不会碰到浏览器全局。
         ⚠ 必须**包一层函数**再解析：parts 打包后是同一个函数体里的一段，
           有些文件（如 16-settle.js）用了顶层 `return` —— 直接按“脚本”解析会
           误报 “Illegal return statement”（守卫的第一版就误伤了它）。
         代价：报出来的行号比源文件大 1（前面垫了一行）。 */
      new vm.Script('(function(){\n' + src + '\n})', { filename: rel });
    } catch (e) {
      bad++;
      console.log('  ❌ ' + rel + ' → ' + e.message);
    }
  }
}
/* ---- 产物也要单独解析一遍（源码干净 ≠ 产物能跑）-------------------------
   为什么：34 个 part 会被拼成一段代码，**part 边界处**的问题只有拼起来才出现；
   而玩家（以及应用）真正加载的是产物，产物坏了、源码再干净也没用。
   2026-10-08 用户报的 “Uncaught SyntaxError: Unexpected identifier 'inventoryValue'”
   就属于这一层：当时逐文件解析已经全绿，而他浏览器里那份是坏的 ——
   守卫只查了“我写的东西”，没查“真正交出去的东西”。 */
function parseOne(label, code) {
  try { new vm.Script(code, { filename: label }); return true; }
  catch (e) { bad++; console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}

/* 开发用 bundle：⚠ 它们**不是“构建产物”，而是加载器** ——
   require 之后 .source() 会**当场把 parts 拼出来**（所以文件时间戳旧不代表内容旧）。
   真正要解析的是 **.source() 返回的那段字符串**：测试与浏览器跑的就是它
   （引擎侧是 eval(source) 执行，报错带 “eval at load”）。
   只解析加载器文件本身等于什么都没查 —— 这是本守卫第一版的盲区。
   （style.bundle 返回 CSS，不在这里做 JS 解析。） */
for (const [rel, label] of [['game/engine.bundle.js', 'engine.bundle.source()'],
                            ['game/ui.bundle.js', 'ui.bundle.source()']]) {
  n++;
  try {
    const src = require(path.join(ROOT, rel)).source();
    parseOne(label, src);
  } catch (e) {
    bad++;
    console.log('  ❌ ' + label + ' → 加载/拼接失败：' + e.message);
  }
}

/* 单文件 HTML：把每个 script 标签的内容抠出来单独解析（产物里 JS 是原样内联的，没有转义） */
for (const h of ['dist/demo.html', 'dist/割不割-demo.html']) {
  const p = path.join(ROOT, h);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, 'utf8');
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html)) !== null) {
    i++;
    n++;
    parseOne(h + ' 第 ' + i + ' 个 script', m[1]);
  }
}

console.log(bad
  ? '❌ 语法自检失败：' + bad + ' / ' + n + ' 个文件（含产物）'
  : '✅ 语法自检全部通过（' + n + ' 个文件，含源码与产物）');
process.exit(bad ? 1 : 0);
