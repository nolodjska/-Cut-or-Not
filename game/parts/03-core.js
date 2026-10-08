/* ===== part: 03-core.js ===== */
function Game(opts) {
  opts = opts || {};
  this.s = null;                       // 全部可序列化状态
  this.rng = {};                       // 运行时 RNG（由种子重建）
  this.listeners = [];
  this._init(opts);
}

/* ---- 3.1 世界生成 -------------------------------------------------------*/
Game.prototype._init = function (opts) {
  const seed = opts.seed || makeSeed(new Rng(hash32('seed', 'boot:' + (opts.seedHint || 'x'))));
  const worldRng = new Rng(hash32(seed, 'world'));
  const ruleRng = new Rng(hash32(seed, 'rules'));

  // 定时事件表（确定性预生成）
  const evRng = new Rng(hash32(seed, 'events'));
  const eventQueue = [];
  const slots = [
    { day: 1, hour: 10 }, { day: 1, hour: 20 },
    { day: 2, hour: 8 },  { day: 2, hour: 16 }, { day: 2, hour: 22 },
    { day: 3, hour: 9 },  { day: 3, hour: 17 },
  ];
  for (const slot of slots) {
    if (!evRng.chance(0.82)) continue;
    const total = EVENT_POOL.reduce((a, e) => a + e.weight, 0);
    let r = evRng.next() * total, pick = EVENT_POOL[0];
    for (const e of EVENT_POOL) { r -= e.weight; if (r <= 0) { pick = e; break; } }
    const crop = pick.all ? null : evRng.pick(CROP_IDS);
    eventQueue.push({
      at: ((slot.day - 1) * 24 + slot.hour) * 60,
      id: pick.id, crop, fired: false, revealed: false,
      durMin: pick.durH * 60,
      yieldMult: pick.yieldMult, anchorMult: pick.anchorMult,
      policy: !!pick.policy, subsidy: !!pick.subsidy,
    });
  }

  // 规则变异（docs/04：预算约束，单路径累计幅度 ≤3）
  const rules = {
    nakedShort: ruleRng.chance(0.45),
    limitDown: !ruleRng.chance(0.30),
    doubleLandRent: ruleRng.chance(0.20),
    intelPublic: ruleRng.chance(0.20),
    auctionBig: ruleRng.chance(0.25),
    doubleStoragePrice: ruleRng.chance(0.20),
    /* 种子必须先在市场买（docs/19 §4.15）。**新局默认开**；
       旧存档的 rules 里没有这个键 ⇒ 读出来是 undefined ⇒ falsy
       ⇒ 自动走“播种直接扣现金”的老路径（兼容，不改旧档行为）。 */
    seedMustBuy: true,
  };

  const crops = {};
  for (const c of CROPS) {
    const cr = new Rng(hash32(seed, 'crop:' + c.id));
    const drift = 1 + cr.range(-0.06, 0.06);
    crops[c.id] = {
      id: c.id, name: c.name, icon: c.icon, growH: c.growH, seed: c.seed, yld: c.yld,
      base: round2(c.base * drift), price: round2(c.base * drift), anchor: round2(c.base * drift),
      twap: round2(c.base * drift),
      float0: c.float0, hold0: c.hold0, eta: c.eta, absorbDay: c.absorbDay,
      /* depth = 价格冲击的分母（市场能吸收多少货而不动价），远大于做市商库存。
         float0 决定"你能买到多少货"，depth 决定"买这些货会把价格推多远"。
         混为一谈会让一次正常收成就把价格砸穿（已修）。 */
      depth: Math.max(60, c.absorbDay * BAL.depthMult),
      vol: c.vol, rotH: c.rotH, mono: c.mono, tier: c.tier, note: c.note,
      market: c.market || 'primary', hasSpot: true,
      mmInv: c.float0,                   // 做市商/对手盘库存
      eventMult: 1, policyMult: 1, rumorUntil: 0, rumorMult: 1,
      peak: round2(c.base * drift), trough: round2(c.base * drift),
      absorbedToday: 0, lastAbsorbT: 0,
      hist: [{ t: 0, p: round2(c.base * drift) }],
    };
  }

  // 产品市场（价格由原料估值价推导，不是自由浮动）
  const products = {};
  for (const pd of PRODUCTS) {
    const cr = new Rng(hash32(seed, 'prod:' + pd.id));
    const p0 = round2(pd.base * (1 + cr.range(-0.04, 0.04)));
    products[pd.id] = {
      id: pd.id, name: pd.name, icon: pd.icon, from: pd.from, need: pd.need, out: pd.out,
      hours: pd.hours, absorbDay: pd.absorbDay, note: pd.note,
      market: pd.market || 'craft', hasSpot: true,
      base: pd.base, price: p0, anchor: pd.base, twap: p0, vol: 0.09,
      /* 产品市场比原料更薄：下游能吃下的量有限，这是"加工利润高但规模受限"的来源 */
      float0: 120, mmInv: 120, mmInvMax: 400, mmInv0: 120, eta: 2.2,
      /* 深度按价值等价放大：产品单位数少（一批才 2 件），但一次交易的"金额"与作物同量级，
         所以冲击分母不能直接用品单位数，否则一笔正常卖出就能把价格砸掉一半。 */
      depth: Math.max(200, (pd.absorbDay / pd.base) * BAL.depthMult * 10), policyMult: 1,
      anchorImpactShare: 0.15,   // 产品锚对交易的敏感度更低（它应该跟着原料走，不该跟着炒作走）
      peak: p0, hist: [{ t: 0, p: p0 }], lastHistT: 0,
    };
  }

  /* 投入品（docs/19 §4.15）：有牌价、不浮动、不进 hist/twap 循环。
     仍然建 twap = base，好让 valuePrice/UI 复用同一套访问器而不出 NaN。 */
  const inputs = {};
  for (const it of INPUTS) {
    inputs[it.id] = {
      id: it.id, name: it.name, icon: it.icon, kind: it.kind, crop: it.crop,
      pack: it.pack || 1, germ: it.germ == null ? 1 : it.germ, note: it.note || '',
      market: 'input', hasSpot: false,
      base: it.base, price: it.base, anchor: it.base, twap: it.base,
      vol: 0, hist: [],
      /* ⚠ 下面这几个字段是**故意不建**的：mmInv / depth / float0 / eta / absorbDay。
         交易代码（quote/_trade/_impact）靠它们算冲击与可买量；投入品固定牌价、无冲击，
         走的是 _buyInput 这条独立路径。留空能让“误用通用路径”立刻显形（NaN），比默认 0 安全。 */
    };
  }

  this.s = {
    version: BAL.version, seed, t: 0, day: 1, secPerGameHour: opts.secPerGameHour || 8,
    speed: 1, paused: false, over: false, overReason: null,
    crops, products, inputs, rules,
    eventQueue, activeEvents: [],
    players: [], humanId: 'P0',
    auction: null, auctionCount: 0,
    countdown: null,
    /* 决议记录（docs/19 §4.13）：只存已经提出来、还没结束的那些。
       旧存档没有这个键 ⇒ 全仓一律用 (s.decisions || []) 兜底。 */
    decisions: [], decisionSeq: 0,
    lotInterventions: [],
    feed: [], feedSeq: 0,
    /* 信匣（docs/20 §2.1）：只装**指名寄给人的信**，与 feed（公共流水）分开。
       旧存档没有这个键 → 引擎与 UI 一律用 Array.isArray 兜底，不做迁移。 */
    inbox: [], inboxSeq: 0,
    /* NPC 提案（docs/19 §4.9）：对方主动发来的合作请求 / 收购通知。
       与 inbox 分开存：信是“通知”，提案是“可执行的东西”（有状态机
       open / accepted / declined / lapsed）；信只是它的一张脸。
       混在一起的话，“这封信还能不能点”就得去猜字符串了。 */
    offers: [], offersSeq: 0, offerSlot: 0,
    stats: { injections: 0, trades: 0, monopolist: null },
    seq: 0,
  };

  this._buildRngs();
  this._log('system', '赛季 ' + seed + ' 开始。规则：' + this._ruleText(), null);
  this._spawnPlayers(opts);   // 放在赛季开局日志之后，这样"复仇开局"的提示会出现在它下面

  // 开局保底：把当天第一个事件提前告知（新手友好）
  /* 注：原来这里有一句"把第一个事件提前告知（新手友好）"，但 first.revealed 从未被任何
     地方读取 —— 等于写了个没接上的新手引导（评审发现）。已删除，免得继续误导。 */
};

