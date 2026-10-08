/* ===== part: 05-firm.js ===== */
Game.prototype.consolidated = function (p) {
  const hs = (Array.isArray(p.holdings) && p.holdings.length)
    ? p.holdings.filter(h => !h.bankrupt)
    : [{ corpId: p.corp, control: 1, debt: 0 }];            // 旧存档兼容
  /* 主控公司按**自己实际持股比例**并表（docs/19 §4.12）。
     为什么必须乘：不乘的话，“卖掉自己公司 30% 股份”会让个人现金增加、
     而并表 NAV 一点不减 —— 卖自己的股份等于印钞（静默获利，最坏的一类 bug）。
     stake 现在恒为 1 ⇒ 与旧口径逐位一致（有守卫锁这条等价性）。 */
  const own = hs.find(h => h.corpId === p.corp);
  const ownStake = own && own.stake != null ? own.stake : 1;
  /* ⚠ 个人钱包**不按持股折算**：那笔钱是他自己的（只是同时欠着公司）。
     它加在**并表**这一层（个人钱不进公司报表），所以是 + personal 而不是乘持股。 */
  const personal = p.personal || 0;
  let nav = this.nav(p) * ownStake + personal;   // 主控公司按持股并表 + 个人钱包全额
  let debt = (p.debt || 0) + this.shortLiability(p);         // 空头负债也是负债（与 debtRatio 同口径）
  for (const h of hs) {
    if (h.corpId === p.corp) continue;                       // 主控公司上面已计
    nav += (h.navSnapshot || 0) * (h.control == null ? 1 : h.control);
    debt += h.debt || 0;                                     // 收购来的公司：负债一并并表
  }
  /* 我在**别人**公司里持有的股份（合资/参股）：按对方的**单体净资产**×持股计值。
     ⚠ 这里用 this.nav(t) 而不是 this.consolidated(t)：
       consolidated 会再往下展开一层，甲持乙、乙持甲就是无限递归。
       只算一层（单体净资产）既不递归，也刚好与入股定价的口径对上。 */
  for (const st of (p.stakes || [])) {
    const t = this.s.players.find(x => x.id === st.targetPid);
    if (!t || !t.alive) continue;            // 对方出局 ⇒ 这笔投资跟着归零
    nav += this.nav(t) * (st.stake || 0);
  }
  return { nav, debt };
};

/* 从公司拿钱（docs/19 §4.12 / §4.17）——**只能以股东借款的形式**，不能“搬走不还”。
   现实依据：公司是独立法人，公司账上的钱不是股东的钱；股东直接把公司资金抽回
   属于抽逃出资，违法。合法路径是借款（有息、有期、公允、披露）。
   本作把这条做成**机制**而不是说明文本：
     ① 提走多少，就欠公司多少 ⇒ 身价**当场不变**（拿钱不是印钞，这才是那个洞的堵法）
     ② 上限 = 公司现金 × 我方持股 × 0.8（债权人保护：不能把公司掏空）
     ③ 进 p.debt，参与后面所有负债判据（所以拿多了照样会被催债）
   ⚠ 利润分配 / 减资属于§4.13 的决议事项，等票决系统落地后再接（现在是借款这一条）。 */
Game.prototype._a_take = function (p, d) {
  const own = (Array.isArray(p.holdings) ? p.holdings : []).find(h => h.corpId === p.corp);
  const stake = own && own.stake != null ? own.stake : 1;
  const cap = Math.max(0, Math.floor(p.cash * stake * 0.8));
  /* 两种写法：① 给定 `amount`（测试与将来的输入框用）② 只给 `frac`（按钮用，默认全拿）。 */
  const frac = d.frac == null ? 1 : Math.max(0, Math.min(1, d.frac));
  const amt = d.amount != null ? Math.floor(d.amount) : Math.floor(cap * frac);
  if (!(amt > 0)) return { ok: false, msg: '公司账上现在没多余的钱可以拿' };
  if (amt > cap) {
    return { ok: false, msg: '最多能拿走 ' + money(cap) + ' G —— 公司账上还得留着周转' };
  }
  p.cash -= amt;
  p.personal = (p.personal || 0) + amt;
  p.debt += amt;
  p.shareholderLoan = (p.shareholderLoan || 0) + amt;
  /* 文案只说“现象与代价”，不出现“股东借款/抽逃出资/法人财产”这类术语（lint-copy 会查）。 */
  this._log('trade', p.name + '从公司账上拿走 ' + money(amt) + ' G，记在自己名下', p.id);
  return { ok: true, msg: '拿走 ' + money(amt) + ' G。这笔记在你名下，是要还的 —— 所以你的身价没变' };
};

