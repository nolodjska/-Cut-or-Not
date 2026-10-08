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
