/* ===== part: 15-auction.js ===== */
Game.prototype._queueBankruptLot = function (victim, plotCount) {
  const s = this.s;
  s.auction = {
    phase: 'sealed',
    lot: { id: 'wreck-' + victim.id, name: victim.name + ' 的破产资产包', kind: 'wreck',
      desc: plotCount + ' 块地 + 剩余存货（' + (Object.keys(victim.storage).length ? '含现货' : '空仓') + '）',
      value: plotCount * BAL.plotCost * 1.1, payload: { from: victim.id, plots: plotCount } },
    startT: s.t,
    sealedEndT: s.t + this._realSecToGameMin(BAL.auctionWreckSealedSec),
    openEndT: null, startPrice: 0, finalists: [], entries: [], high: null,
    minIncrement: 0, softCount: 0, history: [],
  };
  s.auctionCount++;
};

/* ---- 3.8 拍卖状态机 ---------------------------------------------------*/
Game.prototype._auctionTick = function (dt) {
  const s = this.s, a = s.auction;
  const sched = [
    { day: 2, hour: 6, big: false },
    { day: 3, hour: 6, big: true },
  ];
  if (!a) {
    if (s._auctionDone == null) s._auctionDone = 0;
    for (let i = 0; i < sched.length; i++) {
      if (i < s._auctionDone) continue;
      const at = ((sched[i].day - 1) * 24 + sched[i].hour) * 60;
      if (s.t >= at) { this._openAuction(sched[i].big); s._auctionDone = i + 1; break; }
    }
    return;
  }
  const sealedLen = this._realSecToGameMin(BAL.auctionSealedSec);
  const openLen = this._realSecToGameMin(BAL.auctionOpenSec);
  const softStep = this._realSecToGameMin(BAL.auctionSoftCloseSec);
  if (a.phase === 'sealed') {
    // NPC 也会投暗标（否则玩家随手出个价就白拿，暗标阶段形同虚设）
    if (!a._npcSealedDone && s.t > (a.startT || 0) + 15) {
      a._npcSealedDone = true;
      for (const npc of s.players) {
        if (npc.isHuman || !npc.alive) continue;
        const v = a.lot.value * (0.55 + npc.w.aggro * 0.7);
        const budget = Math.min(npc.cash * 0.8, v);
        if (budget > a.lot.value * 0.45 && this.rng.auction.chance(0.55 + npc.w.aggro * 0.35)) {
          a.entries.push({ pid: npc.id, amount: Math.floor(budget), t: s.t });
        }
      }
    }
  }
  if (a.phase === 'sealed' && s.t >= a.sealedEndT) {
    // 结算入围
    const valid = a.entries.filter(e => e.amount > 0).sort((x, y) => y.amount - x.amount);
    const alive = s.players.filter(p => p.alive);
    const K = clamp(Math.ceil(alive.length * 0.5), 2, 4);
    a.finalists = valid.slice(0, K).map(e => e.pid);
    if (!a.finalists.length) { a.phase = 'done'; a.result = '流拍：没人出价'; this._log('info', '拍卖流拍——没人出价', null); return; }
    const kth = valid[Math.min(K, valid.length) - 1];
    const reserve = a.lot.value * 0.55;
    // 价格一律取整：带小数的"最低出价"会让玩家的出价永远差一点点而失败（已修）
    a.startPrice = Math.ceil(Math.max(reserve, kth ? kth.amount * 0.8 : reserve));
    a.minIncrement = Math.max(20, Math.ceil(a.startPrice * 0.05));
    a.phase = 'open'; a.openEndT = s.t + openLen;
    a.high = { pid: a.finalists[0], amount: a.startPrice };
    this._syncNextBid(a);   // 供 UI 直接显示"最低出价" 
    this._log('auction', '【' + a.lot.name + '】入围名单出炉，起拍价 ' + money(a.startPrice) + ' G。明标开始。', null);
  } else if (a.phase === 'open' && s.t >= a.openEndT) {
    a.phase = 'done';
    a.result = a.high ? (this._pidName(a.high.pid) + ' 以 ' + money(a.high.amount) + ' G 拿下') : '流拍';
    this._log('auction', '拍卖结束：' + a.result, null);
    if (a.high) this._awardLot(a.high.pid, a.high.amount);
    // 破产资产：土地转给赢家
    if (a.lot.kind === 'wreck' && a.high) {
      const w = s.players.find(x => x.id === a.high.pid);
      if (w) for (let i = 0; i < a.lot.payload.plots; i++) w.plots.push({ crop: null, plantedT: null, matureT: null, auto: false, upgraded: false });
      if (w) { w.m.acquisitions++; w.m.acquiredValue += a.high.amount; }
    }
    /* 拍卖结束后延迟清理。这里用 s 里的普通字段而不是 setTimeout 闭包 ——
       闭包进不了存档，读档后定时任务会丢（旧实现踩过：读档后拍卖永远不清理）。 */
    a.clearAt = s.t + 180;
  } else if (a.phase === 'open') {
    // NPC 在明标阶段出价
    if (s.t - (a._lastNpcBid || -Infinity) > 8 && a.finalists.length) {
      a._lastNpcBid = s.t;
      for (const pid of a.finalists) {
        const npc = s.players.find(x => x.id === pid);
        if (!npc || npc.isHuman || !npc.alive) continue;
        if (a.high && a.high.pid === pid) continue;
        const v = a.lot.value * (1 + npc.w.aggro * 0.4);
        const budget = Math.min(npc.cash, v);
        const next = (a.high ? a.high.amount : a.startPrice) + a.minIncrement;
        if (next <= budget && this.rng.auction.chance(0.5 + npc.w.aggro * 0.4)) {
          a.high = { pid, amount: next };
          a.minIncrement = Math.max(20, Math.ceil(next * 0.05));
          this._syncNextBid(a);
        }
      }
      // 软延时
      if (a.high && a.openEndT - s.t <= softStep && a.softCount < BAL.auctionSoftCloseMax) {
        a.openEndT += softStep; a.softCount++;
      }
    }
  }
};

