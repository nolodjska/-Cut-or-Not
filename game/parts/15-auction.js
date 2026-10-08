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

Game.prototype._flush = function () {
  /* 派生式信件的唯一入口。放在 listeners 之前：这样订阅者（UI）拿到的 s
     已经包含本帧新到的信，不会出现“预览图有信、信匣里没有”的错位。 */
  this._mailTick();
  for (const fn of this.listeners) fn(this.s);
};

/* ---------------------------------------------------------------------------
 * 4. 结算：叙事颁奖礼
 * -------------------------------------------------------------------------*/