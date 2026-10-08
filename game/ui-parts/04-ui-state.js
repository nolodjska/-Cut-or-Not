/* ===== part: 04-ui-state.js ===== */
const ui = {
  qty: {}, pick: 'radish', seen: 0, lastRender: 0, pace: 8,   // 默认萝卜：新手第一个闭环只要 16 秒
  lastIntel: null, intelOpen: false, warnShown: false, talentFor: 0, tabDot: {},
  feedOpen: false, toastOverflow: 0,
  /* 一级（集团总账）还是二级（公司工作台），docs/20 §3 两级导航。
     初值取 false：docs/20 §1.1 说总账是“默认落点”，但新手引导（docs/06）
     要求开赛后直奔农田 —— 两者还没定就取保守值（行为零变化），
     由顶栏 🏠 进总账。要不要改成 true，等策划定。 */
  root: false,
};

/* 有美术就用美术，没有就退回 emoji（单文件不带头图也能玩） */
const ICON_FILE = { radish:'radish', chili:'chili', ginseng:'ginseng' };
const EV_ART = { drought:'drought' };
function icon(id, size) {
  const g = G.good(id) || {};
  const emoji = g.icon || '❓';
  const px = size || 22;
  const file = ICON_FILE[id];
  const style = `width:${px}px;height:${px}px;font-size:${px * 0.8}px`;
  if (!file) return `<span class="icwrap noart" style="${style}"><em>${emoji}</em></span>`;
  return `<span class="icwrap" style="${style}">
    <img src="assets/icon-${file}.webp" alt="" loading="lazy"
         onerror="this.closest('.icwrap').classList.add('noart')">
    <em>${emoji}</em></span>`;
}

/* ---------- 时间 / 文案 ---------- */
function dayOf(t) { return Math.floor(t / 1440) + 1; }
function hhmm(t) {
  const m = Math.floor(t % 1440);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
}
function phaseText() {
  const s = G.s, d = dayOf(s.t);
  if (s.countdown) {
    const h = (s.countdown.until - s.t) / 60;
    return '⚑ 终局倒计时 ' + secLeftTxt(s.countdown.until - s.t) + '：' + G._pidName(s.countdown.pid) + ' 正在锁死 ' +
      s.crops[s.countdown.crop].name + '，去打断他';
  }
  if (s.auction && s.auction.phase !== 'done') {
    const a = s.auction;
    const end = a.phase === 'sealed' ? a.sealedEndT : a.openEndT;
    return '🔨 拍卖会进行中（' + (a.phase === 'sealed' ? '暗标' : '明标') + '，剩 ' +
      secLeftTxt(end - s.t) + '）';
  }
  if (d === 1) return '拓荒期：先让地里有东西，再谈别的';
  if (d === 2) return '分化期：有人开始动手了，今天有拍卖会';
  return '决战期：最后一天，算总账';
}

/* 把游戏时间换算成"人话"的倒计时：拍卖窗口这类同步事件按真实秒算，
   世界进程按游戏小时算。不换算的话，标准局里明标只剩 2.7 秒，玩家看不到也反应不过来。 */
function secLeftTxt(gameMin) {
  if (!G) return '—';
  const real = G.realSecLeft(gameMin);
  if (real < 120) return real.toFixed(0) + ' 秒';
  return (gameMin / 60).toFixed(1) + ' 游戏小时';
}

/* ---------- 吐司 ----------
   上限 3 条 + 溢出汇总成「还有 N 条」。
   旧实现只是 appendChild + setTimeout 删除，**没有任何上限**；而引擎有 40+ 处 _log()，
   日结批处理 / NPC 升级 / 事件 / 拍卖会在同一帧吐出十几条，主循环又对每条新流水都弹一个
   （见 frame()）。实测一次开局能同屏叠 19 条、栈顶冲到 y=-52px —— 整屏连同底部页签栏
   全被盖住，玩家在关键节奏点上看不见也点不了任何东西。
   口径：同屏最多 3 条；同文本同类型去重（只把计时往后推）；超出的丢掉最旧一条并累加计数。 */