/* 计划任务：全部用 s 里的字段表达，保证可存档（原来用闭包 + 实例字段，读档即丢） */
Game.prototype._timerTick = function () {
  const s = this.s, a = s.auction;
  if (a && a.phase === 'done' && a.clearAt && s.t >= a.clearAt) s.auction = null;
};

/* 真实秒 → 游戏分钟（拍卖窗口专用） */
Game.prototype._realSecToGameMin = function (sec) {
  return Math.max(0.5, sec * 60 / (this.s.secPerGameHour || 8));
};
/* 游戏分钟 → 真实秒（UI 显示倒计时用） */
Game.prototype.realSecLeft = function (gameMin) {
  return Math.max(0, gameMin * (this.s.secPerGameHour || 8) / 60);
};

Game.prototype._openAuction = function (big) {
  const s = this.s;
  const r = this.rng.auction;
  const count = big ? (s.rules.auctionBig ? 3 : 2) : 1;
  const lots = r.shuffle(LOT_POOL).slice(0, 1);
  const lot = lots[0];
  s.auction = {
    phase: 'sealed', lot: Object.assign({}, lot),
    startT: s.t,
    sealedEndT: s.t + this._realSecToGameMin(BAL.auctionSealedSec),
    openEndT: null, startPrice: 0, finalists: [], entries: [], high: null,
    minIncrement: 0, softCount: 0, history: [],
  };
  // 本场同期还有其它小标的（展示用）
  s.auction.extraLots = r.shuffle(LOT_POOL).slice(0, count - 1).map(l => l.name);
  s.auctionCount++;
  this._log('auction', '🔨 第 ' + s.auctionCount + ' 场拍卖会开始：' + lot.name + ' — ' + lot.desc +
    '（暗标窗口开放，估值约 ' + money(lot.value) + ' G）', null);
};

Game.prototype._a_bid = function (p, d) {
  const a = this.s.auction;
  if (!a) return { ok: false, msg: '现在没有拍卖会' };
  const amount = Math.floor(d.amount || 0);
  if (amount <= 0) return { ok: false, msg: '出个价吧' };
  const deposit = Math.round(amount * BAL.bidDepositRate * p.mods.snipeDeposit);
  if (a.phase === 'sealed') {
    if (p.cash < amount * 0.2) return { ok: false, msg: '资金实力不够，暗标至少要能覆盖 20% 出价' };
    a.entries = a.entries.filter(e => e.pid !== p.id);
    a.entries.push({ pid: p.id, amount, t: this.s.t });
    return { ok: true, msg: '暗标已投：' + money(amount) + ' G（别人看不到）' };
  }
  if (a.phase === 'open') {
    if (!a.finalists.includes(p.id)) return { ok: false, msg: '你没进明标名单（暗标没进前几名）' };
    const min = Math.ceil((a.high ? a.high.amount : a.startPrice) + a.minIncrement);
    if (amount < min) return { ok: false, msg: '至少要出 ' + money(min) + ' G' };
    if (p.cash < amount) return { ok: false, msg: '现金不够' };
    a.high = { pid: p.id, amount };
    a.minIncrement = Math.max(20, Math.ceil(amount * 0.05));
    this._syncNextBid(a);
    const softStep2 = this._realSecToGameMin(BAL.auctionSoftCloseSec);
    if (a.openEndT - this.s.t <= softStep2 && a.softCount < BAL.auctionSoftCloseMax) {
      a.openEndT += softStep2; a.softCount++;
    }
    this._log('auction', p.name + ' 出价 ' + money(amount) + ' G' + (a.softCount ? '（触发延时）' : ''), p.id);
    return { ok: true, msg: '你现在领先：' + money(amount) + ' G' };
  }
  return { ok: false, msg: '这轮已经结束了' };
};

/* 最低出价必须随每次价格变动重算。
   早先只在"入围结算"和"玩家出价"时算过一次，NPC 抬价后 nextBid 就变成陈旧值，
   UI 会照着它显示一个已经无效的价格（已修）。 */
