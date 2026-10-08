/* ===== part: 04-ticks.js ===== */
Game.prototype._eventTick = function (dt) {
  const s = this.s;
  for (const q of s.eventQueue) {
    if (!q.fired && s.t >= q.at) {
      q.fired = true;
      q.endT = s.t + q.durMin;
      s.activeEvents.push(q);
      const pool = EVENT_POOL.find(e => e.id === q.id);
      const target = q.crop ? s.crops[q.crop].name : '全场';
      this._log('event', '【' + (pool ? pool.name : q.id) + '】' + target + ' — ' + (pool ? pool.text : ''), null);
      if (q.crop) { const c = s.crops[q.crop]; c.eventMult *= q.anchorMult; }
      else { for (const cid of CROP_IDS) s.crops[cid].eventMult *= q.anchorMult; }
      if (q.policy) { for (const cid of CROP_IDS) s.crops[cid].policyMult = BAL.policyFeeMult; }
      if (q.subsidy) {
        for (const p of s.players) {
          if (!p.alive) continue;
          const planted = p.plots.filter(pl => pl.crop).length;
          const amt = 250 * planted;
          if (amt > 0) { p.cash += amt; this._log('money', p.name + ' 领到产业补贴 ' + money(amt) + ' G', p.id); }
        }
      }
      // 减产：写入作物当次收成的减产标记，由 _productionTick 读取
      if (q.yieldMult < 1) {
        for (const cid of CROP_IDS) {
          if (!q.crop || q.crop === cid) s.crops[cid].activeYieldMult = q.yieldMult;
        }
      }
    }
    if (q.fired && q.endT && s.t >= q.endT && !q.ended) {
      q.ended = true;
      if (q.crop) { const c = s.crops[q.crop]; c.eventMult = c.eventMult / q.anchorMult || 1; }
      else { for (const cid of CROP_IDS) s.crops[cid].eventMult /= q.anchorMult; }
      if (q.policy) for (const cid of CROP_IDS) s.crops[cid].policyMult = 1;
      if (q.yieldMult < 1) for (const cid of CROP_IDS) s.crops[cid].activeYieldMult = 1;
    }
  }
  s.activeEvents = s.activeEvents.filter(e => !e.ended);
};