/* ---- 4.6 估值 / 4.10 上市（docs/19 §4.6 §4.10）---------------------- */
/* 这家公司值多少钱：估值 = 可辨认净资产 × 可比乘数。
   ⚠ 估值**不等于**身价。身价 = 你按持股比例拿到的那部分净资产（consolidated）；
     估值 = “整家公司要卖，市场肯出多少”。两者差的就是行当溢价。
     把它们混成一件事，“卖自己股份”看上去就像印钞 —— 那是 F4 哨兵钉住的东西。 */
Game.prototype.valuation = function (p) {
  const m = BAL.corpMult[p.corp] == null ? 1 : BAL.corpMult[p.corp];
  return Math.max(0, Math.round(this.nav(p) * m));
};

/* 上市募资（docs/19 §4.10）：把公司的一部分股份发出去，换现金回来。
   ① 发行价 = 估值（不做“自己定价”的旋钮 —— 那是个印钞口）
   ② 募来的钱进**公司账**（p.cash），不进个人钱包
   ③ 你让出多少股份，并表身价就按多少打折 ⇒ 上市当场**不会**让你凭空变富
      （能变富只靠这笔钱真赚出差价）
   ④ 让出有上限，且**不得让自己掉到一半以下** —— 否则说不上话了，
      也会让“反复发行”变成一个可反复收割的口子。 */
Game.prototype._a_ipo = function (p, d) {
  const own = (Array.isArray(p.holdings) ? p.holdings : []).find(h => h.corpId === p.corp);
  if (!own) return { ok: false, msg: '你手上没有这家公司' };
  const cur = own.stake == null ? 1 : own.stake;
  /* ⚠ 超过可让范围要**明确拒绝**，不许静默截断 ——
     玩家说“让 60%”却默默只让 35%，他以为的剩股数是错的（最坏的一类 UX 错）。
     可让范围 = min（单次上限, 让自己还剩一半）——两者取小。 */
  const maxGive = Math.min(BAL.ipoMaxGive, cur - 0.5);
  const give = d.give == null ? 0.25 : d.give;
  if (!(give > 0)) return { ok: false, msg: '要让出多少股份，得说个数' };
  if (give > maxGive + 1e-9) {
    return { ok: false, msg: '最多只能让出 ' + Math.round(maxGive * 100) +
      '% —— 再让下去，这家公司你就说不上话了' };
  }
  /* ⚠ 发行价用**公允价** stakePrice，不是 val×give：
     后者等于按**出让前**的估值卖新产生的股份，出让方**恒亏**一截。
     （valuation.test 的 V3 当时只卡了“涨了才算印钞”，没能拦住“恒亏”——
       属于守卫盖歪了；S5b 的“零和”断言把它补上了。） */
  const raise = this.stakePrice(p, give);
  if (raise <= 0) return { ok: false, msg: '公司现在估值太低，发出去也没人接' };
  const fee = Math.floor(raise * BAL.ipoFeeRate);
  const net = raise - fee;
  p.cash += net;
  own.stake = Math.round((cur - give) * 10000) / 10000;
  own.listed = true;
  p.m.ipoRaised = (p.m.ipoRaised || 0) + net;
  this._log('trade', p.name + '的公司发了一部分股份出去，募到 ' + money(net) + ' G（自己持股降到 ' +
    Math.round(own.stake * 100) + '%）', p.id);
  return { ok: true, msg: '募到 ' + money(net) + ' G（发行费 ' + money(fee) + ' G）。你手里还剩 ' +
    Math.round(own.stake * 100) + '% —— 身价不会因为这一下变高' };
};