Game.prototype._syncNextBid = function (a) {
  if (!a) return;
  const base = a.high ? a.high.amount : a.startPrice;
  a.nextBid = Math.ceil(base + (a.minIncrement || 0));
};
Game.prototype._awardLot = function (pid, amount) {
  const s = this.s, a = s.auction, p = s.players.find(x => x.id === pid);
  if (!p) return;
  if (p.cash < amount) { this._log('bad', p.name + ' 付不出钱，悔拍——押金没收', p.id); return; }
  p.cash -= amount * (1 + BAL.auctionFee);
  p.m.auctionSpend += amount;
  p.m.auctionWins++;
  const lot = a.lot;
  if (lot.kind === 'plot') p.plots.push({ crop: null, plantedT: null, matureT: null, auto: false, upgraded: true });
  else if (lot.kind === 'privilege') { p.taxfreeUntil = s.t + (lot.durH || 24) * 60; p.exportUntil = s.t + (lot.durH || 24) * 60; }
  else if (lot.kind === 'seeds') {
    const cid = this.rng.main.pick(CROP_IDS);
    // 必须受仓储上限约束，否则会把玩家顶到超容量（进而触发收割倒扣库存的 bug）
    const room = Math.max(0, this.storageMax(p) - this.storageUsed(p));
    const put = Math.min(40, room);
    if (put > 0) {
      p.storage[cid] = (p.storage[cid] || 0) + put;
      const bk = p.avgCost[cid] || { q: 0, c: s.crops[cid].base };
      p.avgCost[cid] = { q: bk.q + put, c: bk.c * bk.q / (bk.q + put) };
    }
    if (put < 40) this._log('info', p.name + ' 仓库存不下这么多，只收下了 ' + put + ' / 40 单位', p.id);
  } else if (lot.kind === 'intel') {
    const up = s.eventQueue.find(x => !x.fired);
    if (up) {
      const ev = EVENT_POOL.find(e => e.id === up.id);
      const atH = Math.floor(up.at / 60);
      this._log('intel', p.name + ' 拿到绝密情报：第 ' + (Math.floor(atH / 24) + 1) + ' 天 ' + (atH % 24) +
        ' 时【' + ev.name + '】，' + (up.crop ? s.crops[up.crop].name : '全场') + ' 偏' +
        (up.anchorMult > 1 ? '涨' : '跌'), p.id);
      p.m.intelKnown.push({ qid: up.at, correct: true, sold: true });
    }
  } else if (lot.kind === 'debt') {
    // 债务包：接手一笔对手的坏账
    const victim = s.players.filter(x => !x.alive || x.debt > 0).sort((x, y) => y.debt - x.debt)[0];
    if (victim && victim.debt > 0) {
      const pack = victim.debt * 0.8;
      p.cash += pack; p.debt += pack;
      p.m.aggression += 5;
      this._log('money', p.name + ' 买下债务包：+' + money(pack) + ' G 现金，同时背上等额债务', p.id);
    }
  }
  this._log('good', '🏆 ' + p.name + ' 拍得【' + lot.name + '】（' + money(amount) + ' G + 5% 拍卖行抽成）', p.id);
};

Game.prototype._pidName = function (pid) {
  const p = this.s.players.find(x => x.id === pid);
  return p ? p.name : pid;
};

/* ---- 3.9 日志 ---------------------------------------------------------*/
Game.prototype._log = function (kind, text, pid) {
  this.s.feed.push({ i: ++this.s.feedSeq, t: Math.round(this.s.t), kind, text, pid: pid || null });
  if (this.s.feed.length > 400) this.s.feed.shift();
};
/* ---- 3.9b 信匣（docs/20 §2.1 信匣｜邮箱 / docs/19 §4.6 治理入口）----------------
   信 = **指名寄给你**的东西（合作请求 / 收购通知 / 风声 / 决议通知），留未读角标；
   流水条（feed）= **外面的动静**（谁买卖了什么、价格动了），不留未读。
   ⚠ 这个分工是 docs/20 §2.1 定的：告急带与信匣角标把“必须回来处理”钉在视线里，
     流水条是背景音。混成一个会同时污染两边。
   ⚠ 旧存档没有 inbox / inboxSeq，全部当场兜底，不做迁移（迁移守卫会挂）。 */
Game.prototype._mail = function (pid, kind, from, subject, body, opts) {
  const o = opts || {};
  if (!Array.isArray(this.s.inbox)) this.s.inbox = [];
  if (typeof this.s.inboxSeq !== 'number') this.s.inboxSeq = 0;
  const m = {
    i: ++this.s.inboxSeq, t: Math.round(this.s.t), to: pid,
    kind, from, subject, body: body || '',
    read: false,
    key: o.key || null,                     /* 去重键（派生式信件必需，见 _mailTick） */
    deadlineT: typeof o.deadlineT === 'number' ? o.deadlineT : null,
    actions: o.actions || null,             /* 留给票决的三按钮（赞成/反对/弃权） */
  };
  this.s.inbox.push(m);
  if (this.s.inbox.length > 200) this.s.inbox.shift();
  if (!o.silent) this._log('mail', '✉ ' + from + ' 来信：' + subject, pid);
  return m;
};

/* 从**已有状态**派生该寄的信。
   ⚠ 为什么不直接在各系统的事件点上插一行 _mail：
     ① 事件点散在 04 / 05 / 09 / 11 / 15 五个 part，插一行就要动五处、逐个重对锚点；
     ② 事件点是“发生的那一瞬”，而信是“**要你处理的事**” —— 同一件事会在状态里
        持续成立（拍卖进行中、现金为负、有人在囤货），派生天然覆盖
        “我读档回来时它还在”，插点做不到。
   ⚠ 必须幂等：_flush 每次 act / tick 都跑，靠 key 去重；否则一场拍卖能寄出几百封。
   ⚠ 本批只覆盖**引擎已存在**的信号。NPC 提案（合作请求 / 收购通知 / 决议）
     需要决议数据模型，是下一刀 —— 这里**不伪造**。 */
