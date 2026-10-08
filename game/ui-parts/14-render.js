/* ===== part: 14-render.js ===== */
function render(force) {
  if (!G) return;
  const ae = document.activeElement;
  const keepId = ae && ae.id ? ae.id : null;
  const selS = ae && ae.selectionStart != null ? ae.selectionStart : null;

  renderTop(); renderTabs();
  const map = { farm: viewFarm, make: viewMake, market: viewMarket, intel: viewIntel, bank: viewBank, auction: viewAuction, codex: viewCodex, end: viewEnd };

  /* ⚠ 玩家 2026-10-08 实测：「输入框疯狂闪动，我填购买/卖出个数的时候一直往回跳」。
     根因：#view 每 120ms 整体重写 innerHTML，里面的 <input> 是**被销毁重建**的。
     修法两半，各管一类视图：
       ① 内容没变就不碰 DOM（与 renderTabs 同一套做法）——
          农场/制造/情报/钱庄这类静态视图从此根本不重写，闪动直接消失；
       ② 市场/拍卖这类**每帧价格都在变**的视图，①拦不住。所以只要玩家正在
          #view 里的输入框打字，就这一帧不重写 #view。
          抢用户正在编辑的 DOM 才是病根，把值再写回去治不了。
          （代价：打字时价格最多冻一秒。交易按引擎实时价成交，不影响正确性。）
     ③ 只有真的重写了 DOM，才需要恢复焦点 —— 否则 el.focus() 会把
        玩家刚放好的光标又挪走（number 输入框还恢复不了选区）。 */
  const vw = $('#view');
  /* 一级根屏（集团总账）与二级公司工作台是**两套屏幕**（docs/20 §3）。
     ⚠ 不要把总账塞进 map 当第 9 个 view：那会把它和 7 个页签**平级**，
       而它是页签的**上级**（把爸爸塞进儿子班）。 */
  const html = ui.root ? viewLedger() : (map[view] || viewFarm)();
  const typing = ae && ae.tagName === 'INPUT' && vw.contains && vw.contains(ae);
  const rewrote = !typing && vw.innerHTML !== html;
  if (rewrote) vw.innerHTML = html;
  drawSparklines();

  /* 流水条：默认只留最近一条，点一下展开 5 条。
     开关不能做成 #feed 里的按钮 —— #feed 每 120ms 被重写，会复现「点页签没反应」同源的丢点击；
     所以整条 #feed 本身就是开关（见 handleAction），展开状态存在 ui.feedOpen 而不是 DOM 上。 */
  const fe = $('#feed');
  const rows = G.s.feed.slice(-(ui.feedOpen ? 5 : 1));
  const tail = '<span class="fmore">' + (ui.feedOpen ? '收起 ▴' : '全部 ▾') + '</span>';
  fe.innerHTML = rows.map((f, i) =>
    `<div class="lg ${f.kind}"><span class="lgt">${esc(f.text)}</span>${i === rows.length - 1 ? tail : ''}</div>`
  ).join('');
  fe.classList.toggle('open', !!ui.feedOpen);

  if (rewrote && keepId) {
    const el = document.getElementById(keepId);
    if (el) { el.focus(); try { if (selS != null) el.setSelectionRange(selS, selS); } catch (e) { /* number input */ } }
  }
  if (HUMAN.talentOffers) talentModal();
  else if (!$('#ovTalent').classList.contains('hide')) $('#ovTalent').classList.add('hide');
  if (G.s.over && !ui.recorded) {
    recordRun(); sfx.award();
    HUMAN_LAST_TALENT = HUMAN.talents[HUMAN.talents.length - 1] || null;
    const me = (G.s.settlement.rows || []).find(r => r.id === G.s.humanId) || {};
    finishSave({ died: !me.alive, ratio: me.ratio || 0, talentId: HUMAN_LAST_TALENT });
  }
  if (G.s.over && $('#ovEnd').classList.contains('hide')) {
    /* ⚠ 结算必须回到二级：否则 view='end' 与 ui.root=true 会**自相矛盾** ——
       renderTabs() 在 root 下早退清空页签，'end' 高亮永不出现；
       而下一帧 render() 又用 viewLedger() 把 #view 盖回总账。
       弹层遮着看不出来，但状态已经互相矛盾（后续读数/扩展页签会踩）。
       （code-reviewer 子代理扫出的 R2。） */
    ui.root = false;
    view = 'end';
    renderTabs(); $('#view').innerHTML = viewEnd();
    /* 颁奖礼背景：用顶部横幅而不是背景图。
       原因：这张插画的"上三分之一"是刻意留黑的（给界面文字压白字用），
       当背景图铺满整个弹层时，露出来的恰好就是那片空黑 —— 看起来跟纯色卡片一模一样。
       做成横幅就一定能看见奖台和奖杯。 */
    $('#ovEnd').innerHTML = '<div class="modal" style="padding-top:0;overflow:hidden">' +
      '<img class="hero" src="assets/bg-awards.webp" alt="" style="height:150px" onerror="this.remove()">' +
      viewEnd() + '</div>';
    $('#ovEnd').classList.remove('hide');
    $('#ovEnd').querySelector('#again').onclick = () => location.reload();
  }
}

/* ---------- 事件委托 ----------
   ⚠ 同一根源的坑已犯三次：render() 每 120ms 重写一次 #view/#tabs 的 innerHTML，
   而人手一次按压（mousedown→mouseup）常在 80~150ms，必然跨过一次重建。
   mousedown 的目标被移出文档后，浏览器计算“两个目标的共同祖先”得到空，
   于是 `click` 事件根本不会产生 —— 表现就是：
     ① 点页签没反应（已修）
     ② 用户 2026-10-08 反馈「按钮不灵，需要点击好几下才能生效（播种）」
   注意：原先那个“坐标命中测试”兜底只能救「click 已派发但目标错了」，
   救不了「根本未派发」—— 所以播种依然丢点击。

   根治：把动作绑在 **pointerup** 上，而不是 click。
     · pointerup 的目标是按“指针抬起位置”重新命中测试的，与 mousedown 目标无关 →
       重建后按钮还在原地，拿到的就是活着的新按钮；
     · 拖动滚屏时浏览器发的是 pointercancel 而非 pointerup → 不会误触发；
     · 松开位置不在按钮上就等于取消，保留了标准点击手感；
     · 键盘（Enter/Space）没有 pointerup，仍走 click。
   同一次按压会先后产生 pointerup 和 click，用时间戳抑制后者，避免动作执行两遍。
   （lastPointerUpAt 初值取 -1e9 而非 0：否则页面刚加载的 700ms 内
     会把 ui-smoke 直接调用的 onClick 误判为“已处理过”。） */