/* ---- 4.13 股东名册与决议（docs/19 §4.13 / §4.14）--------------------- */
/* 名册（docs/19 §4.13）——返回**这家公司**的持股人。
   ⚠ 口径必须说清（我第一版错了，G1 当场抓到）：
     每个玩家的 holdings 记的是“我自己拥有的公司”，**不是一张跳玩家的共享名册**；
     所以甲、乙各自持有一个同**类型**的公司（都叫 'trade'）并不冲突 ——
     把“全玩家 holding 里 corpId 相同的”都算进一张名册，会凭空多出股东
     （实测后果：人力 + 阿May 共 2 票 ⇒ 分红只到手一半）。
     ⇒ 现阶段名册里只有**控制人自己**一条。真正的多方名册要等 ⑥（并购产生实际持股），
       那是唯一会新增股东的动作。
   已发行股份按 100% 计（分母 = 1）：持股比例 = stake / 1。 */
Game.prototype.capTable = function (owner, corpId) {
  /* ⚠ 签名守卫：只认“玩家对象”，不认字符串 corpId。
     传错时**宁可返回空名册**，也不吐出一个 `pid: undefined` 的假股东 ——
     假股东会让票决分母、分红份额全部静默算错（这是最坏的一类错）。 */
  if (!owner || typeof owner !== 'object' || !owner.id) return { rows: [], total: 1 };
  const cid = corpId || owner.corp;
  const hs = (Array.isArray(owner.holdings) && owner.holdings.length)
    ? owner.holdings
    : [{ corpId: owner.corp, stake: 1, control: 1 }];
  const rows = [];
  for (const h of hs) {
    if (h.bankrupt || h.corpId !== cid) continue;
    const stake = h.stake == null ? 1 : h.stake;
    if (stake <= 0) continue;
    rows.push({ pid: owner.id, name: owner.name, stake,
      control: h.control == null ? 1 : h.control, isHuman: !!owner.isHuman });
  }
  /* ② 别人手里握着、属于**这家公司**的股份（合资 / 参股）——
     这才是多方名册的另一半（只看 holdings 永远只有一条，见下）。
     同一人可能入股多次 ⇒ 按 pid 先合计再入名册，否则他会以两条出现、票比看起来比实际少。 */
  for (const q of this.s.players) {
    if (!q.alive || q.id === owner.id) continue;
    let sum = 0;
    for (const st of (q.stakes || [])) {
      if (st && st.targetPid === owner.id) sum += (st.stake || 0);
    }
    if (!(sum > 0)) continue;
    rows.push({ pid: q.id, name: q.name, stake: sum, control: 0, isHuman: !!q.isHuman });
  }
  rows.sort((a, b) => b.stake - a.stake);
  return { rows, total: 1 };
};

/* 决议类型（docs/19 §4.14 四类里先落两类 —— 董事会与一致同意等真正用到时再加）
     · 普通决议：出席过半数；出席率不够算“没人理”
     · 特别决议：出席 2/3（改章程 / 合并分立 / 解散这类大事） */
const DEC_KINDS = {
  dividend: { type: 'ordinary', label: '分钱（利润分配）', quorum: 0.5, pass: 0.5 },
  charter:  { type: 'special',  label: '改章程',           quorum: 0.5, pass: 2 / 3 },
};