Game.prototype._mailTick = function () {
  const s = this.s;
  if (!s || !Array.isArray(s.players)) return;
  if (!Array.isArray(s.inbox)) s.inbox = [];
  const me = s.players.find(p => p.id === s.humanId);
  if (!me) return;
  const has = k => s.inbox.some(m => m.key === k);
  const post = (key, kind, from, subject, body, opts) => {
    if (has(key)) return;
    this._mail(me.id, kind, from, subject, body, Object.assign({ key }, opts || {}));
  };

  /* ① 拍卖会进行中 —— 有时限，错过就没了，所以是最该寄的一封 */
  const a = s.auction;
  if (a && a.phase !== 'done') {
    const end = a.phase === 'sealed' ? a.sealedEndT : a.openEndT;
    post('auction:' + s.auctionCount, 'deal', '拍卖行', '开槌了，场上有货',
      end ? '现在能出价，剩 ' + Math.max(0, Math.round(end - s.t)) + ' 秒截止。过了这一场，下一场不知道什么时候。' :
            '现在能出价，抓紧。',
      { deadlineT: end || null });
  }

  /* ② 欠的账快赶上家底（与 08-chrome 的 warnBox、总账的健康灯同一杆标尺 × 1.5）*/
  let sheet = null;
  try { sheet = this.consolidated(me); } catch (e) { sheet = null; }
  if (sheet) {
    if (sheet.debt > 0 && sheet.nav < sheet.debt * BAL.maintRatio * 1.5) {
      post('maint', 'system', '钱庄', '你欠的账快赶上家底了',
        '再往下走，债主可能会上门拿地、拿货、拿公司抵债。先去“钱庄”把钱还上或把货卖掉。');
    }
  }

  /* ③ 现金为负（追保窗口已经开了）*/
  if (me.cash < 0) {
    post('cashneg', 'system', '钱庄', '你手上的现金已经是负的',
      '现金为负时会被记债。卖掉点货，或者去“钱庄”借一笔把洞堵上。');
  }

  /* ④ 有人在囤某种货（垄断倒计时）—— 风声，不是命令，所以写得像传闻 */
  const cd = s.countdown;
  if (cd && cd.crop && s.crops[cd.crop]) {
    post('mono:' + s.auctionCount + ':' + cd.crop, 'rumor', '市场上的风声',
      '有人在扫 ' + s.crops[cd.crop].name,
      '市面上开始有人大量收 ' + s.crops[cd.crop].name + '，价格已经在动了。要不要跟着做，你自己定。');
  }
};

/* ---- 3.9c NPC 提案（docs/19 §4.9：合作请求 / 收购通知 由对方主动发起，投进信匣）----------
   ⚠ 为什么用**独立随机流**（hash32(seed,'offers')）：一旦借用 this.rng.npc / main，
     就会挪动其它系统共用的随机序列 —— 660 局仿真的结果会整体变样。
     那不是“改对了”，是“换了个游戏”，而且 15 项守卫里没一项能告诉你“仿真变了是因为谁”。
   ⚠ 提案本身**不改任何状态**，只在答复时结算（见 _decideOffer）。
     否则仿真里会凭空多出钱货，而人一次点击就能把不变量撞坏。
   ⚠ 提案只发给玩家（humanId）：NPC 之间不走信匣。 */
Game.prototype._offerRng = function () {
  /* 懒建 + 不进存档：它只由 seed 决定，读档后重建即得同一条流。 */
  if (!this._offRng) this._offRng = new Rng(hash32(this.s.seed, 'offers'));
  return this._offRng;
};

