/* 无头 UI 冒烟测试
 * 用一个极小的 DOM 替身加载 game/ui.js，然后：
 *   1) 每个视图都渲染一遍，确认不抛错、产出非空 HTML
 *   2) 通过同一套点击委托逻辑点一遍主要按钮，确认动作链路通
 *   3) 故意制造"现金不足 / 没货 / 没入围"等场景，确认错误文案能出来而不是崩
 * 用法：node tools/ui-smoke.cjs
 */
const fs = require('fs');
const path = require('path');

/* ---------------- 极小 DOM 替身 ---------------- */
function mkEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), _html: '', textContent: '', value: '', id: '',
    style: {}, dataset: {}, children: [], parentNode: null, onclick: null, selectionStart: 0,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); } },
    /* className 必须和 classList 双向同步。
       原来两者各存一份：代码里 `el.className='toast info'` 之后再问
       `classList.contains('toast')` 会得到 false —— 于是所有按 class 分支的逻辑
       （比如提示条的条数上限）在测试里静默走空转，测不出真机上的 bug。 */
    get className() { return [...this.classList._s].join(' '); },
    set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.unshift(c); return c; },
    get firstChild() { return this.children[0] || null; },
    /* remove() 必须真的从父节点摘掉。
       原来是空操作，于是「超出上限就丢掉最旧一条」这条逻辑在测试里等于没跑：
       被丢弃的节点还留在 children 里，测出来永远是 10 条。 */
    remove() {
      const p = this.parentNode;
      if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); this.parentNode = null; }
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, closePath() {}, setLineDash() {} }; },
    addEventListener() {}, focus() {}, setSelectionRange() {},
  };
  return el;
}
const els = {};
function getEl(sel) { if (!els[sel]) { els[sel] = mkEl('div'); els[sel].id = sel.replace('#', ''); } return els[sel]; }

const listeners = {};
global.document = {
  querySelector: sel => getEl(sel),
  querySelectorAll: () => [],
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
global.requestAnimationFrame = () => 0;      // 不跑真实循环，手动驱动
global.location = { reload() { } };
global.setTimeout = global.setTimeout;

/* ---------------- 加载引擎与 UI ---------------- */
const GG = require('../game/engine.js');
global.GG = GG;
// ui.js 是 IIFE，把 GG 挂到全局后直接 eval
const uiSrc = require('../game/ui.bundle.js').source();   /* ui 已模块化：见 game/ui.bundle.js */
let errs = [];
try { (0, eval)(uiSrc); }
catch (e) { console.log('❌ ui.js 加载即抛错：' + e.message); process.exit(1); }
const D = window.__GG_DEBUG;
if (!D) { console.log('❌ 没有拿到 __GG_DEBUG 钩子'); process.exit(1); }

/* ---------------- 驱动 ---------------- */
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); return true; }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); return false; }
}
function click(dataset) { D.onClick(D.ev(dataset)); }
/* 输入框在替身里是同一个桩对象，测试前显式喂值，否则读到 NaN */
function setVal(sel, v) { global.document.querySelector(sel).value = String(v); }

console.log('=== UI 无头冒烟测试 ===\n');

console.log('1) 开局四种公司各开一局，六个视图各渲染一遍');
for (const corp of ['grow', 'trade', 'intel', 'shell', 'make', 'fin']) {
  ok('开局 ' + corp, () => {
    D.start(corp, 'GG-UITEST-' + corp.toUpperCase(), 8);
    if (!D.G || !D.human) throw new Error('开局后没有玩家');
    for (const v of ['farm', 'make', 'market', 'intel', 'bank', 'auction', 'codex', 'end']) {
      D.setView(v);
      const html = D.viewHtml;
      if (typeof html !== 'string' || html.length < 30) throw new Error('视图 ' + v + ' 渲染为空');
      // 局中访问"结算"应当显示"进行中"，而不是出错或空白
      if (v === 'end' && !html.includes('进行中') && !html.includes('首席')) {
        throw new Error('结算视图局中状态不对：' + html.slice(0, 60));
      }
    }
    D.setView('farm');
    if (!D.topHtml.includes('第')) throw new Error('顶栏没渲染');
    if (!D.tabHtml.includes('市场')) throw new Error('标签没渲染');
  });
}

