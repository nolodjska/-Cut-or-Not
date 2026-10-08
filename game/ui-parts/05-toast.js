/* ===== part: 05-toast.js ===== */
const TOAST_MAX = 3;
function toast(msg, kind, ms) {
  if (kind === 'ok') sfx.ok(); else if (kind === 'err') sfx.err();
  const box = $('#toasts');
  if (!box) return;
  const k = kind || 'info';
  const life = ms || 2200;

  const liveNodes = () => [...box.children].filter(n => n.classList.contains('toast') && !n.classList.contains('more'));

  /* 同文本去重：一连串「XX 的挂单成交」只占一格，而不是叠成一堵墙 */
  const same = liveNodes().find(n => n.dataset.msg === msg && n.dataset.kind === k);
  if (same) {
    clearTimeout(same._t1); clearTimeout(same._t2);
    same._t1 = setTimeout(() => { same.style.opacity = '0'; same.style.transition = 'opacity .3s'; }, life);
    same._t2 = setTimeout(() => { same.remove(); clearMore(); }, life + 350);
    return;
  }

  const el = document.createElement('div');
  el.className = 'toast ' + k;
  el.textContent = msg;
  el.dataset.msg = msg;
  el.dataset.kind = k;
  el._t1 = setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, life);
  el._t2 = setTimeout(() => { el.remove(); clearMore(); }, life + 350);
  box.appendChild(el);

  /* 硬上限：每次插入后都裁一遍，所以无论上游怎么爆发，同屏都不会超过 TOAST_MAX 条 */
  const live = liveNodes();
  if (live.length > TOAST_MAX) {
    live.slice(0, live.length - TOAST_MAX).forEach(n => {
      clearTimeout(n._t1); clearTimeout(n._t2);
      n.remove();
      ui.toastOverflow++;
    });
  }
  renderMore();
}

/* 「还有 N 条」汇总条：只在确实丢过提示时出现，挂在栈顶（代表更早、已被折叠的那些） */
function moreNode() {
  const box = $('#toasts');
  if (!box) return null;
  // 用 children 查而不是 querySelector：ui-smoke 的 DOM 替身没有实现 querySelector，
  // 走 querySelector 会在测试里每弹一条就新建一个汇总条，越积越多。
  let n = [...box.children].find(x => x.classList && x.classList.contains('more'));
  if (!n) {
    n = document.createElement('div');
    n.className = 'toast more';
    if (box.firstChild) box.insertBefore(n, box.firstChild); else box.appendChild(n);
  }
  return n;
}
function renderMore() {
  const n = moreNode();
  if (!n) return;
  if (ui.toastOverflow > 0) { n.textContent = '还有 ' + ui.toastOverflow + ' 条'; n.style.display = ''; }
  else n.style.display = 'none';
}
/* 一条都不剩时把计数清零，避免下一轮开局直接带着上一轮的残留数字 */
function clearMore() {
  const box = $('#toasts');
  if (!box) return;
  /* ⚠ box.children 是 HTMLCollection，没有 .some() —— 必须先用展开运算符转成数组。
     ui-smoke 的 DOM 替身把 children 做成了数组，所以这条在测试里不会报，只会在真机炸；
     症状是顶栏下方常驻一行「脚本出错: Uncaught TypeError: box.children.some is not a function」。 */
  if ([...box.children].some(n => n.classList.contains('toast') && !n.classList.contains('more'))) return;
  ui.toastOverflow = 0;
  [...box.children].forEach(n => { if (n.classList.contains('more')) n.remove(); });
}

/* ---------- 动作包装 ---------- */