Game.prototype._offerTick = function () {
  const s = this.s;
  if (!s || !Array.isArray(s.players)) return;
  if (!Array.isArray(s.offers)) s.offers = [];
  if (!Array.isArray(s.inbox)) s.inbox = [];
  if (typeof s.offersSeq !== 'number') s.offersSeq = 0;
  if (typeof s.offerSlot !== 'number') s.offerSlot = 0;
  const me = s.players.find(p => p.id === s.humanId);
  if (!me || !me.alive) return;

  /* 过期：提案有寿命。超时不是“没发生”，而是“对方把这个条件收回了”。 */
  for (const o of s.offers) if (o.status === 'open' && s.t > o.deadlineT) o.status = 'lapsed';

  /* ---- 第二段：**你发出去的**提议，NPC 那边给回音 ----
     ⚠ 这段必须放在下面那几个 early return **之前**：
       那些 return 是“NPC 主动来找你”的频率限制，不该把“别人回你的话”一起卡掉。
     ⚠ 延迟 3 游戏小时再回：秒回的话，“联系别人”看起来像按开关，
       而且那段时间玩家看不到“正在等回话”（docs/19 §4.9）。 */
  for (const o of s.offers) {
    if (!o.outbound || o.status !== 'open' || o.answered) continue;
    const to = s.players.find(x => x.id === o.to);
    if (!to || !to.alive) { o.status = 'lapsed'; continue; }
    if (to.isHuman) continue;                 /* 真人自己决定，引擎不代答 */
    if (s.t < o.t + 180) continue;
    o.answered = true;
    this._npcAnswer(o);
  }

  /* 前 6 个游戏小时是新手引导期，不打扰；之后每满 8 小时看一眼有没有人来谈事。 */
  if (s.t < 6 * 60) return;
  const slot = Math.floor(s.t / (8 * 60));
  if (slot <= s.offerSlot) return;
  s.offerSlot = slot;

  if (s.offers.filter(o => o.status === 'open').length >= 2) return;   /* 最多两件事等你答复 */
  const r = this._offerRng();
  if (!r.chance(0.55)) return;
  const others = s.players.filter(p => p.id !== s.humanId && p.alive);
  if (!others.length) return;
  const npc = others[Math.min(others.length - 1, Math.floor(r.next() * others.length))];

  /* 两选一：他要借你的钱 / 他要按溢价收你仓库里的货。只挑真做得成的那个。 */
  const lendable = Math.round(me.cash * 0.3 / 100) * 100;
  const canLoan = lendable >= 800;
  /* ⚠ 仓库（storage）里不只放作物，还放**加工品** —— 是同一个筐。
     所以这里必须按“它在 s.crops 或 s.products 里有没有价”来筛。
     我第一版只筛了“数量 > 0”，于是制造线一进到这里就崩：
       s.crops['萝卜干'].price → Cannot read properties of undefined
     660 局仿真里正是这样报出 48 条异常的（其余策略 0 条 —— 它们的仓库里只有作物）。 */
  const held = Object.keys(me.storage || {}).filter(k =>
    (s.crops[k] || s.products[k]) && Math.floor(me.storage[k] || 0) > 0);
  const canBuy = held.length > 0;
  if (!canLoan && !canBuy) return;
  const kind = (canLoan && canBuy) ? (r.chance(0.5) ? 'loan' : 'buy') : (canLoan ? 'loan' : 'buy');

  const deadlineT = s.t + 1440;                    /* 一天内答复 */
  const o = {
    i: ++s.offersSeq, t: Math.round(s.t), from: npc.id, fromName: npc.name,
    kind, status: 'open', deadlineT, mailId: null,
  };
  let subject, body;
  if (kind === 'loan') {
    o.amount = clamp(lendable, 800, 8000);
    o.rateDay = round2(BAL.loanRateDay * (1.6 + r.range(0, 0.9)));
    o.dueT = s.t + 2 * 1440;
    subject = npc.name + ' 想借 ' + money(o.amount) + ' G';
    body = npc.name + ' 手头周转不开，想跟你借 ' + money(o.amount) + ' G，' +
      '按每天 ' + (o.rateDay * 100).toFixed(1) + '% 计息，两天内还本付息。\n' +
      '你答应的话，钱当场从你账上划走；到期他不还，这笔就烂在你手里。';
  } else {
    const cid = held[Math.min(held.length - 1, Math.floor(r.next() * held.length))];
    const c = s.crops[cid] || s.products[cid];
    o.crop = cid;
    o.qty = Math.floor(me.storage[cid] || 0);
    o.mult = round2(1.12 + r.range(0, 0.23));      /* 溢价 12% ~ 35% */
    o.price = round2(c.price * o.mult);
    subject = npc.name + ' 出价要你手里的 ' + c.name;
    body = npc.name + ' 想一次把你手上的 ' + c.name + ' 全买走（' + o.qty + ' 单位），' +
      '开价 ' + o.price + ' G/单位，比眼下市价高 ' + Math.round((o.mult - 1) * 100) + '%。\n' +
      '这是场外交易，价格不会因此被压下去。答应就当场交割。';
  }
  o.mailId = this._mail(me.id, kind === 'loan' ? 'coop' : 'buyout', npc.name, subject, body,
    { deadlineT, actions: ['accept', 'decline'] }).i;
  s.offers.push(o);
};

/* 答复一份提案。**只有这里会改变状态**（提案本身只读，见 _offerTick 的注释）。
   p = 答复的人（目前只有玩家会走到这）。accept = 接受 / 拒绝。 */