/* 价格：瞬时冲击在 _trade 里结算；这里做均值回归、需求注入、阀门与 TWAP */
Game.prototype._priceTick = function (dt) {
  const s = this.s;
  const kPrice = 1 - Math.pow(0.5, dt / (BAL.priceRevertHalfLifeH * 60));
  const kAnchor = 1 - Math.pow(0.5, dt / (BAL.anchorRevertHalfLifeH * 60));
  const kTwap = 1 - Math.pow(0.5, dt / (6 * 60));
  for (const cid of CROP_IDS) {
    const c = s.crops[cid];
    if (c.rumorUntil && s.t >= c.rumorUntil) { c.rumorMult = 1; c.rumorUntil = 0; }
    /* §17.1 收货商：他的胃口按天回满
       （牌子从「收满了，明天再来」变回「今日还收 N 单位」—— 这是玩家能学到的一条规律） */
    if (c.absorbDay && s.t - (c.lastAbsorbT || 0) >= 1440) { c.absorbedToday = 0; c.lastAbsorbT = s.t; }

    const fundamental = c.base * c.eventMult * c.rumorMult;

    // 终端需求注入：把锚慢慢拉高（全场唯一的外部价值来源），并被基本面约束住，不允许无限漂移
    const injPerMin = (c.absorbDay / 1440) / c.float0;
    c.anchor *= (1 + injPerMin * 0.02);
    c.anchor += (fundamental - c.anchor) * kAnchor;
    c.anchor = clamp(c.anchor, fundamental * 0.55, fundamental * 1.70);

    // 随机噪声
    const noise = (this.rng.market.next() - 0.5) * 2 * c.vol * Math.sqrt(dt / 60) * 0.6;
    c.price *= (1 + noise);

    // 均值回归
    c.price += (c.anchor - c.price) * kPrice;

    // 偏离锚越远，回归拉力越强（弹性供给/需求的现实化）
    const dev = c.price / c.anchor - 1;
    if (Math.abs(dev) > 0.20) {
      const pull = clamp(Math.abs(dev) / 0.20, 1, 4);
      c.price += (c.anchor * (1 + Math.sign(dev) * 0.20) - c.price) * 0.02 * pull * (dt / 1);
    }

    // 地板买家 / 进口阀门（docs/03 的对称阀门：把单次价格战的最大伤害锁在 ±30% 内）
    // 关键：阀门是"价格上限/下限"，不是无限供货的自动售货机。
    // 早先版本让阀门每 tick 往对手盘补几十单位货，于是有钱玩家可以无限买入、
    // 每笔都顶出巨大冲击，价格与 NAV 一起飞天（已修）。
    const floorP = c.base * BAL.floorBuyerMult;
    if (c.price < floorP) {
      c.price += (floorP - c.price) * 0.25;
      c.mmInv = Math.min(c.mmInv + c.float0 * 0.03, c.float0 * 2.0);
    }
    const capP = c.base * BAL.importValveMult;
    if (c.price > capP) {
      c.price -= (c.price - capP) * 0.60;
      c.mmInv = Math.min(c.mmInv + c.float0 * 0.05, c.float0 * 2.0);
    }
    // 绝对天花板：再怎么逼仓，外部供给终究会来（保留短暂冲高的爽感）
    const hardCap = c.base * (s.rules.limitDown ? 1.75 : 2.20);
    if (c.price > hardCap) c.price -= (c.price - hardCap) * 0.35;
    if (s.rules.limitDown) c.price = clamp(c.price, c.base * 0.30, c.base * 2.20);
    c.price = Math.max(0.5, c.price);

    c.peak = Math.max(c.peak, c.price);
    c.trough = Math.min(c.trough, c.price);
    // TWAP：估值口径（结算、NAV 用），防止"自己把价格打上去再按现货估身家"
    c.twap += (c.price - c.twap) * kTwap;

    // 泡沫判定：谁把价格顶到基本面上方，并且在破裂前把货跑了
    for (const p of s.players) {
      const arm = p.m.bubbleArm;
      if (arm && arm.crop === cid) {
        arm.peak = Math.max(arm.peak, c.price);
        if (c.price < arm.peak * 0.85) {
          const held = p.storage[cid] || 0;
          if (held <= arm.qty * 0.3) p.m.bubble = Math.max(p.m.bubble || 0, arm.level);
          p.m.bubbleArm = null;
        }
      }
    }

    // 做市商自然补货（持续生产者供货），把库存拉回 float0
    c.mmInv += (c.float0 - c.mmInv) * kAnchor * 0.9;
    c.mmInv = clamp(c.mmInv, -c.float0 * 0.5, c.float0 * 4);

    // 走势采样：每 15 游戏分钟一个点，保留最近 160 点（供 UI 画图）
    if (s.t - (c.lastHistT || -99) >= 15) {
      c.lastHistT = s.t;
      c.hist.push({ t: Math.round(s.t), p: round2(c.price) });
      if (c.hist.length > 160) c.hist.shift();
    }
  }
};

/* 加工品价格：锚不自由浮动，而是跟着"原料的估值价"走。
   原料涨 → 辣酱的基本面就涨，所以制造公司天然需要对冲原料成本。 */