console.log('\n2) 主要按钮逐个点一遍（走真实点击委托）');
D.start('trade', 'GG-UICLICK', 8);
const before = D.human.cash;
ok('播种（一键）', () => { click({ pick: 'chili' }); click({ act: 'plantAll' }); });
ok('推进 250 秒后收割', () => { for (let i = 0; i < 250; i++) D.G.advanceReal(1); click({ act: 'harvestAll' }); });
ok('买入', () => { setVal('#q_chili', 12); click({ qin: 'chili' }); click({ buy: 'chili' }); });
ok('卖出', () => { setVal('#q_chili', 5); click({ sell: 'chili' }); });
ok('买满', () => { click({ buymax: 'radish' }); });
ok('数量选择 chips', () => { click({ qset: 'chili:20' }); click({ qset: 'radish:max' }); });
ok('挂单 / 撤单', () => {
  setVal('#q_radish', 6); setVal('#lp_radish', 8);
  click({ limit: 'radish:buy' });
  if (!D.human.limitOrders.length) throw new Error('挂单没成功：' + D.human.limitOrders.length);
  const o = D.human.limitOrders[0];
  if (o) click({ cancel: o.id });
});
ok('借货卖出 + 买回平仓', () => {
  D.G.act(D.G.s.humanId, 'loan', { amount: 6000 });
  setVal('#sq_chili', 8);
  click({ short: 'chili' });
  if (!D.human.shorts.chili) throw new Error('看跌仓位没建起来');
  if (D.human.shorts.chili) click({ cover: 'chili' });
});
ok('扩地 / 仓储 / 自动化 / 高产', () => {
  D.G.act(D.G.s.humanId, 'loan', { amount: 9000 });
  click({ act: 'expand' }); click({ act: 'upgradeStorage' });
  click({ auto: 0 });
});
ok('情报：听风声 / 买内幕 / 卖情报', () => {
  click({ intel: 'free' }); click({ intel: 'insider' }); click({ sellintel: 1 });
});
ok('放消息', () => { click({ pick: 'chili' }); click({ rumor: 'down' }); });
ok('钱庄：借钱 / 还钱', () => { setVal('#loanAmt', 1500); click({ loan: 1 }); click({ repay: 1 }); });
ok('皮包公司：注册 / 加厚 / 开关', () => {
  click({ shell: 'new' }); click({ shell: 'cover' }); click({ shell: 'toggle' }); click({ shell: 'toggle' });
});
ok('拍不到时的拍卖视图', () => { D.setView('auction'); });
ok('天赋弹层（造一个 Lv2）', () => {
  D.G._addCp(D.human, 60);
  if (!D.human.talentOffers) throw new Error('升级后没有给出天赋选项');
  click({ talent: D.human.talentOffers[0] });
  if (D.human.talentOffers) throw new Error('选完没清空');
});

console.log('2.5) 新增系统：制造 / 金融 / 存档 / 图鉴');
ok('制造：建作坊 + 开产 + 出货 + 卖成品', () => {
  D.start('make', 'GG-UIMAKE', 8);
  const lid = D.G.s.humanId;
  D.G.act(lid, 'plantAll', { crop: 'chili' });
  for (let i = 0; i < 320; i++) D.G.advanceReal(1);
  click({ act: 'harvestAll' });
  D.G.act(lid, 'loan', { amount: 3000 });
  click({ act: 'buildWorkshop' });
  D.setView('make');
  if (!D.viewHtml.includes('配方')) throw new Error('制造页没渲染配方');
  if (!D.human.workshops) throw new Error('作坊没建起来');
  click({ craft: 'sauce' });
  if (!D.human.craftJobs.length) throw new Error('加工批次没开起来');
  for (let i = 0; i < 400; i++) D.G.advanceReal(1);
  if (!(D.human.storage.sauce > 0)) throw new Error('成品没出货');
  if (!(D.human.brand > 0)) throw new Error('品牌值没涨');
  click({ sellone: 'sauce' });
  D.setView('market');
  if (!D.viewHtml.includes('辣酱')) throw new Error('市场页没显示加工品');
});
/* §17.1 / §17.2 两个新角色的**界面层**验证。
   为什么写在这里：浏览器面板视口塔缩成 2×2 像素、点击被拒（browser_click_out_of_viewport），
   主控无法目视复核 —— 而 ui-smoke 的 DOM 替身能拿到真实渲染出的 viewHtml。
   底层不变量已由 dealer.test.cjs / buyers.test.cjs 锁死，这里只锁“**真的画到屏幕上了**”。 */
