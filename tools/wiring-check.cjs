/* 接线自检 —— UI 上能点的东西，是否真的接上了后面。
 *
 * 为什么要有它：2026-10-08 玩家实测「工坊修不了，没法买」。
 * 根因：`viewMake()` 渲染了 `<button data-act="buildWorkshop">`，
 *       但 `15-events.js` 的分派表里**根本没有** `d.act === 'buildWorkshop'` 这一支 ——
 *       按钮是死的 ⇒ 作坊永远 0 间 ⇒ "开一批" 的条件 `HUMAN.workshops > busy`
 *       恒为 `0 > 0` = false ⇒ 永久灰掉。**两个症状一个根因。**
 *
 * 这类 bug 静态可查：把三方对一遍就够了 ——
 *   ① UI 渲染出的 data-act / data-view / A('动词')
 *   ② 事件分派表里的 d.act === '…' / d.view / 动作分支
 *   ③ 引擎里真实存在的 _a_* 动作
 *
 * 用法：node tools/wiring-check.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readDir = (d) => fs.readdirSync(path.join(ROOT, d))
  .filter(f => f.endsWith('.js'))
  .sort()
  .map(f => ({ f, t: fs.readFileSync(path.join(ROOT, d, f), 'utf8') }));

const UI = readDir('game/ui-parts');
const ENG = readDir('game/parts');
const ui = UI.map(x => x.t).join('\n');
const eng = ENG.map(x => x.t).join('\n');

/** 收集所有匹配，并记下它出现在哪个文件（报错能直接指路） */
function collect(files, re, group = 1) {
  const out = new Map();
  for (const { f, t } of files) {
    for (const m of t.matchAll(re)) {
      const k = m[group];
      if (!out.has(k)) out.set(k, new Set());
      out.get(k).add(f);
    }
  }
  return out;
}
const keys = (m) => [...m.keys()].sort();

let bad = 0;
const fail = (m) => { console.error('  ❌ ' + m); bad++; };
const pass = (m) => console.log('  ✅ ' + m);

/* ---------- ① data-act → 必须有 d.act === '…' 分支 ---------- */
console.log('[1] data-act 按钮 → 事件分派');
const acts = collect(UI, /data-act="([^"]+)"/g);
const actDispatch = new Set([...ui.matchAll(/d\.act === '([^']+)'/g)].map(m => m[1]));
for (const a of keys(acts)) {
  const where = [...acts.get(a)].join(',');
  if (actDispatch.has(a)) pass(`data-act="${a}"  →  有分派分支（${where}）`);
  else fail(`data-act="${a}"  →  **没有** \`d.act === '${a}'\` 分支！按钮是死的（渲染于 ${where}）`);
}

/* ---------- ② A('动词') → 引擎必须有 _a_<动词> ---------- */
console.log('\n[2] A(\'动词\') → 引擎 _a_<动词>');
const calls = collect(UI, /\bA\('([A-Za-z0-9_]+)'/g);
const engineActs = new Set([...eng.matchAll(/_a_([A-Za-z0-9_]+) = function/g)].map(m => m[1]));
for (const c of keys(calls)) {
  const where = [...calls.get(c)].join(',');
  if (engineActs.has(c)) pass(`A('${c}')  →  _a_${c} 在引擎里（${where}）`);
  else fail(`A('${c}')  →  **引擎里没有** _a_${c}！（调用自 ${where}）`);
}

/* ---------- ③ 页签 data-view → render() 的 map 必须有对应视图 ---------- */
console.log('\n[3] 页签 → 视图函数');
const viewTabs = collect(UI, /data-view="([^"]+)"/g);
const mapBlock = /const map = \{([\s\S]*?)\};/.exec(ui);
const viewMap = mapBlock ? new Set([...mapBlock[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)].map(m => m[1])) : new Set();
for (const v of keys(viewTabs)) {
  if (v.indexOf('$') >= 0 || v.indexOf('{') >= 0) continue;   /* 模板占位符 data-view="${k}" 不是真页签 */
  if (v === 'end' || viewMap.has(v)) pass(`data-view="${v}"  →  render() 的 map 里有`);
  else fail(`data-view="${v}"  →  **render() 的 map 里没有**，点了会回落到 viewFarm`);
}

/* ---------- ④ 其它 data-* 动作键 → 分派表里要有 `d.<键>` ---------- */
console.log('\n[4] 其它 data-* 动作 → 分派表');
const KNOWN_ATTRS = ['qin', 'act', 'view', 'sp', 'corp', 'pace'];   // 非"动作"用途，单独说明
/* 挂在 <canvas> 上给 drawSparklines 读的绘画参数，不是动作 */
const PAINT_ATTRS = ['spark', 'd', 'base', 'col', 'w', 'h', 'seedin'];
const otherKeys = new Set();
for (const m of ui.matchAll(/data-([a-z]+)(?:="|\s|>)/g)) otherKeys.add(m[1]);
const unhandled = [];
for (const k of [...otherKeys].sort()) {
  if (KNOWN_ATTRS.includes(k) || PAINT_ATTRS.includes(k)) continue;
  /* 接了就行，接法有三种，都要认：
     ① 全局分派表读 d.<键> / dataset.<键>；
     ② 局部直接绑定：querySelectorAll('[data-<键>]')…onclick
        （开局浮层的 data-revenge 就是这种，走直接绑定，不进全局分派表）；
     ③ 只被读去当选择器用，不当动作。 */
  if (new RegExp('d\\.' + k + '\\b').test(ui)) continue;
  if (new RegExp('dataset\\.' + k + '\\b').test(ui)) continue;
  if (new RegExp('\\[data-' + k + '\\]').test(ui)) continue;
  unhandled.push(k);
}
if (unhandled.length) fail('这些 data-* 既没进分派表、也没直接绑定：' + unhandled.join(', '));
else pass('所有动作类 data-* 都接上了（分派表 或 直接绑定）');

/* ---------- ⑤ 反向：引擎有动作但 UI 从不调用（仅供参考，不算错） ---------- */
console.log('\n[5] 引擎有动作、UI 从不调用（⚠️ 说明这个功能玩家碰不到，需要补入口或确认是给 NPC/测试用的）');
const neverCalled = [...engineActs].filter(a => !calls.has(a)).sort();
if (neverCalled.length) {
  console.log('  ⚠️ ' + neverCalled.join(', '));
  console.log('     （这条**不计入失败**：NPC/测试用动作不该报错。但每条都得能解释清楚，' +
    '\n       本工具诞生当天就是靠它多扫出一个 [upgradePlot 高产地升级无入口]。）');
} else console.log('  （无）');

console.log(bad ? '\n❌ 接线自检发现问题：' + bad + ' 项' : '\n✅ 接线自检全部通过');
process.exit(bad ? 1 : 0);