/* 提案：持股 ≥10% 才有提案权（docs/19 §4.13） */
Game.prototype._a_propose = function (p, d) {
  const kind = d.kind || 'dividend';
  const spec = DEC_KINDS[kind];
  if (!spec) return { ok: false, msg: '没有这种提案' };
  const corpId = p.corp;
  const cap = this.capTable(p, corpId);
  const mine = cap.rows.find(r => r.pid === p.id);
  if (!mine || mine.stake / cap.total < 0.10) {
    return { ok: false, msg: '手上股份不到一成，提案没人接' };
  }
  const open = (this.s.decisions || []).find(x => x.corpId === corpId && x.status === 'open');
  if (open) return { ok: false, msg: '上一件事还没表态完，一件一件来' };
  const dec = {
    id: ++this.s.decisionSeq, corpId, ownerPid: p.id, kind, type: spec.type, label: spec.label,
    openT: this.s.t, dueT: this.s.t + BAL.decisionHours * 60,
    ratio: kind === 'dividend' ? clamp(d.ratio == null ? 0.5 : d.ratio, 0, 1) : 0,
    voters: {}, status: 'open', turnout: 0, yes: 0, no: 0, reason: '',
  };
  this.s.decisions.push(dec);
  this._log('event', '⚑ 有人提了一件事：' + spec.label + '。股东们要在 ' +
    BAL.decisionHours + ' 游戏小时内表个态。', null);
  return { ok: true, msg: '提案已发出：' + spec.label + '（' + BAL.decisionHours + ' 游戏小时内表态）' };
};

/* 表态 */
Game.prototype._a_vote = function (p, d) {
  const dec = (this.s.decisions || []).find(x => x.id === d.id && x.status === 'open');
  if (!dec) return { ok: false, msg: '这件事已经结束了' };
  /* 只有这家公司的**控制人**（现阶段名册里唯一的股东）能表态。 */
  const owner = this.s.players.find(x => x.id === (dec.ownerPid || ''));
  if (!owner || owner.id !== p.id) return { ok: false, msg: '你不是这家公司的股东' };
  const cap = this.capTable(owner, dec.corpId);
  if (!cap.rows.some(r => r.pid === p.id)) return { ok: false, msg: '你不是这家公司的股东' };
  if (dec.voters[p.id]) return { ok: false, msg: '你已经表过态了' };
  dec.voters[p.id] = d.for === false ? 'against' : 'for';
  return { ok: true, msg: d.for === false ? '记下了：你不同意' : '记下了：你同意' };
};

/* 票决结算：到期才结 —— 四态必须分开（docs/19 §4.14）
     「没人理」（出席率不够）与「顶上」（多数反对）**不是同一件事**：
     前者是可以重提的沉默，后者是明确的否决，混在一起玩家就看不懂为什么被拒。 */
Game.prototype._decisionTick = function () {
  const s = this.s;
  const decs = s.decisions || [];
  if (!decs.length) return;
  for (const dec of decs) {
    if (dec.status !== 'open') continue;
    const owner = s.players.find(x => x.id === dec.ownerPid);
    const cap = this.capTable(owner, dec.corpId);
    const spec = DEC_KINDS[dec.kind] || { quorum: 0.5, pass: 0.5 };
    let yes = 0, no = 0, cast = 0;
    for (const row of cap.rows) {
      const v = dec.voters[row.pid];
      if (v === 'for') { yes += row.stake; cast += row.stake; }
      else if (v === 'against') { no += row.stake; cast += row.stake; }
    }
    dec.turnout = cast / cap.total; dec.yes = yes / cap.total; dec.no = no / cap.total;
    if (s.t < dec.dueT) continue;
    if (dec.turnout < spec.quorum) { dec.status = 'nobody'; dec.reason = '表态的人太少'; }
    else if (yes / Math.max(1e-9, cast) >= spec.pass) { dec.status = 'pass'; }
    else { dec.status = 'votedown'; dec.reason = '摇头的人更多'; }
    if (dec.status === 'pass' && dec.kind === 'dividend') this._payDividend(dec.corpId, dec.ratio, cap);
    if (dec.status === 'pass') this._log('event', '✔ 那件事过了：' + dec.label, null);
    else if (dec.status === 'votedown') this._log('event', '✘ 那件事没过：' + dec.label + '（' + dec.reason + '）', null);
    else this._log('event', '· 那件事没人理：' + dec.label, null);
  }
  if (decs.length > 20) s.decisions = decs.slice(-20);
};