Game.prototype._productTick = function (dt) {
  const s = this.s;
  const kPrice = 1 - Math.pow(0.5, dt / (10 * 60));
  const kTwap = 1 - Math.pow(0.5, dt / (6 * 60));
  const kRegen = 1 - Math.pow(0.5, dt / (12 * 60));
  for (const pid of PRODUCT_IDS) {
    const pd = s.products[pid];
    const crop = s.crops[pd.from];
    const fundamental = (pd.need / pd.out) * crop.twap * (1 + PRODUCT_MARGIN);
    pd.anchor += (fundamental - pd.anchor) * kPrice;
    /* 关键夹子：产品的锚只能落在"原料成本 ±"这个带子里。
       没有它，交易冲击会把锚推高 → NPC 的估值跟着变高 → 他们更愿意买 → 锚再涨，
       实测能把辣酱价格推到 36 万（1e40 级净资产）。作物的锚本来就有这道夹子，产品漏了。 */
    pd.anchor = clamp(pd.anchor, fundamental * 0.65, fundamental * 1.60);
    const noise = (this.rng.market.next() - 0.5) * 2 * pd.vol * Math.sqrt(dt / 60) * 0.6;
    pd.price *= (1 + noise);
    pd.price += (pd.anchor - pd.price) * kPrice;
    pd.price = clamp(pd.price, fundamental * 0.60, fundamental * 1.75);
    pd.price = Math.max(0.5, pd.price);
    pd.twap += (pd.price - pd.twap) * kTwap;
    pd.peak = Math.max(pd.peak, pd.price);
    // 下游消费：把做市商手上的成品慢慢吃掉（这就是产品需求的现金注入）
    const eatPerMin = (pd.absorbDay / Math.max(1, pd.price)) / 1440;
    pd.mmInv = Math.max(0, pd.mmInv - eatPerMin * dt);
    // 生产者持续供货
    pd.mmInv += (pd.mmInv0 - pd.mmInv) * kRegen * 0.9;
    pd.mmInv = clamp(pd.mmInv, 0, pd.mmInvMax);
    if (s.t - (pd.lastHistT || -99) >= 15) {
      pd.lastHistT = s.t;
      pd.hist.push({ t: Math.round(s.t), p: round2(pd.price) });
      if (pd.hist.length > 160) pd.hist.shift();
    }
  }
};

/* 生产：自动收割、腐坏 */
Game.prototype._productionTick = function (dt) {
  const s = this.s;
  for (const p of s.players) {
    if (!p.alive) continue;
    for (let i = 0; i < p.plots.length; i++) {
      const pl = p.plots[i];
      if (!pl.crop) continue;
      if (!pl.ready && s.t >= pl.matureT) {
        pl.ready = true;
        if (pl.auto) { this._harvest(p, i, true); continue; }
      }
      if (!pl.crop || !pl.ready) continue;
      // 腐坏：成熟后长时间不收割
      const rotH = s.crops[pl.crop].rotH;
      if (pl.ready && rotH > 0) {
        const rotAt = pl.matureT + rotH * 60 / Math.max(0.01, p.mods.rotMult);
        if (s.t >= rotAt) {
          const lost = Math.round(s.crops[pl.crop].yld * 0.5 * p.mods.yieldMult);
          this._log('bad', p.name + ' 的' + s.crops[pl.crop].name + '烂在地里了（损失约 ' + lost + ' 单位）', p.id);
          pl.crop = null; pl.plantedT = null; pl.matureT = null; pl.ready = false;
        }
      }
    }
  }
};

/* 挂单撮合：价格穿过即成交 */
Game.prototype._orderTick = function (dt) {
  const s = this.s;
  for (const p of s.players) {
    if (!p.alive || !p.limitOrders.length) continue;
    const rest = [];
    for (const o of p.limitOrders) {
      const good = this.good(o.crop);
      if (!good) { if (o.locked) p.cash += o.locked; this._log('info', p.name + ' 的挂单作废（品种不存在）', p.id); continue; }
      const c = good;
      const crossed = o.side === 'buy' ? (c.price <= o.price) : (c.price >= o.price);
      if (o.expireT && s.t > o.expireT) { p.cash += o.locked || 0; this._log('info', p.name + ' 的挂单过期退回', p.id); continue; }
      if (crossed) {
        // 挂单时冻结的资金要**全额**退回，再让 _trade 收一次；
        // 否则冻结一次 + 成交再扣一次 = 双倍扣款（实测有效成本 2.03 倍）
        if (o.side === 'buy' && o.locked) p.cash += o.locked;
        // 可买量仍受对手盘限制，限价单不能绕过这道闸（原来 isLimit 把检查整个跳过了）
        if (o.side === 'buy' && o.qty > Math.floor(good.mmInv)) { rest.push(o); continue; }
        const r = this._trade(p, o.crop, o.qty, o.side, o.price, true);
        if (r.ok) {
          this._log('trade', p.name + ' 挂单成交：' + (o.side === 'buy' ? '买入' : '卖出') + ' ' + o.qty + ' ' + c.name + ' @' + round2(o.price), p.id);
        } else { rest.push(o); }
      } else rest.push(o);
    }
    p.limitOrders = rest;
  }
};

/* 利息 / 地租 / 存款 / 借货费 —— 全部用现金支付。
   这是"现金流为负"的唯一来源，也是破产机制能真正发生的原因。
   （早先版本让利息直接滚进负债、不动现金，结果谁也破产不了，
     破产→拍卖→收购这条 Demo 必做链路等于死代码。） */
