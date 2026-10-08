/* 拆分安全性验证器 —— 「拆引擎」唯一的硬证据（不靠"看着对"）。
 *
 * 断言：**parts 按清单拼接 == engine.js 的原工厂体**（逐字节）
 *
 * 用法：
 *   node tools/parts-verify.cjs           全量比对（拆分完成后必须全等）
 *   node tools/parts-verify.cjs --prefix  只比"已就绪的连续前缀"（拆分进行中时用）
 *
 * ⚠ 这里**不比"行数组"、只比"文本"**。原因（踩过三次，写成纪律）：
 *   `split('\n')` 对"以换行结尾"与"不以换行结尾"的文件会产生不同的**末尾空元素**，
 *   而"该不该弹掉那个空元素"没有任何可靠启发式 —— 我为此写出过两个互相矛盾的工具
 *   （一个报"少 3 行"、另一个报"全部相符"）。
 *   **文本比较没有这个歧义**：两边都只做「去掉标记头 + 去掉恰好一个末尾换行」。
 *
 * engine.js 是 UMD：
 *   (function (root, factory) { ... })(..., function () {
 *   'use strict';        ← 工厂体从下一行开始
 *   ...（全部实现）...
 *   return { ... };      ← 工厂体到此结束
 *   });                  ← UMD 收尾
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'game', 'engine.js');
const PARTS_DIR = path.join(ROOT, 'game', 'parts');
const MANIFEST = path.join(ROOT, 'game', 'engine.parts.js');
const MARKER = /^\/\* ===== part: .+ ===== \*\/$/;

/* ---------- 原工厂体（文本） ---------- */
const raw = fs.readFileSync(ENGINE, 'utf8').replace(/\r\n/g, '\n');
const lines = raw.split('\n');
const sIdx = lines.findIndex(l => l.trim() === "'use strict';");
let eIdx = -1;
for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() === '});') { eIdx = i; break; } }
if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) {
  /* ---------- 迁移后模式：engine.js 已是装配入口，没有 UMD 可比 ---------- */
  console.log('ℹ️ engine.js 已是装配入口（' + lines.length + ' 行），没有 UMD 工厂体可比。');
  console.log('   ⇒ 迁移期的「逐字节比对」已完成使命（2026-10-08 已验证 117444 字符全等）。');
  console.log('   现在改跑**迁移后真正有用的守卫**：\n');

  /* 守卫 1：清单 ↔ parts 目录 必须一一对应（防漏搬 / 防孤儿文件） */
  const list = require(MANIFEST);   /* ⚠ MANIFEST 是**路径字符串**，不是数组 */
  const onDisk = fs.readdirSync(PARTS_DIR).filter(f => f.endsWith('.js')).sort();
  const inList = list.slice().sort();
  const notListed = onDisk.filter(f => !inList.includes(f));
  const notOnDisk = inList.filter(f => !onDisk.includes(f));
  let bad = 0;
  if (notOnDisk.length) { console.error('❌ 清单里有但磁盘上缺：' + notOnDisk.join(', ')); bad++; }
  else console.log('✅ 清单 ' + list.length + ' 项，磁盘上全都在');
  if (notListed.length) { console.error('❌ parts/ 里有文件不在清单里（不会被拼进去！）：' + notListed.join(', ')); bad++; }
  else console.log('✅ parts/ 里没有孤儿文件（每个都会被拼进去）');

  /* 守卫 2：装配出来的源码必须是**可解析的合法 JS** */
  try {
    const src = require(path.join(ROOT, 'game', 'engine.bundle.js')).source();
    new Function('module', 'exports', 'globalThis', src);
    console.log('✅ 装配出的 UMD 源码可解析（' + src.length + ' 字符）');
    /* 守卫 3：Node 侧取到的导出必须是完整的一套键 */
    const GG = require(path.join(ROOT, 'game', 'engine.js'));
    const need = ['BAL', 'CROPS', 'CROP_IDS', 'PRODUCTS', 'PRODUCT_IDS', 'CORPS',
      'TALENTS', 'EVENT_POOL', 'LOT_POOL', 'Game', 'Rng', 'hash32', 'makeSeed',
      'money', 'clamp', 'round2', 'newGame', 'save', 'load'];
    const miss = need.filter(k => GG[k] === undefined);
    if (miss.length) { console.error('❌ 导出缺少：' + miss.join(', ')); bad++; }
    else console.log('✅ 导出键完整（' + need.length + ' 个）');
    if (typeof GG.Game !== 'function' || typeof new GG.Game({ seed: 'GG-T', npcs: 2 }).advanceReal !== 'function') {
      console.error('❌ 装配出的引擎无法实例化/推进'); bad++;
    } else console.log('✅ 能实例化并推进（冒烟）');
  } catch (e) {
    console.error('❌ 装配/求值失败：' + e.message); bad++;
  }

  console.log(bad ? '\n❌ ' + bad + ' 项守卫失败' : '\n✅ 迁移后守卫全部通过');
  process.exit(bad ? 1 : 0);
}
const bodyText = lines.slice(sIdx + 1, eIdx).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');

