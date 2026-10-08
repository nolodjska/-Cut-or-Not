/* ===== part: 05-firm.js ===== */
Game.prototype.consolidated = function (p) {
  const hs = (Array.isArray(p.holdings) && p.holdings.length)
    ? p.holdings.filter(h => !h.bankrupt)
    : [{ corpId: p.corp, control: 1, debt: 0 }];            // 旧存档兼容
  let nav = this.nav(p);                                     // 主控公司走玩家自己的账
  let debt = (p.debt || 0) + this.shortLiability(p);         // 空头负债也是负债（与 debtRatio 同口径）
  for (const h of hs) {
    if (h.corpId === p.corp) continue;                       // 主控公司上面已计
    nav += (h.navSnapshot || 0) * (h.control == null ? 1 : h.control);
    debt += h.debt || 0;                                     // 收购来的公司：负债一并并表
  }
  return { nav, debt };
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