/* 把 PRNG 的当前状态同步进 s，供存档使用。
   必须在 advanceGame 和 act 之后都调用 —— 只在一处写的话，
   "只调了 act（买情报/放消息都会消耗随机数）然后存档" 会丢掉这段随机流，
   读档后同样的操作会得到同样的随机结果（可被玩家利用）。 */
Game.prototype._syncRng = function () {
  this.s.rngState = {};
  for (const k in this.rng) this.s.rngState[k] = this.rng[k].s;
};

Game.prototype._buildRngs = function () {
  const seed = this.s.seed;
  this.rng = {
    main: new Rng(hash32(seed, 'main')),
    npc: new Rng(hash32(seed, 'npc')),
    market: new Rng(hash32(seed, 'market')),
    talent: new Rng(hash32(seed, 'talent')),
    auction: new Rng(hash32(seed, 'auction')),
  };
  // 恢复状态（读档时由外部回填）
  for (const k in this.rng) {
    const saved = this.s.rngState && this.s.rngState[k];
    if (typeof saved === 'number') this.rng[k].s = saved >>> 0;
  }
};

Game.prototype._ruleText = function () {
  const r = this.s.rules, out = [];
  out.push(r.nakedShort ? '手里没货也能先卖' : '想卖手里没有的货，得先借到');
  out.push(r.limitDown ? '有涨跌停保护' : '无涨跌停');
  if (r.doubleLandRent) out.push('地租翻倍');
  if (r.intelPublic) out.push('公开情报更准');
  if (r.auctionBig) out.push('拍卖标的加倍');
  if (r.doubleStoragePrice) out.push('仓储涨价');
  return out.join('／');
};

