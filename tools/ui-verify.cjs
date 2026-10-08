/* ui 拆分安全性验证器 —— 与 tools/parts-verify.cjs 同一套口径（文本比较）。
 *
 * 断言（迁移前）：**ui-parts 按清单拼接 == ui.js 原 IIFE 体**（逐字节）
 * 断言（迁移后）：装配出的源码可解析 + 清单↔目录一致 + 关键函数都在
 *
 * 用法：
 *   node tools/ui-verify.cjs            全量比对
 *   node tools/ui-verify.cjs --prefix   只比"已就绪的连续前缀"
 *
 * ⚠ 只比"文本"，不比"行数组" —— 理由见 parts-verify.cjs 顶部注释
 *   （split('\\n') 的末尾空元素没有可靠启发式，我为此写出过互相矛盾的两个工具）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const UI = path.join(ROOT, 'game', 'ui.js');
const PARTS_DIR = path.join(ROOT, 'game', 'ui-parts');
const BUNDLE = path.join(ROOT, 'game', 'ui.bundle.js');

/* ---------- 取原 IIFE 体（文本） ---------- */
const lines = fs.readFileSync(UI, 'utf8').replace(/\r\n/g, '\n').split('\n');
const sIdx = lines.findIndex(l => l.trim() === "'use strict';");
let eIdx = -1;
for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === '})();') { eIdx = i; break; } }

if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) {
  /* ---------- 迁移后模式 ---------- */
  console.log('ℹ️ ui.js 已是薄入口（' + lines.length + ' 行），没有 IIFE 体可比。');
  console.log('   现在改跑**迁移后守卫**：\n');
  let bad = 0;
  const bundle = require(BUNDLE);
  const list = bundle.MANIFEST;
  const onDisk = fs.readdirSync(PARTS_DIR).filter(f => f.endsWith('.js')).sort();
  const inList = list.slice().sort();
  const missing = inList.filter(f => !onDisk.includes(f));
  const orphans = onDisk.filter(f => !inList.includes(f));
  if (missing.length) { console.error('❌ 清单里有但磁盘上缺：' + missing.join(', ')); bad++; }
  else console.log('✅ 清单 ' + list.length + ' 项，磁盘上全都在');
  if (orphans.length) { console.error('❌ ui-parts/ 里有文件不在清单里（不会被拼进去！）：' + orphans.join(', ')); bad++; }
  else console.log('✅ ui-parts/ 里没有孤儿文件');
  try {
    const src = bundle.source();
    new Function(src);                       // ui 是 IIFE，语法解析就行（不执行，避免要 DOM）
    console.log('✅ 装配出的 UI 源码可解析（' + src.length + ' 字符）');
    const need = ['function viewFarm', 'function viewMarket', 'function viewBank', 'function render',
      'function handleAction', 'function dealerBoard', 'function buyerPanel', 'function toast'];
    const miss = need.filter(k => !src.includes(k));
    if (miss.length) { console.error('❌ 源码里找不到关键函数：' + miss.join(', ')); bad++; }
    else console.log('✅ 关键函数都在（' + need.length + ' 个）');
  } catch (e) { console.error('❌ 装配出的源码不合法：' + e.message); bad++; }
  console.log(bad ? '\n❌ ' + bad + ' 项守卫失败' : '\n✅ 迁移后守卫全部通过');
  process.exit(bad ? 1 : 0);
}

const bodyText = lines.slice(sIdx + 1, eIdx).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');

/* ---------- 规范化拼 parts（文本） ---------- */
let manifest;
try { manifest = require(path.join(ROOT, 'game', 'ui.parts.js')); } catch (e) {
  console.error('❌ 读清单失败（game/ui.parts.js）：' + e.message); process.exit(1);
}
const texts = [];
const missing = [];
for (const f of manifest) {
  const fp = path.join(PARTS_DIR, f);
  if (!fs.existsSync(fp)) { missing.push(f); continue; }
  let t = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  if (t.endsWith('\n')) t = t.slice(0, -1);
  const nl = t.indexOf('\n');
  if (nl >= 0 && /^\/\* ===== part: .+ ===== \*\/$/.test(t.slice(0, nl))) t = t.slice(nl + 1);
  texts.push(t);
  console.log('  ' + String(t.split('\n').length).padStart(4) + ' 行  ' + f);
}
const partsText = texts.join('\n');

console.log('\n原 IIFE 体 ' + bodyText.split('\n').length + ' 行　|　parts 就绪 ' +
  (manifest.length - missing.length) + '/' + manifest.length +
  '（正文 ' + partsText.split('\n').length + ' 行）');
if (missing.length) console.log('未就绪：' + missing.join(', '));

if (partsText === bodyText) {
  console.log('\n✅ 逐字节相等 —— 拆分没有丢任何东西（' + bodyText.length + ' 字符）');
  process.exit(0);
}
if (process.argv.includes('--prefix') && bodyText.startsWith(partsText)) {
  console.log('\n✅ 已就绪的 ' + partsText.split('\n').length + ' 行与原体前缀**逐字节一致**' +
    '（还差 ' + (bodyText.split('\n').length - partsText.split('\n').length) + ' 行未搬）');
  process.exit(0);
}
let i = 0;
const n = Math.min(bodyText.length, partsText.length);
while (i < n && bodyText[i] === partsText[i]) i++;
console.error('\n❌ 第一处差异大约在第 ' + bodyText.slice(0, i).split('\n').length + ' 行（字符偏移 ' + i + '）');
console.error('  长度：原 ' + bodyText.length + ' / parts ' + partsText.length + '　差 ' + (bodyText.length - partsText.length));
const ctx = (s, from) => JSON.stringify(s.slice(Math.max(0, from - 70), from + 70));
console.error('  原   ...' + ctx(bodyText, i));
console.error('  parts...' + ctx(partsText, i));
process.exit(1);
