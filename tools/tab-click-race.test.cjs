/* 标签点击竞态回归测试
 *
 * 背景（真实故障）：render() 每 120ms 跑一次，里面会重建 #tabs 的 innerHTML。
 * 一次人手点击的 mousedown→mouseup 常在 80~150ms，正好会跨过一次重建；
 * 此时浏览器把 click 派发到共同祖先 #tabs（它没有 data-view），
 * 事件委托里 e.target.closest('button,[data-view]') 拿到 null，点击被静默吞掉
 * —— 表现就是"点标签没反应"（浏览器工具用 ref 点击时 100% 复现）。
 *
 * 本测试断言两条不变量：
 *   T1 无变化时 render() 不得重写 #tabs.innerHTML（节点在帧间保持稳定）
 *   T2 视图切换时必须更新高亮（防止"修过头"把渲染整个跳过）
 *   T3 click 落到 #tabs 容器时，必须靠坐标命中测试把点击救回来
 *   T4 正常点击路径不受影响
 *
 * 用法：
 *   node tools/tab-click-race.test.cjs              # 期望全绿
 *   node tools/tab-click-race.test.cjs --variant=old  # 还原修复前写法，期望红（证明测试有效）
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

let hitTestCalls = 0;
const listeners = {};
global.document = {
  querySelector: sel => getEl(sel),
  querySelectorAll: () => [],
  getElementById: id => els['#' + id] || (els['#' + id] = mkEl('div')),
  createElement: mkEl,
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  get activeElement() { return null; },
  /* 命中测试替身：真浏览器里它返回指针底下由顶到底的元素栈。
     这里复刻"指针底下确实是个标签按钮"的情形。 */
  elementsFromPoint() {
    hitTestCalls++;
    return [{ closest: () => ({ dataset: { view: 'make' } }) }];   /* market 已搬去集团层，底栏只剩 农田/制造 */
  },
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

/* ---------------- 加载 ui.js（可按变体还原修复前写法） ---------------- */
const GG = require('../game/engine.js');
global.GG = GG;
let uiSrc = require('../game/ui.bundle.js').source();   /* ui 已模块化：见 game/ui.bundle.js */

if (VARIANT === 'old') {
  const before = uiSrc;
  // 还原 1：无条件重写 innerHTML
  uiSrc = uiSrc.replace('if (box.innerHTML === html) return;', '/* 修复前：无条件重写 */');
  // 还原 2：去掉 onClick 里的坐标命中测试兜底
  uiSrc = uiSrc.replace(/  \/\* 兜底：[\s\S]*?\n  \}\n/, '');
  if (uiSrc === before || uiSrc.includes('兜底：')) {
    console.log('❌ 无法构造"修复前"变体（源码结构已变），--variant=old 失效');
    process.exit(2);
  }
}

(0, eval)(uiSrc);
const D = window.__GG_DEBUG;
if (!D) { console.log('❌ 没有拿到 __GG_DEBUG 钩子'); process.exit(1); }

/* 给 #tabs 装一个写入计数器：这是本测试的核心观测点 */
const tabsEl = global.document.querySelector('#tabs');
let tabWrites = 0;
let _h = tabsEl.innerHTML;
Object.defineProperty(tabsEl, 'innerHTML', {
  get() { return _h; },
  set(v) { _h = String(v); tabWrites++; },
  configurable: true,
});

/* ---------------- 跑 ---------------- */
const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}

console.log('=== 标签点击竞态回归测试（变体：' + VARIANT + '）===\n');

D.start('grow', 'GG-TAB-RACE', 8);
D.render();

console.log('T1 无变化时 render() 不得重写 #tabs.innerHTML');
ok('连续 20 帧渲染后标签栏未被重写', () => {
  const n0 = tabWrites;
  for (let i = 0; i < 20; i++) D.render();
  const extra = tabWrites - n0;
  if (extra !== 0) {
    throw new Error('标签栏被无谓重写了 ' + extra + ' 次 —— 这正是点击被吞的根因');
  }
});

console.log('\nT2 视图切换时必须更新高亮（防止修过头）');
ok('切到市场后高亮更新', () => {
  const n0 = tabWrites;
  D.setView('make');   /* market 已搬去集团层（总账 Z4 进店行），底栏只剩 农田/制造 */
  if (!D.tabHtml.includes('class="tab on" data-view="make"')) {
    throw new Error('高亮没跟到市场：' + D.tabHtml.slice(0, 120));
  }
  if (tabWrites <= n0) throw new Error('视图变了却没重写标签栏，高亮不可能更新');
});

console.log('\nT3 复现竞态：click 落到 #tabs 容器上时必须能救回来');
ok('mousedown 后跨过一次重渲染，点击仍生效', () => {
  D.setView('farm');
  hitTestCalls = 0;
  D.render();                                   // 模拟 mousedown 与 mouseup 之间发生的那次重建
  const container = { id: 'tabs', closest: () => null };   // 浏览器派发 click 的共同祖先
  D.onClick({ target: container, clientX: 424, clientY: 20 });
  if (!D.tabHtml.includes('data-view="make"') || !D.tabHtml.includes('class="tab on" data-view="make"')) {
    throw new Error('点击被吞掉了，标签停在了农田：' + D.tabHtml.slice(0, 120));
  }
  if (VARIANT === 'new' && hitTestCalls === 0) {
    throw new Error('走了兜底却没调用 elementsFromPoint（兜底逻辑没生效）');
  }
});

console.log('\nT4 正常点击路径不受影响');
ok('target 直接是按钮时正常切换', () => {
  /* ⚠ 原来这里点的是 bank（钱庄）—— 钱庄已搬去集团层，底栏没有它的页签了。
     改成 farm：T3 结束时停在各 make，再点 farm 才是**一次真的切换**
     （点同一个页签证明不了“正常点击仍生效”）。 */
  D.onClick(D.ev({ view: 'farm' }));
  if (!D.tabHtml.includes('class="tab on" data-view="farm"')) {
    throw new Error('正常点击反而坏了：' + D.tabHtml.slice(0, 120));
  }
});

console.log('\n' + (errs.length ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ') : '✅ 全部通过'));
process.exit(errs.length ? 1 : 0);
