/* ===== part: 18-mail.js ===== */
/* 一级 · 信匣｜邮箱（docs/20 §2.1「信匣｜邮箱·会话列表」/ §7 第一批第 2 项）。
 *
 * 屏幕形态：会话式列表（发件人 · 摘要 · 时间 · 未读点 · [倒计时角标]）。
 * docs/20 §4 明说它「约 10 行、会话式列表天生适合窄屏，无需分页」——
 * 所以这里**不做分页**、不做搜索（430px 上都是浪费）。
 *
 * ⚠ 与告急带的分工（docs/20 §2.1）：
 *   告急带 = 「现在就必须看一眼」的 1~3 条，钉在总账顶部；
 *   信匣   = 全部来信（含不急的风声）。
 *   告急带的「还有 N 条」必须把人送到这里，否则那条路是断的 —— 见 ledgerBelt 的收尾。
 *
 * ⚠ 已读状态存在**引擎的 s.inbox**（m.read）上，不存在 ui 里：
 *   存 ui 的话一刷新就全变回未读，角标永远清不掉。
 *   反之，「正在看哪一封」是纯界面态，不该进存档 —— 所以它留在本文件作用域。
 *
 * ⚠ 导航一律 data-root（一级屏切换）。**不能用 data-view**：
 *   那条分支表示"二级公司层页签"，会把 ui.root 复位成二级（自己把自己踢出信匣）。
 */

/* 当前打开的信的 id；null = 看列表。 */
let mailOpenId = null;

/* 我的信：只取收件人是我的，新的在前（会话行按时间倒序，docs/20 §2.1）。 */
function mailBox() {
  const all = (G && G.s && Array.isArray(G.s.inbox)) ? G.s.inbox : [];
  return all.filter(m => m && m.to === G.s.humanId).slice().reverse();
}
function mailUnread() {
  return mailBox().filter(m => !m.read).length;
}
/* 未读里最快到期的那件（docs/20 §2.1「信匣角标含最近倒计时」）。
   角标如果不带"最急的那件还剩多久"，它就只是个装饰。 */
function mailUrgentT() {
  let best = null;
  for (const m of mailBox()) {
    if (m.read || m.deadlineT == null) continue;
    if (best == null || m.deadlineT < best) best = m.deadlineT;
  }
  return best;
}

/* 顶栏常驻印章（docs/20 §2.1：顶栏右侧常驻，带未读角标）。 */
function mailSeal() {
  const n = mailUnread();
  const left = mailUrgentT();
  /* 有未读且带时限时，角标旁边再跟一个秒数 —— 这是"必须回来处理"的钩子 */
  const soon = (n && left != null) ? '<span class="ssoon">' + secLeftTxt(left - G.s.t) + '</span>' : '';
  return '<button class="seal' + (n ? ' has' : '') + '" data-root="mail">✉' +
    (n ? '<span class="sbadge">' + (n > 99 ? '99+' : n) + '</span>' : '') +
    '</button>' + soon;
}

function mailGlyph(kind) {
  if (kind === 'deal') return '⚖';
  if (kind === 'rumor') return '〰';
  if (kind === 'vote') return '⚑';
  return '✉';
}
/* 会话行的时间：3 天局里只写 hh:mm 会分不清是哪天，所以带天号，但压到最短。 */
function mailTime(t) { return dayOf(t) + '·' + hhmm(t); }

function mailRow(m) {
  const dl = m.deadlineT != null
    ? '<span class="mdl' + (m.deadlineT - G.s.t <= 0 ? ' over' : '') + '">' + secLeftTxt(m.deadlineT - G.s.t) + '</span>'
    : '';
  return '<button class="mrow' + (m.read ? '' : ' unread') + '" data-mail="' + m.i + '">' +
    '<span class="mava ' + esc(m.kind || 'system') + '">' + mailGlyph(m.kind) + '</span>' +
    '<span class="mtxt">' +
      '<span class="mfrom">' + esc(m.from) + (m.read ? '' : '<span class="mdot"></span>') + dl + '</span>' +
      '<span class="msub">' + esc(m.subject) + '</span>' +
    '</span>' +
    '<span class="mtime">' + mailTime(m.t) + '</span>' +
  '</button>';
}