Game.prototype._decideOffer = function (p, id, accept) {
  const s = this.s;
  if (!Array.isArray(s.offers)) s.offers = [];
  const o = s.offers.find(x => x.i === id);
  if (!o) return { ok: false, msg: '这封信已经不在了' };
  if (o.status !== 'open') return { ok: false, msg: '这件事你已经答复过了' };
  if (s.t > o.deadlineT) { o.status = 'lapsed'; return { ok: false, msg: '答复时间已经过了' }; }
  const npc = s.players.find(x => x.id === o.from);
  if (!accept) {
    o.status = 'declined';
    return { ok: true, msg: '已回绝。' };
  }
  /* ↓ 新增的方向：由**你**发起、对方点头（docs/19 §4.9）。
     老的两支（loan / buy）是“NPC 求你”，这两支是“你求别人”，共用同一份 s.offers。 */
  if (o.kind === 'jv' || o.kind === 'invite' || o.kind === 'borrow') {
    return this._settleNew(p, o, accept);
  }
  if (o.kind === 'loan') {
    if (p.cash < o.amount) return { ok: false, msg: '你手上的现金不够借给他' };
    p.cash -= o.amount;
    /* 字段形状与 13-talent.js:131 的放贷一致，到期由 04-ticks 的到期钩子收本息 / 认坏账。 */
    p.loansOut.push({ toPid: o.from, principal: o.amount, rateDay: o.rateDay, dueT: o.dueT });
    if (npc) npc.cash += o.amount;
    o.status = 'accepted';
    this._log('money', p.name + ' 借给 ' + (npc ? npc.name : '某人') + ' ' + money(o.amount) +
      ' G（每天 ' + (o.rateDay * 100).toFixed(1) + '% 计息）', p.id);
    return { ok: true, msg: '钱已经划给他了，到期自动收本息。' };
  }
  /* buy：场外交割。不动盘面（这正是对方能给溢价的理由）。 */
  const have = Math.floor(p.storage[o.crop] || 0);
  const qty = Math.min(o.qty, have);
  if (qty <= 0) {
    o.status = 'lapsed';
    return { ok: false, msg: '你手上已经没有这种货了' };
  }
  const gross = qty * o.price;
  const book = p.avgCost[o.crop] || { q: 0, c: 0 };
  const profit = gross - qty * book.c;        /* 成本口径与 06-trade.js:106 的成交一致 */
  p.storage[o.crop] = have - qty;
  if (p.avgCost[o.crop]) p.avgCost[o.crop].q = Math.max(0, book.q - qty);
  p.cash += gross;
  p.realized += profit;
  p.m.realized += profit;
  if (npc) npc.cash -= gross;
  o.status = 'accepted';
  const gname = (s.crops[o.crop] || s.products[o.crop] || {}).name || o.crop;
  this._log('trade', p.name + ' 把手上的 ' + gname + ' 一次卖给 ' +
    (npc ? npc.name : '某人') + '（' + qty + ' 单位 @' + o.price + '）', p.id);
  return { ok: true, msg: '已交割，钱到账。' };
};

/* 动作入口：Game.prototype.act 是按 `_a_` + name 反射查找的，
   所以新增动作只需加方法，**不用去改任何分派表**（也就不会踩到别人正在改的那段）。 */
Game.prototype._a_acceptOffer = function (p, d) { return this._decideOffer(p, +d.id, true); };
Game.prototype._a_declineOffer = function (p, d) { return this._decideOffer(p, +d.id, false); };

/* ---- 3.9e 主动联系：由**你**向别人发提案（docs/19 §4.9）------------------
   三种：借钱 / 入股（合资）/ 拉人议事。
   ⚠ “合资创办公司”在本作落成**入股你现有的公司**（对方出钱换股份）——
     “创办一家全新公司”需要公司实体 id（见 docs/19 §4.13 的架构阻断记录），
     而入股在现有模型里能做到真持股、真分红、真表决（名册里会真的多出一条）。
   ⚠ 你自己发出的提议**不进你的信匣**（信是“要你处理的事”，不该把你自己发的东西塞回来），
     只在流水条上留一条。对方是真人时才寄信给他。 */
Game.prototype._a_contact = function (p, d) {
  const s = this.s;
  if (!Array.isArray(s.offers)) s.offers = [];
  if (typeof s.offersSeq !== 'number') s.offersSeq = 0;
  const to = s.players.find(x => x.id === d.toPid);
  if (!to || !to.alive) return { ok: false, msg: '找不到这个人' };
  if (to.id === p.id) return { ok: false, msg: '不用跟自己谈' };
  const open = s.offers.filter(o => o.status === 'open' && o.from === p.id).length;
  if (open >= 3) return { ok: false, msg: '你手上还有几件没回音的，先等人家回话' };

  const kind = d.kind || 'borrow';
  const deadlineT = s.t + 1440;               /* 一天内答复（与 NPC 提案同口径） */
  const o = {
    i: ++s.offersSeq, t: Math.round(s.t), from: p.id, fromName: p.name,
    to: to.id, kind, status: 'open', deadlineT, mailId: null, outbound: true,
  };
  let subject, body, mailKind;
  if (kind === 'borrow') {
    o.amount = Math.floor(d.amount == null ? 3000 : d.amount);
    if (!(o.amount > 0)) return { ok: false, msg: '要借多少得说个数' };
    /* ⚠ 默认开的息必须**高于**市面利率（BAL.loanRateDay）——
       照市面利率开，NPC 的判定（≥ 市面×1.1）永远不通过，
       “借钱”那颗一键按钮就变成了一颗必然失败的按钮。 */
    o.rateDay = clamp(d.rateDay == null ? BAL.loanRateDay * 1.25 : d.rateDay, 0, 0.2);
    o.dueT = s.t + 2 * 1440;
    subject = p.name + ' 想跟你借 ' + money(o.amount) + ' G';
    body = p.name + ' 手头周转不开，想跟你借 ' + money(o.amount) + ' G，按每天 ' +
      (o.rateDay * 100).toFixed(1) + '% 计息，两天内还本付息。\n' +
      '答应的话，钱当场从你账上划给他；到期他不还，这笔就烂在你手里。';
    mailKind = 'coop';
  } else if (kind === 'jv') {
    /* 标的 = **这位持股人**（一人一公司），不是“哪家公司” —— 见 rofrHolder 的注释。 */
    const target = to;
    const own = (target.holdings || []).find(h => h.corpId === target.corp);
    const cur = own && own.stake != null ? own.stake : 1;
    o.give = clamp(d.give == null ? 0.2 : d.give, 0, Math.max(0, cur - 0.05));
    if (!(o.give > 0)) return { ok: false, msg: '他手上的股份已经很分散，先谈不动' };
    const after = cur - o.give;
    /* 控制权溢价（§4.14 A）：现实惯例 20~40%，本作默认 30%。
       这一笔之后他不再控股 ⇒ 你买的是“说了算”，所以贵三成。 */
    const cross = cur > 0.5 && after <= 0.5;
    o.controlMult = cross ? 1.3 : 1;
    o.price = Math.round(this.stakePrice(target, o.give) * o.controlMult);
    if (!(o.price > 0)) return { ok: false, msg: '这家公司现在估值太低，开不了价' };
    subject = p.name + ' 要买你公司 ' + Math.round(o.give * 100) + '% 的股份';
    body = p.name + ' 出价 ' + money(o.price) + ' G，要买你手上 ' +
      Math.round(o.give * 100) + '% 的股份' +
      (cross ? '（买完这家公司他说了算）' : '') + '。\n' +
      '钱进你公司的账。这笔要**先问过其他股东** —— 他们可以按同样的条件先拿。';
    mailKind = 'deal';
  } else if (kind === 'invite') {
    const dec = (s.decisions || []).find(x => x.status === 'open' && x.ownerPid === p.id);
    if (!dec) return { ok: false, msg: '你现在没有在议的事 —— 先去股东会提一件' };
    o.decId = dec.id;
    subject = p.name + ' 请你对「' + dec.label + '」表个态';
    body = p.name + ' 想请你对「' + dec.label + '」表个态 —— 回一声你的意见。';
    mailKind = 'vote';
  } else {
    return { ok: false, msg: '没有这种事' };
  }
  if (to.isHuman) {
    o.mailId = this._mail(to.id, mailKind, p.name, subject, body,
      { deadlineT, actions: ['accept', 'decline'] }).i;
  }
  s.offers.push(o);
  this._log('mail', '✉ 你给 ' + to.name + ' 发了件事：' + subject, p.id);
  return { ok: true, msg: '发出去等回话，一天内他不回就算这事收回了' };
};