Game.prototype._newPlayer = function (id, name, corpId, isHuman) {
  const corp = CORPS.find(c => c.id === corpId) || CORPS[0];
  const np = BAL.startPlots + corp.start.plots;
  const plots = [];
  for (let i = 0; i < np; i++) plots.push({ crop: null, plantedT: null, matureT: null, auto: false, upgraded: false, use: 'grain', district: 'suburb' });
  const p = {
    id, name, corp: corp.id, corpName: corp.name, isHuman: !!isHuman,
    /* 持仓层（docs/13 §7）：玩家是金融巨鳄，可能持有多家公司。
       开局只能选一家（2026-10-08 定），所以初始恒为 1 条、control = 1。
       p.corp 保留为“主控公司 id”——全项目现有代码都读它，不动它。
       出局判据 = 所有持仓都破产（§7.4）；单公司破产 = 净资产跌破维持线且追保逾期（§4.3）。 */
    holdings: [{ corpId: corp.id, stake: 1, control: 1, debt: 0, bankrupt: false, acquiredAt: 0 }],
    cash: BAL.startCash + corp.start.cashMod,
    /* 个人钱包（docs/19 §4.12）：从公司账上“拿走”的钱进这里。
       ⚠ 它**不是**额外白得的一笔钱 —— 每进 1 G，须同时计一份负债（见 _a_take），
         所以身价当场不变。这个字段存在的意义就是“拿钱要有对价”这件事能被审计。
       旧存档没有这个键 ⇒ 读出来是 undefined ⇒ 全仓一律用 (p.personal || 0) 兼容。 */
    personal: 0,
    debt: 0, deposit: 0,
    plots, storage: {}, storageCap: BAL.storageCap + corp.start.storageMod,
    avgCost: {}, realized: 0, reputation: 50,
    alive: true, bankruptT: null, bankruptCount: 0,
    cp: 0, level: 1, talents: [], talentOffers: null, freeReroll: 1,
    shell: { owned: corp.freeShell || 0, cover: corp.freeShell ? 40 : 0, on: corp.freeShell ? 1 : 0, exposedT: null },
    workshops: corp.freeWorkshop || 0,   // 作坊数量
    craftJobs: [],                       // [{pid, startedT, doneT, out}]
    brand: 0,                            // 品牌值 0~100，决定成品卖价溢价
    /* §17.1 收货商：**只记你自己**今天卖了他多少（不是全市场）。
       理由见 BAL.dealerQuotaMult 的注释（这是试玩员拓出来的 bug）。
       ⇒ 牌子上的每个数字，都只由**你自己**的行为解释。 */
    dealerSold: {},        // {cid: 今天你自己卖给他的数量}
    dealerSoldDay: -1,
    /* §17.2 上门的买家：每人一块「会变的状态」（§17.5 通用法则 1 = 一个角色 + 一块会变的牌子）
       met = 见过几次（→ 回头客）；boughtToday = 今天卖了他多少（→ 吃腻了）；
       day/refusedDay = 都按“游戏日”计，避免额外的日切钩子；used = 豪客只来一次。 */
    buyers: {
      hood:     { met: 0, day: -1, boughtToday: 0, refusedDay: -1 },
      workshop: { met: 0, day: -1, boughtToday: 0, refusedDay: -1 },
      tycoon:   { met: 0, day: -1, boughtToday: 0, refusedDay: -1, used: false },
    },
    loansOut: [],                        // 放出去的账 [{toPid, principal, rateDay, dueT}]
    shorts: {},
    limitOrders: [], orderSeq: 0,
    mods: {
      growMult: 1, yieldMult: 1, disasterMult: 1, rotMult: 1, doubleHarvest: 0,
      storageBonus: 0, sellImpactMult: 1, buyImpactMult: 1, dumpBonus: 1, feeMult: 1,
      intelLeadH: 0, rumorCostMult: 1, rumorShiftMult: 1, shortMarginMult: 1,
      loanIncomeMult: 1, snipeDeposit: 1, sabotage: 0, hiddenStorage: 0,
      escapeRope: 0, holdFeeFree: 0,
    },
    m: {
      harvestedValue: 0, harvestedUnits: 0, realized: 0, volume: 0, feePaid: 0,
      volContrib: 0, harvestCredit: 0, blessCredit: 0,
      intelSold: 0, intelCorrect: 0, intelBought: 0, intelKnown: [],
      auctionSpend: 0, auctionWins: 0, acquisitions: 0, acquiredValue: 0,
      aggression: 0, dumpImpactMax: 0, publicTrades: 0, shellTrades: 0,
      rumorCount: 0, rumorExposed: 0, shortCount: 0,
      craftedValue: 0, craftedUnits: 0, interestEarned: 0, badDebt: 0, lentTotal: 0,
      cropTraded: {}, navHist: [], peakNav: 0, monoPeak: 0,
      creditsGiven: 0, creditsTaken: 0,
    },
    taxfreeUntil: 0, exportUntil: 0,
    initNav: 0,          // 开局净资产（在 _spawnPlayers 里回填，A 门槛以它为分母）
  };
  return p;
};

