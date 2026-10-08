/* ===== part: 16-boot.js ===== */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.4, (now - last) / 1000); last = now;
  if (G) {
    if (!G.s.over) G.advanceReal(dt);
    // 新日志 → 吐司（只提示重要类型，避免刷屏）
    const feed = G.s.feed;
    for (let i = ui.seen; i < feed.length; i++) {
      const f = feed[i];
      /* 升级 / 点亮天赋（★ 开头）只进流水条，不弹提示。
         这是噪声最大的来源：一次开局就能攒出十几条 NPC 升级 + 天赋，全弹出来就是盖满整屏
         （见 toast() 的注释）。玩家自己升级有天赋弹窗，不会漏。 */
      if (f.text.charAt(0) === '★') continue;
      if (['event', 'auction', 'bad', 'good'].includes(f.kind)) {
        if (!(f.kind === 'good' && f.text.indexOf('收成') >= 0)) toast(f.text, f.kind === 'bad' ? 'err' : f.kind === 'good' ? 'ok' : 'info', 3000);
      }
    }
    ui.seen = feed.length;
    if (now - ui.lastRender > 120) { render(); ui.lastRender = now; }
    if (!G.s.over && now - (ui.lastSave || 0) > 10000) { ui.lastSave = now; autosave(); }
    // 重要事件的音效（日志里出现就响一次）
    if (!ui.lastEventText && G.s.activeEvents.length) { sfx.event(); ui.lastEventText = 1; }
    if (!G.s.activeEvents.length) ui.lastEventText = 0;
  }
  raf = requestAnimationFrame(frame);
}

/* ---------- 启动 ---------- */
/* URL 预设：?auto=1&corp=trade&view=market&warm=180&pace=8
   便于把某一局的具体状态做成可分享的链接，也用于自动截图。 */
(function bootPreset() {
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  if (!q || !q.get('auto')) { renderStart(); return; }
  start(q.get('corp') || 'trade', q.get('seed') || undefined, parseFloat(q.get('pace') || '8'));
  if (q.get('plant')) G.act(G.s.humanId, 'plantAll', { crop: q.get('plant') });
  const warm = parseFloat(q.get('warm') || '0');
  if (warm > 0) G.advanceGame(warm);           // warm 单位是"游戏分钟"
  setSpeed(q.get('speed') != null ? parseFloat(q.get('speed')) : 0);   // 截图默认暂停
  if (q.get('view')) { view = q.get('view'); }
  render(true);
})();
raf = requestAnimationFrame(frame);
/* 无头测试钩子：让 tools/ui-smoke.cjs 能在没有真实浏览器的情况下
   驱动同一套渲染与点击逻辑，确认每个视图都不抛错。 */
window.__GG_DEBUG = {
  get G() { return G; }, get human() { return HUMAN; },
  start, render, onClick,
  toast,   // 让无头测试能直接验证「同屏最多 3 条 + 溢出汇总」这条上限
  setView(v) { view = v; render(true); },
  ev(dataset) { return { target: { closest: () => ({ dataset, id: dataset.__id || '' }) } }; },
  get viewHtml() { return $('#view').innerHTML; },
  get tabHtml() { return $('#tabs').innerHTML; },
  get topHtml() { return $('#clock').innerHTML + '|' + $('#navbig').innerHTML + '|' + $('#phasetag').textContent; },
  __autosave: autosave,
  __save: () => GG.save(G),
  __continue: continueSave,
  __startMeta: () => ({ canContinue: !!store.get(LS.save, null), label: (document.getElementById('cont') || {}).textContent }),
};
