/* ===== part: 15-events.js ===== */
let lastPointerUpAt = -1e9;
function onPointerUp(e) {
  if (e.button != null && e.button !== 0) return;   // 只认左键 / 触摸抬起
  lastPointerUpAt = performance.now();
  handleAction(e);
}
function onClick(e) {
  if (performance.now() - lastPointerUpAt < 700) return;   // 这次按压已由 pointerup 处理
  handleAction(e);
}
function handleAction(e) {
  /* 流水条整条就是展开/收起的开关。
     fl.id === 'feed' 这层判断是必需的：ui-smoke 的 DOM 替身里 closest() 一律返回一个
     真值对象，不加这层守卫，测试里每一次点击都会被当成"点了流水条"而提前 return。 */
  const fl = e.target && e.target.closest ? e.target.closest('#feed') : null;
  if (fl && fl.id === 'feed') { ui.feedOpen = !ui.feedOpen; render(true); return; }

  let t = e.target.closest('button, [data-view]');
  /* 兜底：mousedown/mouseup 之间容器被重渲染过时，click 会落在共同祖先上，
     closest() 就拿不到按钮。用坐标做一次命中测试，把指针底下真正的按钮找回来。
     这条同时保护 #tabs 和每帧重写的 #view。 */
  if (!t && e.clientX != null && document.elementsFromPoint) {
    /* 只认最顶层那一个命中结果。
       原先遍历整条栈，会把“被浮层（toast 等）盖住的按钮”也捞出来执行 ——
       即按在浮层上却触发了下面按钮的动作。取 stack[0] 既够用（按钮就在指针正下方），
       又不会点到被遮住的元素。 */
    const top = (document.elementsFromPoint(e.clientX, e.clientY) || [])[0];
    const b = top && top.closest ? top.closest('button, [data-view]') : null;
    if (b) t = b;
  }
  if (!t || !G) return;
  const d = t.dataset;

  /* ⚠ 总账（ui.root）下也必须能切屏：d.view 分支排在 d.root/d.enter **之前**，
     而它只改 view、不复位 ui.root —— 于是 ui.root===true 时点告急带的
     「钱庄随时上门 / 拍卖进行中」，14-render 仍走 viewLedger()，画面一字不变，
     玩家看到的是“点了没反应”；而且 view 被悄悄改掉，下次点「进入经营」会进错屏。
     这是 code-reviewer 子代理扫出来的：属性名正确、分支也存在，
     所以 wiring-check 静态抓不到，ui-smoke 也没点过告急带 —— 正是守卫的盲区。 */
  if (d.view) { if (ui.root) ui.root = false; view = d.view; render(true); return; }
  /* 一级 ↔ 二级导航（docs/20 §2.3）。
     ⚠ 必须排在下一条 `if (d.corp || d.pace) return;` **之前**：
       那句话会把 data-corp 吞掉（开局浮层在用那个键），
       所以总账进公司用 data-enter、回根用 data-root，且优先分派。 */
  /* 信匣：打开一封 / 返回列表。已读写进引擎状态，空态则回列表（见 18-mail.js）。 */
  if (d.mail) { mailOpenBy(+d.mail); return; }
  if (d.mailback) { mailClose(); return; }
  /* 答复信里的提案（合作请求 / 收购通知）。
     走引擎动作 _a_acceptOffer / _a_declineOffer —— 钱货结算、流水、存档全在引擎
     那一侧完成，UI 只管把“谁答复了哪一条、接不接受”送进去。 */
  if (d.offer) {
    const [k, oid] = d.offer.split(':');
    A(k === 'accept' ? 'acceptOffer' : 'declineOffer', { id: +oid });
    render(true); return;
  }
  /* data-root：一级屏切换（docs/20 §3）。值 = 去哪张一级屏：
       'ledger'（默认，合并老存档里的 "1"） / 'mail'（顶栏信匣章）。
     ⚠ ui.root 因此从布尔变成**模式串**：布尔存不下“我有两张一级屏”，
       以后加行市/黄历还得再改一次。falsy 一律表示二级公司工作台。 */
  /* ⚠ 一级屏模式**必须白名单放行**：原来写的是 `d.root === 'mail' ? 'mail' : 'ledger'` 的两档写法，
   一级屏一旦多起来（现在 7 张），进店行的 5 个键会**全部塌成总账**（点了没反应 = 死按钮）。
   这与面包屑那次（信匣死胡同）是同一个坑的两面：**旧的两档假设**。
   白名单与 14-render 里的 first 表同源，改一处要一起改。
   顺手清 mailOpenId：从任意一级屏回总账，下次进信匣不该直接弹在上次那封信上。 */
if (d.root) {
       const FIRST_MODES = ['ledger', 'mail', 'market', 'intel', 'bank', 'auction', 'codex'];
       ui.root = FIRST_MODES.indexOf(d.root) >= 0 ? d.root : 'ledger';
       mailOpenId = null;
       render(true); return;
     }
  /* 回公司层时顺手关掉信匣详情：否则下次进信匣会直接弹在上次那封信上。 */
  if (d.enter) { ui.root = false; mailOpenId = null; view = 'farm'; render(true); return; }
  if (d.corp || d.pace) return;
  if (d.sp != null) { setSpeed(+d.sp); renderTop(); return; }
  if (d.view === 'end') return;

  if (d.pick) { ui.pick = d.pick; render(true); return; }
  if (d.plant != null) { A('plant', { crop: ui.pick, index: +d.plant }); return; }
  if (d.harvest != null) { A('harvest', { index: +d.harvest }); return; }
  if (d.auto != null) { A('buyAuto', { index: +d.auto }); return; }
  /* 高产地升级：引擎从第一天就有这个动作（_a_upgradePlot + BAL.plotUpgradeCost
     + 身价核算 07-metrics 里的 pl.upgraded），但 UI 从来没给过入口 ——
     是一样由 tools/wiring-check.cjs 的【反向检查】扫出来的。 */
  if (d.upgrade != null) { A('upgradePlot', { index: +d.upgrade }); return; }
  /* 「等着」按钮已删（2026-10-08）：它只弹一条和卡片上已写着的倒计时完全重复的 toast，
     零信息增量；而 docs/06 §6 的新手引导脚本里从未设计过这颗按钮（那里只要求
     「卡片显示进度条 + 还差 16 秒」和「成熟时闪绿边 + 吐司：熟了。割不割？」）——
     它是实现阶段留下的空壳。同时把「自动化 900」改成「自动收割 900G」：
     原文字没有告诉玩家“自动什么”，也没有货币单位，连策划本人（2026-10-08）都读不出来它是什么。 */

  if (d.act === 'plantAll') { A('plantAll', { crop: ui.pick }); return; }
  if (d.act === 'harvestAll') { A('harvestAll'); return; }
  if (d.act === 'expand') { A('expand'); return; }
  if (d.act === 'upgradeStorage') { A('upgradeStorage'); return; }
  /* ⚠ 2026-10-08 玩家实测「工坊修不了，没法买」的**根因**：
     viewMake() 一直在渲染「再建一间作坊」这颗按钮，
     但分派表里从来没有这一支 —— 按钮是死的 ⇒ 作坊永远 0 间
     ⇒ _a_craft 里 `p.workshops <= 0` 直接拒绝、"开一批" 的启用条件
       `HUMAN.workshops > busy` 又恒为 `0 > 0` = false ⇒ 永久灰。
     **一颗死按钮同时造成"建不了（没法买）"和"开不了（修不了）"两个症状。**
     （这个类别由 tools/wiring-check.cjs 钉死：UI 渲染出的每个 data-act，
       必须在分派表里有对应的 `d.act === '…'` 分支。） */
  if (d.act === 'buildWorkshop') { A('buildWorkshop'); return; }
  /* §4.12 从公司拿钱：默认拿满（= 公司现金 × 持股 × 0.8 的上限）。
     它是**借款**、要还，所以身价当场不变 —— 拿钱不是印钞（见 `_a_take`）。 */
  if (d.act === 'take') { A('take', {}); return; }

  if (d.qset) {
    const [cid, v] = d.qset.split(':');
    ui.qty[cid] = v === 'max' ? G.quote(HUMAN, cid, 1, 'buy').maxQty : +v;
    render(true); return;
  }
  /* §17.2 上门的买家 */
  if (d.sellto) { A('sellTo', { type: d.sellto }); return; }
  if (d.decline) { A('declineBuyer', { type: d.decline }); return; }
  if (d.buy) { A('buy', { crop: d.buy, qty: qtyOf(d.buy) }); return; }
  if (d.sell) { A('sell', { crop: d.sell, qty: qtyOf(d.sell) }); return; }
  if (d.buymax) { const q = G.quote(HUMAN, d.buymax, 1, 'buy').maxQty; A('buy', { crop: d.buymax, qty: q }); return; }
  if (d.limit) {
    const [cid, side] = d.limit.split(':');
    const p = parseFloat($('#lp_' + cid).value);
    A('limit', { crop: cid, side, qty: qtyOf(cid), price: p });
    return;
  }
  if (d.cancel) { A('cancelOrder', { id: +d.cancel }); return; }
  if (d.short) {
    const q = parseInt($('#sq_' + d.short).value, 10) || 10;
    A('short', { crop: d.short, qty: q });
    return;
  }
  if (d.cover) { A('cover', { crop: d.cover }); return; }

  if (d.craft) { A('craft', { product: d.craft }); return; }
  if (d.buyneed) {
    const pd = GG.PRODUCTS.find(x => x.id === d.buyneed);
    const need = pd.need - (HUMAN.storage[pd.from] || 0);
    if (need > 0) A('buy', { crop: pd.from, qty: need });
    return;
  }
  if (d.sellone) { A('sell', { crop: d.sellone, qty: HUMAN.storage[d.sellone] || 0 }); return; }
  if (d.deposit) { const v = parseInt($('#depAmt').value, 10) || 0; A('deposit', { amount: v }); return; }
  if (d.withdraw) { A('withdraw', { amount: Math.floor(HUMAN.deposit) }); return; }
  if (d.lend) {
    const el = $('#lend_' + d.lend);
    const v = parseInt(el ? el.value : '0', 10) || 0;
    A('lend', { pid: d.lend, amount: v });
    return;
  }
  if (d.intel) { const r = A('intel', { tier: d.intel }, true); if (r.ok) { ui.lastIntel = r.msg; toast(r.msg, 'info', 5000); render(true); } return; }
  if (d.sellintel) { A('sellIntel'); return; }
  if (d.rumor) { A('rumor', { crop: ui.pick, dir: d.rumor }); return; }

  if (d.loan) { const v = parseInt($('#loanAmt').value, 10) || 0; A('loan', { amount: v }); return; }
  if (d.repay) { A('repay', { amount: HUMAN.cash }); return; }
  if (d.shell === 'new') { A('shell'); return; }
  if (d.shell === 'cover') { A('shell', { cover: 1 }); return; }
  if (d.shell === 'toggle') { A('shellToggle', { on: !HUMAN.shell.on }); return; }

  if (d.bid) { const v = parseInt($('#bidAmt').value, 10) || 0; A('bid', { amount: v }); return; }

  if (d.talent) {
    const r = A('talent', { id: d.talent });
    if (r.ok) { $('#ovTalent').classList.add('hide'); toast('本领已生效', 'ok'); }
    return;
  }
  if (t.id === 'reroll') { A('reroll'); talentModal(); return; }
}
/* pointerup 为主（抗重渲染），click 兜底键盘与辅助技术 */
document.addEventListener('pointerup', onPointerUp, true);
document.addEventListener('click', onClick);
function qtyOf(cid) {
  const el = $('#q_' + cid);
  const v = el ? parseInt(el.value, 10) : NaN;
  return isNaN(v) || v <= 0 ? (ui.qty[cid] || 10) : v;
}

['input', 'change'].forEach(ev => document.addEventListener(ev, e => {
  const t = e.target;
  if (t.dataset && t.dataset.qin) { const v = parseInt(t.value, 10); if (!isNaN(v)) ui.qty[t.dataset.qin] = v; }
}));

/* ---------- 主循环 ---------- */