ok('§17.1/§17.2 新角色：收货商的牌子 + 门口的买家', () => {
  D.start('grow', 'GG-UIBUYER', 8);
  const lid = D.G.s.humanId;
  D.G.act(lid, 'plantAll', { crop: 'radish' });
  for (let i = 0; i < 200; i++) D.G.advanceReal(1);
  click({ act: 'harvestAll' });
  D.setView('market');

  // ① 收货商的牌子（§17.1）—— 玩家必须能看见“他还收多少”
  if (!D.viewHtml.includes('收货摊')) throw new Error('市场页没渲染收货商的牌子');
  if (!/今天还能收|今天收够了/.test(D.viewHtml)) throw new Error('牌子没写出“今天还能收多少”');

  // ② 门口的买家（§17.2）—— 扫到真有人上门的那天
  let who = null;
  for (let d = 0; d < 60 && !who; d++) {
    D.G.s.t = d * 1440;
    who = ['hood', 'workshop', 'tycoon'].find(t => D.G.buyerOffer(D.human, t)) || null;
  }
  if (!who) throw new Error('扫了 60 天都没有买家上门');
  D.setView('market');
  if (!D.viewHtml.includes('上门来买')) throw new Error('市场页没渲染上门的买家');
  if (!D.viewHtml.includes('不会把行价砸下来')) throw new Error('买家卡片没说明“不砸价”');

  // ③ 点「卖给他」必须真的成交 —— 验 data-sellto 接线（没接上就会点了没反应）
  const cash0 = D.human.cash;
  click({ sellto: who });
  if (!(D.human.cash > cash0)) throw new Error('点「卖给他」没成交（data-sellto 接线断了）');

  // ④ 点「今天不了」之后，他今天就该消失
  const who2 = ['hood', 'workshop', 'tycoon'].find(t => D.G.buyerOffer(D.human, t)) || null;
  if (who2) {
    click({ decline: who2 });
    if (D.G.buyerOffer(D.human, who2)) throw new Error('点了「今天不了」他还在');
  }
});
ok('金融：低息借钱 + 放贷记账', () => {
  D.start('fin', 'GG-UIFIN', 8);
  const lid = D.G.s.humanId;
  D.G.act(lid, 'loan', { amount: 20000 });
  if (D.human.debt <= 0) throw new Error('借不到钱');
  D.setView('bank');
  if (!D.viewHtml.includes('借钱给人')) throw new Error('钱庄页没渲染借钱给人区');
  setVal('#lend_N1', 1200);
  click({ lend: 'N1' });
  if (!D.human.loansOut.length) throw new Error('放贷没记上账');
});
ok('存款 / 取款', () => {
  setVal('#depAmt', 800); click({ deposit: 1 });
  if (!(D.human.deposit >= 800)) throw new Error('存不进去');
  click({ withdraw: 1 });
  if (D.human.deposit > 1) throw new Error('取不出来');
});
ok('存档写入 localStorage 且读档后走势不分叉', () => {
  D.G.act(D.G.s.humanId, 'plantAll', { crop: 'chili' });
  for (let i = 0; i < 40; i++) D.G.advanceReal(1);
  D.__autosave();
  const sv = JSON.parse(localStorage.getItem('gg.save.v1') || 'null');
  if (!sv || !sv.blob) throw new Error('存档没写进去');
  const g2 = require('../game/engine.js').load(sv.blob);
  for (let i = 0; i < 80; i++) { D.G.advanceReal(1); g2.advanceReal(1); }
  const x = D.G.s.players[0].cash, y = g2.s.players[0].cash;
  if (Math.abs(x - y) > 1e-6) throw new Error('读档后走势分叉: ' + x + ' vs ' + y);
});
ok('复仇开局（标记 + 遗产天赋）', () => {
  D.start('trade', 'GG-UIREVENGE', 8, { nav: 5000, talentId: 'm2' });
  if (!D.human.isAvenger) throw new Error('没有复仇标记');
  if (!D.human.talents.includes('m2')) throw new Error('遗产天赋没生效');
});
ok('图鉴页', () => {
  D.setView('codex');
  if (!D.viewHtml.includes('我的生涯')) throw new Error('图鉴页没渲染');
});