/* 新方向提案的结算（借钱 / 入股 / 拉人议事）。accepter = 点头的那个人。
   ⚠ 记账必须**两边成对**：一方减的一方必须加，否则仿真里会凭空多出钱货
     （这是 _decideOffer 注释里警告过的事，新分支同样适用）。 */
Game.prototype._settleNew = function (p, o, accept) {
  const s = this.s;
  const other = s.players.find(x => x.id === (o.from === p.id ? o.to : o.from));
  if (!other || !other.alive) { o.status = 'lapsed'; return { ok: false, msg: '对方已经不在了' }; }
  if (!accept) { o.status = 'declined'; return { ok: true, msg: '你回绝了。' }; }

  if (o.kind === 'borrow') {
    /* p = 出钱的一方（借出人），other = 借钱的一方 */
    if (p.cash < o.amount) return { ok: false, msg: '你手上的现金不够借出去' };
    p.cash -= o.amount; other.cash += o.amount;
    other.debt += o.amount;
    if (!Array.isArray(p.loansOut)) p.loansOut = [];
    p.loansOut.push({ toPid: other.id, principal: o.amount, rateDay: o.rateDay, dueT: o.dueT });
    o.status = 'accepted';
    this._log('money', p.name + ' 借给 ' + other.name + ' ' + money(o.amount) +
      ' G（每天 ' + (o.rateDay * 100).toFixed(1) + '% 计息）', p.id);
    return { ok: true, msg: '钱已经划出去了，到期自动收本息。' };
  }

  if (o.kind === 'jv') {
    /* ⚠ 方向必须按**提议本身**定，不能按“谁答复”定：
         发起人 = 买方（from）、被问的人 = 卖方（to）。
         我第一版把付款方写成 p（答复者），于是「你买 NPC 的股份」会变成 NPC 付钱给你 ——
         买卖反了，而且表面上还“成交”了，静默错账。
       ⚠ 钱进**卖方公司账**（增资口径）：卖方老板的并表身价因此不变，
         他把股份换成等额现金，两边都不吃亏（buyer test B6 锁这条）。 */
    const buyer = s.players.find(x => x.id === o.from);
    const seller = s.players.find(x => x.id === o.to);
    if (!buyer || !buyer.alive || !seller || !seller.alive) {
      o.status = 'lapsed'; return { ok: false, msg: '有一方已经不在了' };
    }
    const ownH = (seller.holdings || []).find(h => h.corpId === seller.corp);
    if (!ownH) { o.status = 'lapsed'; return { ok: false, msg: '这家公司已经不在了' }; }
    const cur = ownH.stake == null ? 1 : ownH.stake;
    const give = Math.min(o.give, cur);
    if (!(give > 0)) { o.status = 'lapsed'; return { ok: false, msg: '卖方手里没有可让的股份' }; }
    /* 钱不够就买不成（不做“付一部分、拿全部”的错账） */
    if (buyer.cash < o.price) { o.status = 'lapsed'; return { ok: false, msg: '买方现在拿不出这笔钱' }; }
    const price = o.price;
    const round4 = x => Math.round(x * 10000) / 10000;
    const deliver = (holder) => {
      holder.cash -= price;                              /* 买方付钱 */
      seller.cash += price;                              /* 钱进卖方**公司账**，不进老板口袋 */
      ownH.stake = round4(cur - give);
      if (!Array.isArray(holder.stakes)) holder.stakes = [];
      holder.stakes.push({ targetPid: seller.id, stake: give, price, t: Math.round(s.t) });
      o.status = 'accepted';
    };
    const rofr = this.rofrHolder(seller, buyer.id, price);
    if (rofr && rofr.pid !== buyer.id) {
      const hp = s.players.find(x => x.id === rofr.pid);
      deliver(hp);
      o.rofr = hp.id;
      buyer.memory = buyer.memory || {};
      if (!buyer.memory.grudge) buyer.memory.grudge = {};
      buyer.memory.grudge[hp.id] = (buyer.memory.grudge[hp.id] || 0) + 1;
      this._log('deal', seller.name + ' 的股份被 ' + hp.name + ' 按优先权先拿走了 —— ' +
        buyer.name + ' 白跑一趟', buyer.id);
      return { ok: true, msg: '按规矩，其他股东可以同价先拿 —— ' + hp.name +
        ' 把它拿走了。这价你买不到了。' };
    }
    deliver(buyer);
    const ctrl = ownH.stake <= 0.5;
    this._log('deal', buyer.name + ' 买下了 ' + seller.name + ' 公司 ' + Math.round(give * 100) +
      '% 的股份（出 ' + money(price) + ' G）' + (ctrl ? ' —— 这家公司他说了算' : ''), buyer.id);
    return { ok: true, msg: '成交：你拿下 ' + Math.round(give * 100) + '% 的股份 —— ' +
      (ctrl ? '这家公司现在你说了算。' : '以后分钱有你一份。') };
  }

  if (o.kind === 'invite') {
    const dec = (s.decisions || []).find(x => x.id === o.decId && x.status === 'open');
    if (!dec) { o.status = 'lapsed'; return { ok: false, msg: '那件事已经结束了' }; }
    /* ⚠ 只是被拉来表态**不算股东**：capTable 里没他，这一票在结算时不进分母。
       真正的股东身份只能靠入股拿到（那时名册里会真的多出一条）。
       写清楚这一条，是为了避免“应付一句就等于有了股份”的错觉。 */
    dec.voters[p.id] = 'for';
    o.status = 'accepted';
    this._log('event', p.name + ' 对「' + dec.label + '」表了态：同意', p.id);
    return { ok: true, msg: '已经替你表了态：同意。' };
  }

  o.status = 'lapsed';
  return { ok: false, msg: '这种事不会办' };
};

