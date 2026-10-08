/* 项目规则守卫：**每个源文件不得超过 1000 行**（用户 2026-10-08 立规）。
 *
 * ⚠ 数行必须用 Node（fs）—— **绝不要用 PowerShell 的 `Get-Content` 数行**。
 *    本机 PowerShell 默认 GBK，读 UTF-8 文件会数错：
 *    实测 engine.js 真实 **2720** 行，而 `(Get-Content engine.js).Count` 报 **2485**。
 *    错误的度量会让"检查通过"变成假象（docs/13 §16.5 编码铁律）。
 *
 * 用法：node tools/size.test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = 1000;
const SCAN = [
  { dir: 'game', exts: ['.js', '.cjs', '.mjs', '.html', '.css'] },
  { dir: 'tools', exts: ['.js', '.cjs', '.mjs'] },
];
/* 不入账的目录：dist 是构建产物（生成物不受源码行数规则约束） */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);

function countLines(fp) {
  /* 与主控度量口径一致：数 \n 的个数（文件以换行结尾时即行数） */
  const s = fs.readFileSync(fp, 'utf8');
  return (s.match(/\n/g) || []).length;
}
function walk(dir, exts, out) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(fp, exts, out); }
    else if (exts.includes(path.extname(e.name))) out.push(fp);
  }
}
const files = [];
for (const s of SCAN) walk(path.join(ROOT, s.dir), s.exts, files);

const rows = files
  .map(fp => ({ rel: path.relative(ROOT, fp).replace(/\\/g, '/'), n: countLines(fp) }))
  .sort((a, b) => b.n - a.n);

const over = rows.filter(r => r.n > LIMIT);
console.log('=== 文件行数（规则上限 ' + LIMIT + ' 行）===');
for (const r of rows) {
  const flag = r.n > LIMIT ? '❌ 超 ' + (r.n - LIMIT) : '✅';
  console.log('  ' + String(r.n).padStart(5) + '  ' + r.rel.padEnd(34) + flag);
}
console.log('共 ' + rows.length + ' 个文件；最大 ' + (rows[0] ? rows[0].n : 0) + ' 行');

if (over.length) {
  console.log('\n❌ ' + over.length + ' 个文件超过 ' + LIMIT + ' 行：');
  for (const r of over) console.log('   - ' + r.rel + '（' + r.n + ' 行，需再拆 ' + (r.n - LIMIT) + '）');
  process.exit(1);
}
console.log('\n✅ 所有文件都在 ' + LIMIT + ' 行以内');