console.log('\n3) 边界：故意让操作失败，必须给出文案而不是崩');
ok('现金不足时买入', () => {
  D.human.cash = 1; click({ buy: 'ginseng' }); D.human.cash = 5000;
});
ok('没货时卖出', () => { D.human.storage = {}; click({ sell: 'ginseng' }); });
ok('没入围时出价', () => {
  const a = D.G.s.auction;
  if (a) { setVal('#bidAmt', 500); a.phase = 'open'; a.finalists = []; click({ bid: 'open' }); }
  else console.log('     （此刻没有拍卖会，跳过）');
});
ok('仓储满时买入', () => {
  D.human.storage = {}; D.human.storage.chili = D.G.storageMax(D.human);
  click({ buy: 'chili' });
  D.human.storage = {};
});
ok('破产与出局后的渲染', () => {
  const victim = D.G.s.players.find(p => !p.isHuman);
  D.G._bankrupt(victim, '测试');
  D.setView('farm'); D.setView('market'); D.setView('bank');
  if (!D.G.s.over) D.G._end('测试结束');
  D.setView('end');
  if (!D.viewHtml.includes('首席')) throw new Error('结算页没渲染出首席');
});

console.log('\n4) 结算页含全部必需区块');
ok('结算页字段完整', () => {
  const h = D.viewHtml;
  for (const k of ['首席胜利者', '叙事提名', '全场账本', '我的赛季', '净资产']) {
    if (!h.includes(k)) throw new Error('结算页缺少「' + k + '」');
  }
});

console.log('\n5) 提示条上限（P0：改造前一次爆发能叠到 19 条、盖住整屏和页签栏）');
ok('同屏最多 3 条 + 溢出汇总成「还有 N 条」', () => {
  D.start('trade', 'GG-UITOAS', 8);
  const box = global.document.querySelector('#toasts');
  box.children.length = 0;                       // 清掉之前小节留下的提示
  for (let i = 1; i <= 10; i++) D.toast('回归测试消息 ' + i, 'info');
  const real = box.children.filter(n => n.classList.contains('toast') && !n.classList.contains('more'));
  const more = box.children.find(n => n.classList.contains('more'));
  if (real.length !== 3) throw new Error('同屏 ' + real.length + ' 条，应为 3 条');
  if (!more) throw new Error('没有生成溢出汇总条');
  if (!/^还有 \d+ 条$/.test(more.textContent)) throw new Error('汇总条文案不对：' + more.textContent);
  if (box.children.length !== 4) throw new Error('容器内有 ' + box.children.length + ' 个节点，应为 3 条 + 1 条汇总');
});
ok('同文本去重：不叠新条、不涨计数', () => {
  const box = global.document.querySelector('#toasts');
  const before = box.children.length;
  const n = box.children.filter(x => x.classList.contains('toast') && !x.classList.contains('more')).length;
  D.toast('回归测试消息 10', 'info');            // 和第 10 条完全一样
  D.toast('回归测试消息 10', 'info');
  if (box.children.length !== before) throw new Error('重复文本竟然新增了节点');
  const after = box.children.filter(x => x.classList.contains('toast') && !x.classList.contains('more')).length;
  if (after !== n) throw new Error('重复文本改变了同屏条数：' + n + ' → ' + after);
});

/* ============ 2026-10-08 玩家实测的两个真 bug：回归测试 ============
   为什么这两条必须单独存在：
   上面 2.5) 里那句 `click({ act: 'buildWorkshop' })` 配 `if (!D.human.workshops) throw`
   **一直是绿的，而那颗按钮其实是死的** —— 因为那一节用 D.start('make')，
   起始状态就把断言满足了。**用起始状态能满足的断言，等于没断言。**
   所以这里一律断言【变化量】。 */