Game.prototype._interestTick = function (dt) {
  const s = this.s;
  const dayFrac = dt / 1440;
  for (const p of s.players) {
    if (!p.alive) continue;
    const interest = p.debt > 0 ? p.debt * this.loanRateOf(p) * dayFrac : 0;
    // 第 1 天不收地租：不给开局缓冲的话，有人在第 1 天就破产，
    // 等于只玩了 2 分钟就出局（docs/06 Q-TIME-11）。
    // 规则变异「地租翻倍」以前只影响种子价与扩地价，对地租本身零影响（审核发现的）
    const rentMult = s.rules.doubleLandRent ? 2 : 1;
    const rent = s.t < 1440 ? 0 : p.plots.length * BAL.plotRentPerDay * rentMult * dayFrac;
    const upkeep = (p.shell.owned > 0 && p.shell.on) ? BAL.shellUpkeepDay * p.shell.owned * dayFrac : 0;
    const due = interest + rent + upkeep;
    if (due > 0) {
      if (p.cash >= due) {
        p.cash -= due;
      } else {
        p.m.pressure = 1;
        const short = due - p.cash;
        p.cash = 0;
        p.debt += short;                     // 付不出的部分转为负债，并记为欠款
        p.arrears = (p.arrears || 0) + short;
        if (!p._warnedArrears) {
          p._warnedArrears = true;
          this._log('bad', '⚠ ' + p.name + ' 付不出这个小时的利息与地租，缺口 ' + money(short) + ' G 滚进负债', p.id);
        }
      }
      p.m.costs = (p.m.costs || 0) + due;
    }
    const depBonus = (CORPS.find(c => c.id === p.corp) || {}).depositRateBonus || 0;
    if (p.deposit > 0) p.deposit *= (1 + (BAL.depositRateDay + depBonus) * dayFrac);
    // 放出去的账到期结算
    if (p.loansOut.length && s.t >= p.loansOut[0].dueT) {
      const ln = p.loansOut.shift();
      const borrower = s.players.find(x => x.id === ln.toPid);
      /* 天赋 f1「债务陷阱」：你放出的贷款周息翻倍 ——
     2026-10-08 审计发现这张卡原先**根本没接线**（mods.loanIncomeMult 只有天赋卡自增，无读取点）。 */
  const due = ln.principal * (1 + ln.rateDay * 2 * (p.mods.loanIncomeMult || 1));
      if (borrower && borrower.alive && borrower.cash >= due * 0.9) {
        borrower.cash -= due;
        borrower.debt = Math.max(0, borrower.debt - due);
        p.cash += due;
        p.m.interestEarned += due - ln.principal;
        this._log('money', p.name + ' 放给 ' + borrower.name + ' 的账到期收回，收息 ' + money(due - ln.principal) + ' G', p.id);
      } else {
        p.m.badDebt += ln.principal;
        this._log('bad', '💀 ' + p.name + ' 放给 ' + (borrower ? borrower.name : '某人') + ' 的 ' + money(ln.principal) + ' G 收不回来了（坏账）', p.id);
      }
    }
    // 借货看跌：借货费 + 被动清盘
    for (const cid in p.shorts) {
      const pos = p.shorts[cid];
      if (!pos || pos.qty <= 0) continue;
      const c = s.crops[cid];
      const bfee = pos.qty * c.price * BAL.shortBorrowFeeDay * dayFrac;
      p.cash -= bfee;
      pos.fee = (pos.fee || 0) + bfee;
      const adverse = (c.price - pos.entry) / pos.entry;
      if (adverse >= BAL.shortLiqMove) {
        this._forceCover(p, cid, '价格反向波动超过 30%，押金耗尽');
      }
    }
  }
};

/* 巨鳄的合并报表（docs/13 §7.2）。
   现阶段只有 1 条持仓且 control = 1，所以等价于旧的单公司口径；
   收购层接上之后，这里会自动变成“控股公司按 control 并表、标的负债并入合并报表”。
   注意 nav() 返回的已经是【净资产】（已扣 p.debt 与空头负债），所以：
     维持线 = nav / debt ≥ maintRatio。无负债（debt = 0）→ 恒不破，这正是“负债 ≠ 破产”。 */