/* 你发出去的提议，NPC 给的回音。判定规则要“看得懂”（不是黑箱概率）：
     · 借钱：他手上有钱、且你给得起息（不低于市面利率）才借
     · 入股：他现金够、且价钱不吃亏（不高于公允价）才入
     · 议事：他有空就表个态
   ⚠ 用 _offerRng（独立流），不能借 this.rng.main —— 那会把 660 局仿真整体挪位，
     而没有任何一条守卫能告诉你“仿真变了是因为谁”。 */
Game.prototype._npcAnswer = function (o) {
  const s = this.s;
  const to = s.players.find(x => x.id === o.to);
  const me = s.players.find(x => x.id === o.from);
  if (!to || !to.alive || !me) { o.status = 'lapsed'; return; }
  const r = this._offerRng();
  if (o.kind === 'borrow') {
    const ok = to.cash >= o.amount && o.rateDay >= BAL.loanRateDay * 1.1;
    if (!ok) {
      o.status = 'declined';
      this._log('mail', '✉ ' + to.name + ' 回话：这笔钱他现在拿不出来', to.id);
      return;
    }
    this._settleNew(to, o, true);
    return;
  }
  if (o.kind === 'jv') {
    /* ⚠ 卖的是**他的**公司 ⇒ 公允价必须按**卖方**算；
       能不能成交要看**买方**付不付得起。
       我第一版两处都写反了（拿买方的估值、又去查卖方的现金）——
       结果是“他钱不够所以不卖你”，而卖的人根本不付钱。 */
    const fair = this.stakePrice(to, o.give);
    const ok = me.cash >= o.price && o.price >= fair * 0.98;
    if (!ok) {
      o.status = 'declined';
      this._log('mail', '✉ ' + to.name + ' 回话：这个价他不卖', to.id);
      return;
    }
    this._settleNew(to, o, true);
    return;
  }
  if (o.kind === 'invite') {
    if (!r.chance(0.6)) {
      o.status = 'declined';
      this._log('mail', '✉ ' + to.name + ' 回话：这事他不想掺和', to.id);
      return;
    }
    this._settleNew(to, o, true);
    return;
  }
  o.status = 'lapsed';
};

Game.prototype._flush = function () {
  /* 派生式信件与 NPC 提案的唯一入口。放在 listeners 之前：这样订阅者（UI）拿到的 s
     已经包含本帧新到的东西，不会出现“预览图有信、信匣里没有”的错位。 */
  this._mailTick();
  this._offerTick();
  for (const fn of this.listeners) fn(this.s);
};

/* ---------------------------------------------------------------------------
 * 4. 结算：叙事颁奖礼
 * -------------------------------------------------------------------------*/