console.log('\n2.7) 回归：「再建一间作坊」与「高产地」两个入口');
ok('建作坊：点一下作坊必须 +1（此前是死按钮 ⇒ 0 作坊时整个制造页永久全灰）', () => {
  D.start('grow', 'GG-UIWS', 8);
  const n0 = D.human.workshops;
  D.human.cash = 50000;                       // 排除“钱不够”这条干扰
  click({ act: 'buildWorkshop' });
  if (D.human.workshops !== n0 + 1) {
    throw new Error('点它没反应：作坊 ' + n0 + ' → ' + D.human.workshops +
      '。0 间时“开一批”的启用条件 workshops > busy 恒为 false，制造页全灰');
  }
  click({ act: 'buildWorkshop' });            // 再点一次（走 workshopCost2 那一支）
  if (D.human.workshops !== n0 + 2) throw new Error('第二次点也没反应');
  D.setView('make');
  if (!D.viewHtml.includes('条产线在跑')) throw new Error('制造页没渲染出产线占用');
  if (!D.viewHtml.includes(D.human.craftJobs.length + '/' + D.human.workshops + ' 条产线在跑')) {
    throw new Error('制造页的产线占用显示不对');
  }
});
ok('高产地：点一下必须真的升级那块地（此前引擎有动作、UI 无入口）', () => {
  const n0 = D.human.plots.filter(pl => pl.upgraded).length;
  D.human.cash = 50000;
  click({ upgrade: 0 });
  if (!D.human.plots[0].upgraded) throw new Error('点「高产地」没升级第 0 块地（data-upgrade 接线断了）');
  if (D.human.plots.filter(pl => pl.upgraded).length !== n0 + 1) throw new Error('升级的地块数不对');
});

console.log('\n2.8) 回归：输入框不再被每帧重写（玩家实测「疯狂闪动、一直往回跳」）');
/* 机制：#view 每 120ms 整体重写 innerHTML ⇒ 里面的 <input> 被**销毁重建** ⇒
   光标丢、值被旧值覆盖。两条断言各锁一半修法。 */
function countViewWrites(fn) {
  const vw = global.document.querySelector('#view');
  const desc = Object.getOwnPropertyDescriptor(vw, 'innerHTML');
  let n = 0;
  Object.defineProperty(vw, 'innerHTML', {
    configurable: true,
    get() { return this._html; },
    set(v) { n++; this._html = String(v); },
  });
  try { fn(); } finally { Object.defineProperty(vw, 'innerHTML', desc); }   // 原样还原
  return n;
}
ok('#view 内容没变 → 一次都不重写（农场/制造/钱庄这些静态视图从此零重写）', () => {
  D.start('trade', 'GG-UIRENDER', 8);
  D.setView('market');
  /* ⚠ 这里**故意不推进仿真**：不推进，市场页的 HTML 就一字不变，
     那么三次渲染理应**一次都不写** —— 修复前会写 3 次（输入框被反复销毁重建）。
     第一版我在这里多写了一行 advanceReal(1)，于是第一次渲染确实改了内容，
     断言 n===0 直接被我自己的测试冤枉了 —— 写错的测试比没测试更迷惑人。 */
  const n = countViewWrites(() => { D.render(); D.render(); D.render(); });
  if (n !== 0) throw new Error('状态没变却写了 ' + n + ' 次 innerHTML —— 输入框会被反复销毁重建');
});
ok('正在 #view 里打字 → 这一帧不重写（市场/拍卖每帧价格在变，靠这条兜住）', () => {
  D.start('trade', 'GG-UITYPE', 8);
  D.setView('market');
  const vw = global.document.querySelector('#view');
  const input = mkEl('input');
  input.tagName = 'INPUT'; input.id = 'q_chili';
  vw.children = [input];
  vw.contains = el => el === input;             // 替身默认没有 contains，这里补上
  const desc = Object.getOwnPropertyDescriptor(global.document, 'activeElement');
  Object.defineProperty(global.document, 'activeElement', { configurable: true, get: () => input });
  let n;
  try { n = countViewWrites(() => { D.G.advanceReal(1); D.render(); }); }
  finally { Object.defineProperty(global.document, 'activeElement', desc); }
  if (n !== 0) throw new Error('正在打字时竟然重写了 #view ' + n + ' 次 —— 输入框会被抢走');
});

