/* 开局浮层布局守卫（源码级，不需要浏览器）
 *
 * 背景（2026-10-08 试玩反馈 + 同日真机复测）：
 *   「开始赛季」最初被内容挤到折叠线下 ⇒ 用 position:sticky 让它常驻底部。
 *   但 sticky 是**重叠式**的：它会把滚动内容压在身下。真机量到两种情形：
 *     · 有「继续上局」时 → 整排「节奏」被压到只剩 2px，看起来像不存在；
 *     · 没有时          → 被压的是「世界种子」输入框（可编辑字段躺在按钮底下）。
 *   修法：改成「固定页脚 + 独立滚动体」—— .modal 是 flex 列且不滚动，
 *         .mbody 承担滚动，.goFoot 回到普通流。
 *
 * 为什么这里不做几何断言：
 *   无头测试用的是极简 DOM 替身（innerHTML 只是字符串、querySelector 恒返回 null），
 *   量不了布局与遮挡；真几何只有真浏览器知道（见 dist/start-pick-test.html 那条路子）。
 *   所以退一步，守住「一旦破坏就必然复发」的结构不变量。
 *
 * 星级（docs/19 §2）也在这里守：
 *   唯一来源是 CORPS[].stars = { stab, profit, ease }（满星 5，读的人是 07-start.js）。
 *   2026-10-08 我一度另加了一张 CORP_STARS 表 —— 同一组数字两份来源，必然漂移，
 *   已回滚。所以这里专门加一条：**不许再出现第二张星级表**。
 *
 * 用法：node tools/start-overlay.test.cjs
 */
const fs = require('fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const errs = [];
function ok(label, fn) {
  try { fn(); console.log('  ✅ ' + label); }
  catch (e) { errs.push(label + ' → ' + e.message); console.log('  ❌ ' + label + ' → ' + e.message); }
}

const uiSrc = fs.readFileSync(path.join(ROOT, 'game', 'ui-parts', '07-start.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'game', 'style-3-fixes.css'), 'utf8');
const dataSrc = fs.readFileSync(path.join(ROOT, 'game', 'parts', '01-data.js'), 'utf8');

console.log('开局浮层：固定页脚 + 独立滚动体\n');

ok('模板里有滚动体 <div class="mbody">', () => {
  if (!/<div class="mbody">/.test(uiSrc)) throw new Error('没找到 <div class="mbody">');
});

const iMbodyOpen = uiSrc.indexOf('<div class="mbody">');
const iMbodyClose = uiSrc.indexOf('<!-- /.mbody');
const iSeed = uiSrc.indexOf('id="seedin"');
const iPace = uiSrc.indexOf('data-pace');
const iFoot = uiSrc.indexOf('class="goFoot"');

ok('.mbody 有明确闭合标记（后面所有顺序判断的前提）', () => {
  if (iMbodyClose < 0) throw new Error('没找到 <!-- /.mbody 闭合标记');
  if (!(iMbodyOpen < iMbodyClose)) throw new Error('.mbody 闭合标记出现在开标签之前');
});

ok('世界种子输入框与节奏按钮都在 .mbody 内部', () => {
  if (iSeed < 0) throw new Error('没找到 #seedin');
  if (iPace < 0) throw new Error('没找到 data-pace（节奏按钮）');
  if (!(iSeed < iMbodyClose)) throw new Error('#seedin 跑到 .mbody 之外了');
  if (!(iPace < iMbodyClose)) throw new Error('节奏按钮跑到 .mbody 之外了');
});

ok('★ .goFoot 在 .mbody 之外（兄弟节点）—— 这条一破，页脚压内容必复发', () => {
  if (iFoot < 0) throw new Error('没找到 class="goFoot"');
  if (iFoot < iMbodyClose) {
    throw new Error('.goFoot 被放回滚动体内部：覆盖式页脚会再次把「节奏」或「世界种子」压在按钮底下');
  }
});

ok('样式 #ovStart .goFoot 是 static（不是 sticky）', () => {
  if (/#ovStart\s+\.goFoot\s*\{[^}]*position\s*:\s*sticky/.test(cssSrc)) {
    throw new Error('又用回 position:sticky 了 —— sticky 是重叠式的，这正是当初 bug 的来源');
  }
  if (!/#ovStart\s+\.goFoot\s*\{[^}]*position\s*:\s*static/.test(cssSrc)) {
    throw new Error('#ovStart .goFoot 缺 position:static');
  }
});

ok('样式 #ovStart 是 flex 列 + .mbody 负责滚动', () => {
  if (!/#ovStart\s+\.modal\s*\{[^}]*display\s*:\s*flex/.test(cssSrc)) throw new Error('#ovStart .modal 缺 display:flex');
  if (!/#ovStart\s+\.mbody\s*\{[^}]*overflow\s*:\s*auto/.test(cssSrc)) throw new Error('#ovStart .mbody 缺 overflow:auto');
});

console.log('\n星级（唯一来源 CORPS[].stars）\n');

ok('六家公司都写了 stars{stab, profit, ease}，且都在 1..5', () => {
  const miss = [];
  ['grow', 'trade', 'intel', 'shell', 'make', 'fin'].forEach(id => {
    const i = dataSrc.indexOf("id:'" + id + "'");
    if (i < 0) { miss.push(id + '(没有这家公司)'); return; }
    const seg = dataSrc.slice(i, i + 260);
    const j = seg.indexOf('stars:');
    if (j < 0) { miss.push(id + '(没写 stars)'); return; }
    const s = seg.slice(j, j + 90);
    if (!s.includes('stab') || !s.includes('profit') || !s.includes('ease')) {
      miss.push(id + '(字段名不是 stab/profit/ease)'); return;
    }
    const nums = s.match(/\d+/g) || [];
    if (nums.length < 3) { miss.push(id + '(数值不全)'); return; }
    for (const v of nums.slice(0, 3)) {
      if (+v < 1 || +v > 5) miss.push(id + '(星级 ' + v + ' 越界，满星 5)');
    }
  });
  if (miss.length) throw new Error(miss.join('；'));
});

ok('★ 只有一处星级来源（不许再冒第二张表）', () => {
  if (/CORP_STARS/.test(dataSrc)) {
    throw new Error('又出现了 CORP_STARS：星级必须只有 CORPS[].stars 一处来源，平行表必然漂移');
  }
});

ok('开局卡片画的就是 c.stars 三档', () => {
  if (!/starTxt\(c\.stars\.stab\)/.test(uiSrc)) throw new Error('卡片没读 c.stars.stab');
  if (!/starTxt\(c\.stars\.profit\)/.test(uiSrc)) throw new Error('卡片没读 c.stars.profit');
  if (!/starTxt\(c\.stars\.ease\)/.test(uiSrc)) throw new Error('卡片没读 c.stars.ease');
});

ok('样式里有 #ovStart .starrow', () => {
  if (!/#ovStart\s+\.starrow\s*\{/.test(cssSrc)) throw new Error('style-3-fixes.css 里没有 #ovStart .starrow 规则');
});

console.log('\n' + (errs.length ? '❌ 共 ' + errs.length + ' 项失败：\n   - ' + errs.join('\n   - ') : '✅ 全部通过'));
process.exit(errs.length ? 1 : 0);
