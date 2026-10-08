/* 倍速键高亮回归测试
 *
 * 背景（真实 bug）：renderTop() 里写的是
 *   b.classList.toggle('on', +b.dataset.sp === s.paused ? 0 : s.speed)
 * 由于 === 优先级高于 ?:，等价于 (+b.dataset.sp === s.paused) ? 0 : s.speed，
 * 而 engine.js 里 s.paused 是布尔值（paused:false），数字 === 布尔值恒 false，
 * 于是永远传 s.speed：运行时 4 个倍速键全亮、暂停时全灭。
 * 正确口径应和 setSpeed() 一致：暂停看 data-sp=0，否则看 data-sp=speed。
 *
 * 不变量：任何时刻，4 个 .sbtn 中「有且只有一个」处于 .on。
 *
 * 用法：
 *   node tools/speed-btn.test.cjs                # 期望全绿
 *   node tools/speed-btn.test.cjs --variant=old   # 还原修复前写法，期望红
 */
const fs = require('fs');
const path = require('path');

const VARIANT = process.argv.includes('--variant=old') ? 'old' : 'new';

/* ---------------- 极小 DOM 替身（与 ui-smoke.cjs 同源） ---------------- */
function mkEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), _html: '', textContent: '', value: '', id: '', className: '',
    style: {}, dataset: {}, children: [], onclick: null, selectionStart: 0,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    remove() { },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {}, setLineDash() {} }; },
    addEventListener() {}, focus() {}, setSelectionRange() {},
  };
  return el;
}
const els = {};
function getEl(sel) { if (!els[sel]) { els[sel] = mkEl('div'); els[sel].id = sel.replace('#', ''); } return els[sel]; }

/* 把 4 个倍速键做成真实可查询的桩，供 .sbtn 选择器命中 */
const sbtns = ['0', '1', '2', '4'].map(sp => {
  const b = mkEl('button');
  b.dataset.sp = sp;
  b.className = 'sbtn';
  return b;
});

const listeners = {};
global.document = {
  querySelector: sel => getEl(sel),
  querySelectorAll: sel => (sel === '.sbtn' ? sbtns : []),
  getElementById: id => els['#' + id] || (els['#' + id] = mkEl('div')),
  createElement: mkEl,
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  get activeElement() { return null; },
};
global.window = global;
global.performance = { now: () => Date.now() };
const _ls = {};
global.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};
global.requestAnimationFrame = () => 0;
global.location = { reload() { } };

/* ---------------- 加载 ui.js ---------------- */
const GG = require('../game/engine.js');
global.GG = GG;
let uiSrc = require('../game/ui.bundle.js').source();   /* ui 已模块化：见 game/ui.bundle.js */

if (VARIANT === 'old') {
  const fixed = /  const cur = s\.paused \? 0 : s\.speed;\n  document\.querySelectorAll\('\.sbtn'\)[^\n]*\n/;
  const before = uiSrc;
  uiSrc = uiSrc.replace(fixed,
    "  document.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('on', +b.dataset.sp === s.paused ? 0 : s.speed));\n");
  if (uiSrc === before) {
    console.log('❌ 无法构造"修复前"变体（源码结构已变），--variant=old 失效');
    process.exit(2);
  }
}

(0, eval)(uiSrc);
const D = window.__GG_DEBUG;
if (!D) { console.log('❌ 没有拿到 __GG_DEBUG 钩子'); process.exit(1); }

const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}
/* 读出当前处于 .on 的档位清单 */
function onSp() { return sbtns.filter(b => b.classList.contains('on')).map(b => b.dataset.sp); }

console.log('=== 倍速键高亮回归测试（变体：' + VARIANT + '）===\n');

D.start('grow', 'GG-SPEED', 8);
D.render();

console.log('不变量：4 个倍速键里「有且只有一个」高亮');
ok('开局 1× 时只有 1× 高亮', () => {
  const on = onSp();
  if (on.length !== 1 || on[0] !== '1') throw new Error('高亮集合是 [' + on.join(',') + ']，应为 ["1"]');
});
ok('切到 2× 时只有 2× 高亮', () => {
  D.onClick(D.ev({ sp: '2' }));
  const on = onSp();
  if (on.length !== 1 || on[0] !== '2') throw new Error('高亮集合是 [' + on.join(',') + ']，应为 ["2"]');
});
ok('切到 4× 时只有 4× 高亮', () => {
  D.onClick(D.ev({ sp: '4' }));
  const on = onSp();
  if (on.length !== 1 || on[0] !== '4') throw new Error('高亮集合是 [' + on.join(',') + ']，应为 ["4"]');
});
ok('暂停时只有 ❚❚(data-sp=0) 高亮', () => {
  D.onClick(D.ev({ sp: '0' }));
  const on = onSp();
  if (on.length !== 1 || on[0] !== '0') throw new Error('高亮集合是 [' + on.join(',') + ']，应为 ["0"]');
});
ok('连跑 20 帧渲染后不变量仍成立', () => {
  for (let i = 0; i < 20; i++) D.render();
  const on = onSp();
  if (on.length !== 1 || on[0] !== '0') throw new Error('渲染 20 帧后高亮集合变成 [' + on.join(',') + ']，应为 ["0"]');
});

console.log('\n' + (errs.length ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ') : '✅ 全部通过'));
process.exit(errs.length ? 1 : 0);