/* 分钱（docs/19 §4.13 法定顺序）——
   ① 先弥补亏损：本作没有累计亏损表，用“净资产 ≤ 0 就不许分”作为等价闸门；
   ② 提 10% 法定公积金：不建独立科目，就地表现为“少分 10%”（留在公司里）；
   ③ 余额才按股比分。
   ⚠ 为什么必须走这个顺序：跳过它，“分红”就变成股东自己给自己发钱的旋钮。 */
Game.prototype._payDividend = function (corpId, ratio, cap) {
  const s = this.s;
  for (const row of cap.rows) {
    const holder = s.players.find(x => x.id === row.pid);
    if (!holder || !holder.alive) continue;
    if (holder.corp !== corpId) continue;   // 只有主控公司走 p.cash；参股公司按快照，暂不分配
    if (this.nav(holder) <= 0) return;      // 第①步：净资产为负，不许分
    const pool = Math.max(0, Math.floor(holder.cash * ratio));
    const reserve = Math.floor(pool * 0.10);      // 第②步：法定公积金（留在公司）
    const distributable = pool - reserve;
    if (distributable <= 0) return;
    const mineShare = Math.floor(distributable * (row.stake / cap.total));
    holder.cash -= distributable;
    holder.personal = (holder.personal || 0) + mineShare;
    this._log('trade', '公司分钱：拿出 ' + money(distributable) + ' G 按股比发下去，' +
      holder.name + '自己拿到 ' + money(mineShare) + ' G', holder.id);
  }
};

/* ---- 4.6b 公司名录与实时名次（docs/19 §4.6）------------------------- */
/* 全场公司一条一行的名录 + 名次。一次算完，UI 与守卫共用同一份 ——
   ⚠ 榜必须用**同一口径**算所有人：统一用 consolidated()。
     若“自己的身价按并表、NPC 的按单体”，名次就不可比了 —— 那是个假榜。 */
Game.prototype.standings = function () {
  const rows = [];
  for (const p of this.s.players) {
    if (!p.alive) continue;
    let nav = 0, debt = 0;
    try {
      const sheet = this.consolidated(p);
      nav = sheet.nav; debt = sheet.debt;
    } catch (e) { nav = 0; debt = 0; }
    const c = CORPS.find(x => x.id === p.corp) || {};
    rows.push({
      pid: p.id, name: p.name, corpId: p.corp, corpName: c.name || p.corp,
      nav: Math.round(nav), debt: Math.round(debt), isHuman: !!p.isHuman,
    });
  }
  rows.sort((a, b) => b.nav - a.nav);
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  return rows;
};

/* 让出 give 比例股份的**公允价**（docs/19 §4.6 pre-money / post-money）。
   为什么不是 val × give：那样等于按出让前的估值卖新产生的股份，
   出让方恒亏一截（IPO 初版就是这么写的，V3 那条守卫只是“涨了才算印钞”而没抓住“恒亏”）。
   正确式子：P = val × g / (1 − g) ⇒ 成交后双方身价都刚好不变（乘数为 1 时）。 */
Game.prototype.stakePrice = function (p, give) {
  const g = clamp(give, 0, 0.999);
  return Math.max(0, Math.floor(this.valuation(p) * g / (1 - g)));
};

/* ---- 4.14 股份转让：优先购买权（ROFR）· 4.11 B 持股门槛 ------------------
   ⚠ 先纠一个**我自己写错的假设**：我曾把“并购”记成架构阻断，说要先引入“公司实体 id”。
     错了。标的从来不是“哪家公司”，而是“**哪个持股人**”（一人一公司）。
     所以“收购老陈的公司”= 从老陈手里买到 >50%，而这靠 stakes[] 就能做 —— 不需要实体 id。
   ⚠ 现实里最容易被漏、张力最大的一条（docs/19 §4.14 B）：
     向**股东以外的人**转让股权，须先问其他股东要不要同价先买。
     没有这条，“谁出价高谁拿走”就成了唯一路径，谈判张力全丢。 */