/* ---------- 读清单 + 规范化拼 parts（文本） ---------- */
let manifest;
try { manifest = require(MANIFEST); } catch (e) {
  console.error('❌ 读清单失败（game/engine.parts.js）：' + e.message + '\n   （提示：.js 的注释里不能出现 `星号+斜杠` 连写）');
  process.exit(1);
}
const texts = [];
const missing = [];
for (const f of manifest) {
  const fp = path.join(PARTS_DIR, f);
  if (!fs.existsSync(fp)) { missing.push(f); continue; }
  let t = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  if (t.endsWith('\n')) t = t.slice(0, -1);          // 去掉恰好一个末尾换行
  const nl = t.indexOf('\n');
  if (nl >= 0 && MARKER.test(t.slice(0, nl))) t = t.slice(nl + 1);   // 去掉标记头
  texts.push(t);
  console.log('  ' + String(t.split('\n').length).padStart(4) + ' 行  ' + f);
}
const partsText = texts.join('\n');

console.log('\n原工厂体 ' + bodyText.split('\n').length + ' 行　|　parts 就绪 ' +
  (manifest.length - missing.length) + '/' + manifest.length +
  '（正文 ' + partsText.split('\n').length + ' 行）');
if (missing.length) console.log('未就绪：' + missing.join(', '));

/* ---------- 比对 ---------- */
const prefixMode = process.argv.includes('--prefix');
const same = partsText === bodyText;
if (same) {
  console.log('\n✅ 逐字节相等 —— 拆分没有丢任何东西（' + bodyText.length + ' 字符）');
  process.exit(0);
}
if (prefixMode && bodyText.startsWith(partsText)) {
  console.log('\n✅ 已就绪的 ' + partsText.split('\n').length + ' 行与原体前缀**逐字节一致**' +
    '（还差 ' + (bodyText.split('\n').length - partsText.split('\n').length) + ' 行未搬）');
  process.exit(0);
}

/* 找第一处字符差异 */
let i = 0;
const n = Math.min(bodyText.length, partsText.length);
while (i < n && bodyText[i] === partsText[i]) i++;
const lineNo = bodyText.slice(0, i).split('\n').length;
console.error('\n❌ 第一处差异在大约第 ' + lineNo + ' 行（字符偏移 ' + i + '）');
console.error('  长度：原 ' + bodyText.length + ' / parts ' + partsText.length +
  '　差 ' + (bodyText.length - partsText.length) + ' 字符');
const ctx = (s, from) => JSON.stringify(s.slice(Math.max(0, from - 60), from + 60));
console.error('  原   ...' + ctx(bodyText, i));
console.error('  parts...' + ctx(partsText, i));
process.exit(1);