console.log('\n2.10) 回归：六家公司的星级数据必须完整（2026-10-08 用户要求：稳定/利润/上手，满星五颗）');
/* 为什么值得测：星级是**纯展示数据** —— 漏了不会报错、不会抛异常、也不会缺 DOM，
   只会让某张公司卡渲染成“稳定 undefined”，或越界成“★★★★★★”。
   为什么读源码而不是读运行时：无头替身里 CORPS 挂在引擎导出的位置上，
   而“导出到底有没有 CORPS”属于我不该猜的东西 ——
   第一版写 D.GG.CORPS 直接 undefined 崩掉，就是猜 API 的代价。
   源码级断言足够守住这个回归，做法与 tools/start-overlay.test.cjs 一致。
   （星级的**渲染位置**在开局浮层，而布局需要真实排版引擎 —— 那条只能真机看。） */
ok('01-data.js：六个公司都有 stars{stab,profit,ease}，且都是 1..5', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'game', 'parts', '01-data.js'), 'utf8');
  const bad = [];
  for (const id of ['grow', 'trade', 'intel', 'shell', 'make', 'fin']) {
    const m = src.match(new RegExp("id:'" + id + "'[\\s\\S]{0,400}?stars:\\{([^}]*)\\}"));
    if (!m) { bad.push(id + '：没有 stars'); continue; }
    for (const k of ['stab', 'profit', 'ease']) {
      const km = m[1].match(new RegExp(k + ':\\s*(\\d+)'));
      const v = km ? +km[1] : null;
      if (v === null || v < 1 || v > 5) bad.push(id + '.' + k + ' = ' + v);
    }
  }
  if (bad.length) throw new Error('星级缺失或越界：' + bad.join(' / '));
});

console.log('\n2.11) 一级根屏「总账」（docs/20 §7 第一批第 1 项）');
/* 为什么要过“真点击委托”而不是直接改 ui.root：
   总账的入口是顶栏那颗 data-root 键，而它极易被 15-events 里
   `if (d.corp || d.pace) return;` 提前吞掉（导航键用 data-corp 就是死按钮）。
   所以这里往返一次：进总账 → 回公司层，并把 NaN/undefined 一并扫掉。 */
ok('顶栏 🏠 能进总账，总账里出公司卡', () => {
  D.start('grow', 'GG-UILEDGER', 8);
  click({ root: '1' });
  D.render();
  const h = D.viewHtml;
  /* ⚠ 哨兵从「身价」改成「手里的公司」：
     身价已经搬回顶栏（docs/20 §2.1 的 Z0 就是顶栏本身），而顶栏不在 #view 里，
     无头测不到。真正的总账正文标志是「手里的公司」这条表头。 */
  if (!h.includes('手里的公司')) throw new Error('总账里没有公司卡列表：' + h.slice(0, 90));
  if (!h.includes('进入经营')) throw new Error('公司卡上没有进经营入口：' + h.slice(0, 90));
  if (h.includes('NaN')) throw new Error('总账里出现 NaN');
  if (h.includes('undefined')) throw new Error('总账里出现 undefined');
});
ok('总账里点【进入经营】能回到公司工作台', () => {
  click({ enter: 'grow' });
  D.render();
  if (D.viewHtml.includes('手里的公司')) throw new Error('点了进经营却没离开总账');
  if (!D.viewHtml.includes('农田') && !D.viewHtml.includes('播种')) {
    throw new Error('回到的不是公司工作台：' + D.viewHtml.slice(0, 90));
  }
});

/* ⚠ 这一条是 code-reviewer 子代理扇出来的真 bug（R1）的回归锁：
   告急带的按钮用的是 data-view，而 `if (d.view)` 分支排在 d.root/d.enter **之前**，
   它只改 view 不复位 ui.root ⇒ 总账里点告急带，画面一字不变（“点了没反应”）。
   为什么原来三道守卫全漏了它：
     · wiring-check 只验“属性名有对应分派分支” —— 这里有，分支也在；
     · ui-smoke 上一版只点过 data-root / data-enter，从没点过告急带；
     · 告急带在初局是空的（现金不为负、没拍卖），根本渲染不出来。
   所以这里专门造一条告急（把现金压负 = 引擎允许的追保中间态），再点它。 */
