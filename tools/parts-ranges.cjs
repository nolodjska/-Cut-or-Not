/* 逐片段体检：把每个 part 与它的**原始行区间**逐一对照，精确报出缺/多哪一行。
 * 拆分迁移期间用；parts 成为唯一源文件后可以删掉。
 * 用法：node tools/parts-ranges.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MARKER = /^\/\* ===== part: .+ ===== \*\/$/;

/* 与 game/engine.parts.js 注释里的原始行范围一致（含两端） */
const RANGES = [
  ['01-data.js', 20, 247], ['02-util.js', 248, 293], ['03-core.js', 294, 600],
  ['04-ticks.js', 601, 891], ['05-firm.js', 892, 1006], ['06-trade.js', 1007, 1205],
  ['07-metrics.js', 1206, 1348], ['08-crop.js', 1349, 1442], ['09-dealer.js', 1443, 1623],
  ['10-plot.js', 1624, 1673], ['11-intel.js', 1674, 1774], ['12-shorts.js', 1775, 1892],
  ['13-talent.js', 1893, 2041], ['14-npc.js', 2042, 2227], ['15-auction.js', 2228, 2464],
  ['16-settle.js', 2465, 2719],
];

const all = fs.readFileSync(path.join(ROOT, 'game', 'engine.js'), 'utf8')
  .replace(/\r\n/g, '\n').split('\n');

let bad = 0;
for (const [f, from, to] of RANGES) {
  const want = all.slice(from - 1, to);
  const fp = path.join(ROOT, 'game', 'parts', f);
  if (!fs.existsSync(fp)) { console.log('❌ ' + f + '：文件不存在'); bad++; continue; }
  const got = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n').split('\n');
  if (got.length && MARKER.test(got[0])) got.shift();
  /* 只去掉"文件末尾换行"造成的那一个空元素 */
  if (got.length && got[got.length - 1] === '' && got.length > 1 && got[got.length - 2] === '') got.pop();

  const tag = f + '  [' + from + '..' + to + ']  原 ' + want.length + ' 行 / part ' + got.length + ' 行';
  let first = -1;
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) { first = i; break; }
  }
  if (first < 0) { console.log('✅ ' + tag); continue; }
  bad++;
  console.log('❌ ' + tag + '　首次差异在第 ' + (first + 1) + ' 行');
  for (let i = Math.max(0, first - 1); i < Math.min(Math.max(want.length, got.length), first + 4); i++) {
    console.log('     L' + (i + 1) + ' 原  : ' + JSON.stringify(want[i] === undefined ? '<无>' : want[i]).slice(0, 100));
    console.log('     L' + (i + 1) + ' part: ' + JSON.stringify(got[i] === undefined ? '<无>' : got[i]).slice(0, 100));
  }
}
console.log(bad ? '\n❌ ' + bad + ' 个片段与原始区间不符' : '\n✅ 16 个片段全部与原始区间逐行相符');
process.exit(bad ? 1 : 0);