Game.prototype._spawnPlayers = function (opts) {
  const corpId = opts.corp || 'grow';
  const human = this._newPlayer(this.s.humanId, opts.playerName || '你', corpId, true);
  this.s.players.push(human);

  // NPC 阵容
  const npcCount = opts.npcs == null ? 3 : opts.npcs;
  const PERSONAS = [
    { name:'老陈', persona:'稳健农夫', corp:'grow',  w:{risk:0.25, aggro:0.20, info:0.30, patience:0.85, revenge:0.30} },
    { name:'阿May', persona:'激进操盘', corp:'trade', w:{risk:0.85, aggro:0.80, info:0.55, patience:0.25, revenge:0.70} },
    { name:'眼镜', persona:'情报贩子', corp:'intel', w:{risk:0.45, aggro:0.35, info:0.95, patience:0.55, revenge:0.45} },
    { name:'坤叔', persona:'阴险地头蛇', corp:'shell', w:{risk:0.60, aggro:0.90, info:0.60, patience:0.70, revenge:0.95} },
    { name:'祥嫂', persona:'作坊主',   corp:'make',  w:{risk:0.35, aggro:0.30, info:0.45, patience:0.90, revenge:0.35} },
    { name:'钱串儿', persona:'放贷的',  corp:'fin',   w:{risk:0.55, aggro:0.50, info:0.65, patience:0.65, revenge:0.55} },
  ];
  const shuffled = this.rng.npc.shuffle(PERSONAS);
  for (let i = 0; i < npcCount && i < shuffled.length; i++) {
    const per = shuffled[i];
    const npc = this._newPlayer('N' + (i + 1), per.name, per.corp, false);
    npc.persona = per.persona;
    npc.w = per.w;
    npc.memory = { grudge: {}, lastActionT: -999, plantedAt: 0 };
    // NPC 初始持有（对应 hold0；分给 NPC 作为市场存量的一部分）
    for (const cid of CROP_IDS) {
      const share = Math.round(this.s.crops[cid].hold0 / Math.max(1, npcCount));
      if (share > 0) { npc.storage[cid] = share; npc.avgCost[cid] = this.s.crops[cid].base * 1.02; }
    }
    this.s.players.push(npc);
  }
  /* 复仇开局（原案 §7.4「带少量遗产重新开始」）：
     遗产 = 上局净值的 12%、上限 300 G；再加一个自选天赋；
     代价是第 1 天公开挂「复仇者」标记，NPC 对你的攻击性 ×1.3（04 分支的结论：
     复仇开局胜率目标 22~25%，是基准 16.7% 的 1.3 倍左右，不是翻倍）。 */
  if (opts.inheritance) {
    const inh = opts.inheritance;
    const cash = Math.min(300, Math.round((inh.nav || 0) * 0.12));
    human.cash += cash;
    human.isAvenger = true;
    if (inh.talentId) {
      const t = TALENTS.find(x => x.id === inh.talentId);
      if (t) { human.talents.push(t.id); t.apply(human); }
    }
    this._log('system', '复仇开局：' + human.name + ' 带着上局剩下的 ' + cash + ' G 回来了' +
      (inh.talentId ? '，还记得【' + ((TALENTS.find(x => x.id === inh.talentId) || {}).name || '') + '】' : '') +
      '。全场都看得见这个标记，NPC 会重点照顾你。', null);
  }
  // 回填开局净资产（六种公司的起步应当大致齐平，见 docs/09 数值口径仲裁）
  for (const p of this.s.players) p.initNav = this.nav(p);
};