ok('★ 总账的告急带按钮真的能换屏（R1 回归锁）', () => {
  D.start('grow', 'GG-UIBELT', 8);
  click({ root: '1' });
  D.render();
  if (!D.viewHtml.includes('手里的公司')) throw new Error('没进总账');
  D.human.cash = -1;
  D.render();
  if (!D.viewHtml.includes('钱庄随时上门')) {
    throw new Error('现金转负后告急带没出现：' + D.viewHtml.slice(0, 90));
  }
  click({ view: 'bank' });
  D.render();
  if (D.viewHtml.includes('手里的公司')) throw new Error('点了告急带却没离开总账（R1 复发）');
});

console.log('\n2.12) 一级屏「信匣｜邮箱」（docs/20 §7 第一批第 2 项）');
ok('顶栏信匣章能进信匣，没信时是空态', () => {
  D.start('grow', 'GG-UIMAIL', 8);
  click({ root: 'mail' });
  D.render();
  const h = D.viewHtml;
  if (!h.includes('信匣')) throw new Error('没进信匣：' + h.slice(0, 90));
  if (!h.includes('还没有人来信')) throw new Error('初局信匣不是空态：' + h.slice(0, 120));
  if (h.includes('undefined') || h.includes('NaN')) throw new Error('信匣里出现 undefined/NaN');
  /* 出路：信匣不是死胡同 —— 从信匣必须能回总账。
     这条是被真机截图遯出来的：面包屑当时只分两档，进信匣后左上角变成
     不可点的 <b>🏠 总账</b>，除了刷新页面根本出不去。 */
  click({ root: 'ledger' });
  D.render();
  if (!D.viewHtml.includes('手里的公司')) throw new Error('从信匣回不到总账（死胡同）');
  /* ⚠ 收尾：ui.root 是**全局 UI 状态**，会跨测试泄漏。
     我第一版就漏了这步 → 后面的 2.9（六公司×七视图查 NaN）在“农场页”上
     找不到扩地按钮，直接报「测试前提不成立」而变红。
     教训：测试结束后必须把自己的世界还原，不能把状态留给下一条测试。 */
  click({ enter: 'grow' });
});
/* ⚠ 信必须是**引擎自己寄的**，不能手改 s.inbox 造假数据 ——
   那样测的是我塞进去的对象，而不是“引擎真的会寄信”这条链路。
   所以这里的造法：把现金压负 → 走一次引擎动作触发 _flush → _mailTick 派生那封信。 */
ok('有信时列表出来、点开即已读、能返回', () => {
  D.start('grow', 'GG-UIMAIL', 8);
  D.human.cash = -1;
  click({ act: 'harvestAll' });          /* 任何走引擎的动作都会 _flush → _mailTick */
  D.render();
  click({ root: 'mail' });
  D.render();
  const list = D.viewHtml;
  if (!list.includes('钱庄')) throw new Error('引擎没派生“现金为负”那封信：' + list.slice(0, 160));
  if (list.includes('还没有人来信')) throw new Error('有信却还显示空态');
  /* 进入详情 */
  click({ mail: '1' });
  D.render();
  const det = D.viewHtml;
  if (!det.includes('你手上的现金已经是负的')) {
    throw new Error('详情页没拿到信的正文：' + det.slice(0, 160));
  }
  if (!det.includes('← 信匣')) throw new Error('详情页没有返回入口');
  
  /* 返回列表 */
  click({ mailback: '1' });
  D.render();
  if (!D.viewHtml.includes('信匣')) throw new Error('返回后没回到信匣');
  click({ enter: 'grow' });   /* 同上：还原成二级，别把 ui.root='mail' 漏给后面的测试 */
});

/* ⚠ 这一条测的是“别的公司来找你谈事”整条链路：提案 → 信 → 答复 → 钱货真的动。
   为什么不能用改随机数的办法造提案：提案走**独立随机流**（hash32(seed,'offers')），
   就是为了不让其它系统被动摇。所以这里用确定性的**推进时段**让它自然发生。 */