function viewMailDetail(m) {
  const dl = m.deadlineT != null
    ? '<div class="mdlg">剩 ' + secLeftTxt(m.deadlineT - G.s.t) + '</div>' : '';
  /* 信件里的可执行动作（docs/19 §4.9：答复 / 投票的入口就放在邮箱里）。
     目前只有 NPC 提案（合作请求 / 收购通知）走这条；票决的三按钮
     （赞成 / 反对 / 弃权）要等股东结构（持股% + 门槛 50%/66.7%）落地再接 ——
     但那时同样只需往 m.actions 里加值，这里不用改（所以按“动作表”渲染，不写死按钮）。 */
  return '<div class="ledger mail">' +
    '<button class="back" data-mailback="1">← 信匣</button>' +
    '<div class="md">' +
      '<div class="mdfrom">' + esc(m.from) + '<span class="mdtime">' + mailTime(m.t) + '</span></div>' +
      '<div class="mdsub">' + esc(m.subject) + '</div>' +
      dl +
      '<div class="mdbody">' + esc(m.body) + '</div>' +
      mailOffer(m) +
    '</div>' +
  '</div>';
}

/* 提案的答复区。
   ⚠ 能不能点、点了会怎样，全部由**引擎的 offer.status** 决定，UI 不自己猜 ——
     否则会出现“信上还说能答应、其实早过期了”的假按钮（本项目的死按钮坑）。 */
function mailOffer(m) {
  const s = G.s;
  const o = (Array.isArray(s.offers) ? s.offers : []).find(x => x.mailId === m.i);
  if (!o) return '';
  if (o.status !== 'open') {
    const done = { accepted: '你答应了，这件事已经办完。', declined: '你回绝了。',
                   lapsed: '过期了，对方把条件收了回去。' };
    return '<div class="mdec done">' + (done[o.status] || '这件事已经结束。') + '</div>';
  }
  if (s.t > o.deadlineT) return '<div class="mdec done">过期了，对方把条件收了回去。</div>';
  const yes = o.kind === 'loan' ? '借给他' : '卖给他';
  const no = o.kind === 'loan' ? '不借' : '不卖';
  return '<div class="mdec">' +
    '<button class="btn p" data-offer="accept:' + o.i + '">' + yes + '</button>' +
    '<button class="btn" data-offer="decline:' + o.i + '">' + no + '</button>' +
  '</div>';
}

function viewMail() {
  if (mailOpenId != null) {
    const m = mailBox().find(x => x.i === mailOpenId);
    /* 信不见了（读档换局 / 被 200 封上限挤掉）→ 回列表，不要白屏 */
    if (m) return viewMailDetail(m);
    mailOpenId = null;
  }
  const list = mailBox(), un = mailUnread();
  return '<div class="ledger mail">' +
    '<div class="ct"><h3>信匣</h3><span class="sub">' +
      (list.length ? '共 ' + list.length + ' 封' + (un ? '，未读 ' + un : '') : '空的') +
    '</span></div>' +
    (list.length
      ? '<div class="mrows">' + list.map(mailRow).join('') + '</div>'
      : '<div class="empty">还没有人来信。<br>有公司来找你谈事、或者市面上有风声，会送到这里。</div>') +
  '</div>';
}

/* 打开一封 = 立即已读（写在引擎状态上，刷新不回退）。 */
function mailOpenBy(i) {
  mailOpenId = i;
  const m = mailBox().find(x => x.i === i);
  if (m && !m.read) m.read = true;
  render(true);
}
function mailClose() { mailOpenId = null; render(true); }