Game.prototype.rofrHolder = function (owner, buyerPid, price) {
  const s = this.s;
  if (!owner) return null;
  const cap = this.capTable(owner, owner.corp);
  /* 买方本来就是股东 ⇒ 不是“外人”，不问。 */
  if (cap.rows.some(r => r.pid === buyerPid)) return null;
  const cand = cap.rows.filter(r => r.pid !== owner.id && r.pid !== buyerPid);
  if (!cand.length) return null;
  /* 按现实惯例：先问持股最多的那位（他最有动机守门）。
     “不同意的股东应当购买”——但要买得起；买不起就放行（本作简化，写在注释里） */
  const top = cand[0];
  const hp = s.players.find(x => x.id === top.pid);
  if (!hp || !hp.alive) return null;
  if (hp.cash < price) return null;
  return top;
};

/* §4.11 B 持股门槛表：把“多少股 = 什么权”集中成一处，UI 与守卫共读。
   ⚠ 现实里“收购不是点一下就成，是一串门槛”——每个节点都要能对玩家说清楚。 */
Game.prototype.rights = function (p, targetPid) {
  const tgt = targetPid == null ? p : this.s.players.find(x => x.id === targetPid);
  if (!tgt) return { stake: 0, list: [], next: null };
  const cap = this.capTable(tgt, tgt.corp);
  const row = cap.rows.find(r => r.pid === p.id);
  const stake = row ? row.stake : 0;
  const T = [
    [0.667, '特别决议（改章程 / 增资 / 卖公司）'],
    [0.5, '控股（普通决议你说了算）'],
    [0.3, '要约收购义务（要买得公开出价）'],
    [0.2, '可提名董事（能看这家公司的细节）'],
    [0.1, '可发起决议'],
    [0.05, '举牌（必须公告，藏不住了）'],
    [0.03, '可提交议题'],
  ];
  const list = T.filter(x => stake >= x[0]).map(x => x[1]);
  const above = T.filter(x => stake < x[0]);      // T 是降序 ⇒ 最后一个就是“最近的下一道”
  const next = above.length ? { at: above[above.length - 1][0], label: above[above.length - 1][1] } : null;
  return { stake, list, next };
};

/* 追保与破产（docs/13 §4.3）——「负债 ≠ 破产」的落点。
   判据只有两条，**欠了多少钱本身不算**：
     ① 资不抵债：净资产 / 总负债 < maintRatio（维持线 0.30）
     ② 付不出钱：现金 < 0
   任一成立 → 发【追保通知】，给 graceHours 小时窗口自救（补钱 / 卖货 / 质押 / 借钱 / 等着被收购）；
   逾期未补 → 破产清算。
   旧口径 `p.cash < 0 || p.arrears > arrearsLimit` 已废：它把“欠款多”直接当死因，
   与用户 2026-10-08 的定义（负债 ≠ 破产）直接冲突。 */
Game.prototype._bankruptcyTick = function () {
  const s = this.s;
  for (const p of s.players) {
    if (!p.alive) continue;
    const sheet = this.consolidated(p);
    const insolvent = sheet.debt > 0 && sheet.nav < sheet.debt * BAL.maintRatio;
    const illiquid = p.cash < 0;
    if (insolvent || illiquid) {
      p.m.pressure = 1;
      if (!p.negativeSince) p.negativeSince = s.t;          // 追保窗口起点
      const held = (s.t - p.negativeSince) / 60;
      if (held >= BAL.graceHours) {
        /* ⚠ 日志是玩家可见字符串（lint-copy 会查），所以这里只能用「现象」，
           不许出现“维持线/追保/资不抵债”这类术语。内部判据仍然叫 maintRatio。 */
        this._bankrupt(p, insolvent
          ? '手里的家底（' + money(sheet.nav) + ' G）已经抵不过欠账（' + money(sheet.debt) + ' G），债主上门也没能补上'
          : '现金转负，债主上门也没能补上');
      } else if (!p._warnedNeg) {
        p._warnedNeg = true;
        const left = (BAL.graceHours - held).toFixed(1);
        this._log('bad', '⚠ 有人上门催债：' + p.name + (insolvent
            ? '手里的家底（' + money(sheet.nav) + ' G）已经不够还欠的账（' + money(sheet.debt) + ' G）'
            : '手上的现金已经是负的') +
          '，还有 ' + left + ' 游戏小时（卖货、借钱、或者等人接手），过了这一线就得拿地、货、公司抵债', p.id);
      }
    /* ⚠ p.m.pressure 在这里**故意不清**（2026-10-08，holdings 验收测试 T4）：
       它是【历史标记】而不是【当前状态】。全项目唯一读取点是结算的 B 生存门槛
       `(anyoneDied || p.m.pressure)`（约 L2261），语义是"这一局你**经历过**现金流断裂"。
       UI 不读它，所以不会出现"钱还清了界面还挂着催债"。
       ⚠ 若将来要在界面上显示"当前正被催债"，**必须另加一个会复位的字段**，
         不要复用 pressure —— 否则一旦被催过债，B 门槛会永久对这人成立。 */
    } else { p.negativeSince = null; p._warnedNeg = false; p._warnedArrears = false; }
  }
};