ok('★ 别的公司来信：能答复，且答了钱货真的会动（合作请求 / 收购通知）', () => {
  D.start('grow', 'GG-UIMAIL', 8);
  const g = D.G;
  let o = null;
  for (let slot = 1; slot <= 12 && !o; slot++) {
    g.s.t = slot * 8 * 60 + 1;          /* 直接推时间（只测提案通道，不测钟） */
    g._offerTick();
    o = (g.s.offers || []).find(x => x.status === 'open');
  }
  if (!o) throw new Error('推进 12 个时段，引擎一份提案都没发出');
  const m = (g.s.inbox || []).find(x => x.i === o.mailId);
  if (!m) throw new Error('提案没有对应的信（信与提案断了）');

  /* 列表里能看见，点开后能看到答复按钮 */
  click({ root: 'mail' });
  D.render();
  click({ mail: String(m.i) });
  D.render();
  const yes = 'accept:' + o.i;
  if (!D.viewHtml.includes('data-offer="' + yes + '"')) {
    throw new Error('信件详情里没有答复按钮：' + D.viewHtml.slice(0, 200));
  }

  /* 真答复 → 钱货必须真的动 */
  const before = D.human.cash;
  click({ offer: yes });
  D.render();
  if (o.status !== 'accepted') throw new Error('答复后提案状态不是已接受：' + o.status);
  if (o.kind === 'loan') {
    if ((D.human.loansOut || []).length !== 1) throw new Error('答应了借他钱，账上却没记一笔放贷');
    if (Math.abs((before - D.human.cash) - o.amount) > 1) throw new Error('借钱后现金没有按数扣掉');
  } else {
    if ((D.human.storage[o.crop] || 0) !== 0) throw new Error('答应了卖货，货却还在仓库里');
    if (D.human.cash <= before) throw new Error('卖货后现金没增加');
  }

  /* 同一件事不能成交两次 */
  const after = D.human.cash;
  click({ offer: yes });
  D.render();
  if (D.human.cash !== after) throw new Error('重复答复又动了一次钱（可以刷）');
  if (!D.viewHtml.includes('data-offer="' + yes + '"')) {
    /* 已答复后按钮应当消失，改成一句结果 */
  } else {
    throw new Error('已答复的提案还留着可点的按钮（假按钮）');
  }
  click({ enter: 'grow' });   /* 还原成二级，别把状态漏给后面的测试 */
});

console.log('\n2.9) 回归：界面上不许出现 NaN（2026-10-08 真机肉眼发现「扩一块地 (NaNG)」）');
/* 为什么值得全量扫：这类 bug 在 headless 里“不报错、不抛异常、也不缺 DOM”，
   只是把 undefined 算成了 NaN 写在按钮文案里 —— 只有盯着屏幕才看得见。
   但它机械可查：**渲染出的 HTML 里就是不该有 "NaN"**。
   真因：贸易/金融开局地块数 < BAL.startPlots ⇒ expandN 为负 ⇒
        plotExpandCost[负数] = undefined。（引擎 _a_expand 有 clamp 下界，UI 漏了。） */
ok('六家公司 × 七个视图：渲染出的 HTML 里一个 NaN 都不能有', () => {
  for (const corp of ['grow', 'trade', 'intel', 'shell', 'make', 'fin']) {
    D.start(corp, 'GG-UINAN-' + corp, 8);
    D.setView('farm');        /* ⚠ 必须先渲染再看：D.start() 不保证当前视图是农场。
                                 第一版没这一行，前提检查读到了上一个用例留下的视图，
                                 于是报“没渲染出扩地按钮”—— 测试错，不是代码错。 */
    if (!D.viewHtml.includes('扩一块地')) {
      throw new Error(corp + '：农场页没渲染出扩地按钮，测试前提不成立（留这条是防"空跑也能绿"）');
    }
    for (const v of ['farm', 'make', 'market', 'intel', 'bank', 'auction', 'codex']) {
      D.setView(v);
      const h = D.viewHtml;
      if (h.includes('NaN')) {
        const i = h.indexOf('NaN');
        throw new Error(corp + ' 的 ' + v + ' 页出现 NaN：…' +
          h.slice(Math.max(0, i - 80), i + 30).replace(/\s+/g, ' ') + '…');
      }
    }
  }
});

console.log('\n' + (errs.length ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ') : '✅ 全部通过'));
process.exit(errs.length ? 1 : 0);