/* ---- 3.2 时间推进 -------------------------------------------------------*/
Game.prototype.advanceReal = function (realSeconds) {
  if (this.s.over) return;
  const spd = this.s.paused ? 0 : this.s.speed;
  if (spd <= 0) { this._flush(); return; }
  const gmin = realSeconds * spd * 60 / this.s.secPerGameHour;
  this.advanceGame(gmin);
};

Game.prototype.advanceGame = function (gameMinutes) {
  if (this.s.over || gameMinutes <= 0) return;
  let left = gameMinutes;
  let guard = 0;
  // 兜底上限跟随请求时长，而不是写死 4000 ——
  // 写死会让"一次推进一整天"这类调用被静默截断（UI 的 URL 预设就踩过）
  const maxSteps = Math.ceil(gameMinutes) + 8;
  while (left > 0 && !this.s.over && guard++ < maxSteps) {
    const step = Math.min(left, 1);      // 价格按 1 游戏分钟粒度结算
    this._tick(step);
    left -= step;
  }
  this._syncRng();
  this._flush();
};

Game.prototype._tick = function (dt) {
  const s = this.s;
  s.t += dt;
  s.day = Math.floor(s.t / 1440) + 1;

  this._eventTick(dt);
  this._priceTick(dt);
  this._productTick(dt);
  this._productionTick(dt);
  this._craftTick(dt);
  this._orderTick(dt);
  this._npcTick(dt);
  this._shellTick(dt);
  this._auctionTick(dt);
  this._timerTick();
  this._interestTick(dt);
  this._bankruptcyTick();
  this._navTick(dt);
  this._countdownTick();
  this._decisionTick();
  if (!s.over && s.t >= BAL.days * 1440) this._end('3 天赛季结束');
};

/* 事件：触发 / 到期 / 补贴 */