/* NAV 采样 */
Game.prototype._navTick = function (dt) {
  const s = this.s;
  if (s.t - (s._lastNavT || -1) < 60) return;
  s._lastNavT = s.t;
  for (const p of s.players) {
    const nav = this.nav(p);
    p.m.navHist.push([Math.round(s.t), Math.round(nav)]);
    if (p.m.navHist.length > 200) p.m.navHist.shift();
    p.m.peakNav = Math.max(p.m.peakNav, nav);
    const mono = this.monoShare(p);
    p.m.monoPeak = Math.max(p.m.monoPeak || 0, mono);
  }
};

/* 终局倒计时（docs/05：垄断不立即结算） */
Game.prototype._countdownTick = function () {
  const s = this.s;
  if (!s.countdown) {
    for (const p of s.players) {
      if (!p.alive) continue;
      const crop = this.monoCrop(p);
      const share = this.monoShare(p, crop);
      const need = s.crops[crop].mono;
      // 破产边缘的人锁不住市场：欠一屁股债的控盘不算赢（否则会出现"首席是全场最穷的人"）
      if (this.debtRatio(p) > BAL.monoMaxDebtRatio) continue;
      if (share >= need) {
        s.countdown = { pid: p.id, until: s.t + BAL.monoCountdownH * 60, crop, need };
        s.stats.monopolist = p.id;
        this._log('bad', '⚑ ' + p.name + ' 控制 ' + s.crops[crop].name + ' ' +
          (share * 100).toFixed(1) + '% 流通量，触发终局倒计时（' + BAL.monoCountdownH +
          ' 游戏小时）。所有人还有机会打断他——只要他手里的货掉到门槛以下。', null);
        break;
      }
    }
  } else {
    const holder = s.players.find(p => p.id === s.countdown.pid);
    if (!holder || !holder.alive) { s.countdown = null; return; }
    const share = this.monoShare(holder, s.countdown.crop);
    if (share < s.countdown.need) {
      this._log('event', '⚑ ' + holder.name + ' 在' + s.crops[s.countdown.crop].name +
        '上的控制度跌回 ' + (share * 100).toFixed(1) + '%，垄断被打破，倒计时取消。', null);
      s.countdown = null; return;
    }
    if (s.t >= s.countdown.until) this._end(holder.name + ' 垄断 ' + s.crops[s.countdown.crop].name + ' 锁定首席');
  }
};

Game.prototype._end = function (reason) {
  this.s.over = true;
  this.s.overReason = reason;
  this.s.settlement = this.settle();
  this._log('system', '赛季结束：' + reason, null);
};

/* ---- 3.3 交易核心 -------------------------------------------------------*/
/* 冲击饱和：价格偏离锚越远，边际冲击越小（越涨越有人卖、越跌越有人接）。
   没有这一项，一个有钱玩家可以把价格无限推高，并把 NAV 与授信额度一起吹起来。 */
