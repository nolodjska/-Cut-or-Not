/* ===== part: 12-bank-auction.js ===== */
function viewBank() {
  const s = G.s;
  const limit = G.creditLimit(HUMAN);
  const rent = HUMAN.plots.length * GG.BAL.plotRentPerDay;
  const invV = G.inventoryValue(HUMAN), fixed = G.fixedAssets(HUMAN), shortL = G.shortLiability(HUMAN);
  return `
    <div class="card">
      <div class="ct"><h3>账目</h3><span class="sub">净资产 = 现金 + 库存×95% + 固定资产×80% − 欠款</span></div>
      <div class="line"><span class="k">现金</span><span class="v mono">${fmt(HUMAN.cash)}</span></div>
      <div class="line"><span class="k">库存（按估值价）</span><span class="v mono">${fmt(invV)}</span></div>
      <div class="line"><span class="k">固定资产（地/自动化/仓储）</span><span class="v mono">${fmt(fixed)}</span></div>
      <div class="line"><span class="k">欠款（含看跌负债）</span><span class="v mono down">${fmt(HUMAN.debt + shortL)}</span></div>
      <div class="line"><span class="k">净资产</span><span class="v mono gold">${fmt(G.nav(HUMAN))}</span></div>
      <div class="line"><span class="k">负债率</span><span class="v mono ${G.debtRatio(HUMAN) > 0.5 ? 'down' : ''}">${(G.debtRatio(HUMAN) * 100).toFixed(0)}%</span></div>
    </div>

    <div class="card">
      <div class="ct"><h3>钱庄</h3><span class="sub">日息 ${(G.loanRateOf(HUMAN) * 100).toFixed(2)}%</span></div>
      <div class="line"><span class="k">还能借</span><span class="v mono">${fmt(limit)}</span></div>
      <div class="qty" style="margin-top:8px">
        <input type="number" inputmode="numeric" id="loanAmt" value="${Math.floor(limit)}">
        <button class="btn p" data-loan="1">借这笔</button>
        <button class="btn" data-repay="1">还全部</button>
      </div>
      <div class="hint">借来的钱每天都要付利息，利息用现金结。付不出就先滚成欠款 —— <b>但欠多少本身不会让你出局</b>。
        只有两种情况会有人上门催债：<b>手里的家底不够还账了</b>，或者<b>现金变成了负数</b>。
        催债之后 ${GG.BAL.graceHours} 小时内没补上，地、货、公司一起上拍卖台。</div>
      <div class="line"><span class="k">每天固定支出</span><span class="v mono">约 ${fmt(rent + HUMAN.debt * G.loanRateOf(HUMAN))} G</span></div>
    </div>

    <div class="card">
      <div class="ct"><h3>存钱</h3><span class="sub">日息 ${((GG.BAL.depositRateDay + ((GG.CORPS.find(c => c.id === HUMAN.corp) || {}).depositRateBonus || 0)) * 100).toFixed(1)}%</span></div>
      <div class="qty">
        <input type="number" inputmode="numeric" id="depAmt" value="${Math.floor(HUMAN.cash)}">
        <button class="btn" data-deposit="1">存</button>
        <button class="btn" data-withdraw="1">取全部（${fmt(HUMAN.deposit)}）</button>
      </div>
      <div class="hint">存款不参与交易，也不会被强制变卖 —— 留着当"保命钱"。</div>
    </div>

    ${(GG.CORPS.find(c => c.id === HUMAN.corp) || {}).canLend ? `
    <div class="card">
      <div class="ct"><h3>借钱给人</h3><span class="sub">日息 ${(4 * (HUMAN.mods.loanIncomeMult || 1)).toFixed(0)}%，两天后到期</span></div>
      <div class="hint">把钱借给对手，两天后收回本息。对方要是倒了，这笔就收不回来了 —— 借给谁是你的判断。</div>
      ${G.s.players.filter(x => !x.isHuman && x.alive).map(x => `
        <div class="line">
          <span class="k">${esc(x.name)} · ${esc(x.corpName)}<br>
            <span style="font-size:10px">现金 ${fmt(x.cash)} · 负债率 ${(G.debtRatio(x) * 100).toFixed(0)}%</span></span>
          <span><input type="number" inputmode="numeric" id="lend_${x.id}" value="1000"
              style="width:74px;background:#0d131a;border:1px solid var(--line);border-radius:7px;color:inherit;padding:5px 7px;font-family:inherit">
          <button class="btn sm gold" data-lend="${x.id}" style="margin-left:4px">借给他</button></span>
        </div>`).join('')}
      ${HUMAN.loansOut.length ? `<div class="hint">未收回：${HUMAN.loansOut.map(l => {
        const t = G.s.players.find(z => z.id === l.toPid);
        return esc(t ? t.name : '?') + ' ' + fmt(l.principal) + 'G（' + Math.max(0, (l.dueT - G.s.t) / 60).toFixed(1) + ' 小时后到期）';
      }).join('；')}</div>` : ''}
      ${HUMAN.m.interestEarned || HUMAN.m.badDebt ? `<div class="line"><span class="k">已收利息 / 收不回来的</span>
        <span class="v mono"><span class="up">${fmt(HUMAN.m.interestEarned)}</span> / <span class="down">${fmt(HUMAN.m.badDebt)}</span></span></div>` : ''}
    </div>` : ''}

    <div class="card">
      <div class="ct"><h3>皮包公司</h3><span class="sub">隐身、隔离、代持</span></div>
      ${HUMAN.shell.owned ? `
        <div class="line"><span class="k">隐蔽度</span><span class="v mono">${Math.round(HUMAN.shell.cover)} / 100</span></div>
        <div class="bar" style="height:6px;background:#0d131a;border-radius:3px;overflow:hidden;margin:6px 0">
          <i style="display:block;height:100%;width:${HUMAN.shell.cover}%;background:linear-gradient(90deg,#a97bff,#4aa8ff)"></i></div>
        <div class="line"><span class="k">通道状态</span><span class="v">${HUMAN.shell.on ? '<span class="up">开启（交易挂在它名下）</span>' : '关闭'}</span></div>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn" data-shell="cover">加厚隐蔽度</button>
          <button class="btn" data-shell="toggle">${HUMAN.shell.on ? '关闭通道' : '开启通道'}</button>
        </div>
        <div class="hint">隐蔽度越高越难被识破；被识破会挨罚。有了它，你的动作不容易被算到你头上 ——
          结算时有一条称号叫"隐形操盘手"。</div>
      ` : `
        <div class="hint">一个查不到负责人的壳，用来隐藏你的动作。注册费 ${GG.BAL.shellCost} G，每天维护 ${GG.BAL.shellUpkeepDay} G。</div>
        <div class="btnrow" style="margin-top:8px">
          <button class="btn gold" data-shell="new" ${HUMAN.cash < GG.BAL.shellCost ? 'disabled' : ''}>注册一间（${GG.BAL.shellCost}G）</button>
        </div>`}
    </div>`;
}

/* ---------- 视图：拍卖 ---------- */
function viewAuction() {
  const s = G.s, a = s.auction;
  if (!a) {
    const nexts = [
      { d: 2, h: 6 }, { d: 3, h: 6 },
    ].filter(x => s.t < ((x.d - 1) * 24 + x.h) * 60);
    const nx = nexts[0];
    /* 倒计时必须换算成“人话”。
       修的是 2026-10-08 试玩反馈：这里原来直接印 `1222 游戏分钟后`，
       而同一份文件里种子卡写「2 小时（约 16 秒）」—— 同一屏两种口径，
       玩家没法判断“要不要等”。统一成「先给游戏小时，再括号补真实时长」：
       先给游戏小时，再括号补真实时长。 */
    let when = '本局拍卖已经全部结束了。';
    if (nx) {
      const leftMin = ((nx.d - 1) * 24 + nx.h) * 60 - s.t;
      const real = G.realSecLeft(leftMin);
      when = '下一场在第 ' + nx.d + ' 天 ' + nx.h + ':00，大约 ' + (leftMin / 60).toFixed(1) +
        ' 游戏小时后（约 ' + (real < 120 ? Math.round(real) + ' 秒' : (real / 60).toFixed(1) + ' 分钟') + '）。';
    }
    return `<div class="empty">现在没有拍卖会。<br>
      ${when}<br><br>
      拍卖是唯一能一次拿到"规则级优势"的地方：<br>免税凭证、独家出口权、高产地契、绝密情报、债务包。</div>`;
  }
  const end = a.phase === 'sealed' ? a.sealedEndT : a.openEndT;
  const leftTxt = secLeftTxt(end - s.t);
  const mySealed = a.entries.find(e => e.pid === s.humanId);
  const isFinalist = (a.finalists || []).includes(s.humanId);
  const leader = a.high ? G._pidName(a.high.pid) : '—';
  return `
    <div class="card">
      <div class="ct"><h3>🔨 ${esc(a.lot.name)}</h3><span class="sub">${a.phase === 'sealed' ? '暗标阶段' : a.phase === 'open' ? '明标阶段' : '已结束'}</span></div>
      <div class="hint">${esc(a.lot.desc)}</div>
      <div class="line" style="margin-top:6px"><span class="k">这个标的的估值</span><span class="v mono">约 ${fmt(a.lot.value)} G</span></div>
      <div class="line"><span class="k">本阶段剩余</span><span class="v mono gold">${leftTxt}</span></div>
      ${a.phase === 'open' ? `<div class="line"><span class="k">当前领先</span><span class="v">${esc(leader)} @ ${fmt(a.high ? a.high.amount : 0)} G</span></div>
        <div class="line"><span class="k">最低出价</span><span class="v mono gold">${fmt(a.nextBid || a.startPrice)} G</span></div>` : ''}
      ${a.phase === 'done' ? `<div class="line"><span class="k">结果</span><span class="v gold">${esc(a.result || '')}</span></div>` : ''}
      ${a.softCount ? `<div class="banner">有人卡着最后一秒出价，拍卖被延时了 ${a.softCount} 次。</div>` : ''}

      ${a.phase === 'sealed' ? `
        <div class="hint" style="margin:8px 0 6px">暗标：别人看不到你的数字。投得越高越容易进前几名入围明标，
          但你也会亲手把起拍价抬起来。${mySealed ? '<b class="gold">你已投 ' + fmt(mySealed.amount) + ' G（可以改）</b>' : ''}</div>
        <div class="qty"><input type="number" inputmode="numeric" id="bidAmt" value="${Math.floor(Math.min(HUMAN.cash * 0.5, a.lot.value * 0.9))}">
          <button class="btn p" data-bid="sealed">投暗标</button></div>
      ` : ''}
      ${a.phase === 'open' ? `
        <div class="hint" style="margin:8px 0 6px">${isFinalist ? '<b class="up">你入围了，可以出价。</b>' : '你没进明标名单 —— 暗标投得太低了，只能看着。'}</div>
        <div class="qty"><input type="number" inputmode="numeric" id="bidAmt" value="${a.nextBid || a.startPrice}">
          <button class="btn p" data-bid="open" ${isFinalist ? '' : 'disabled'}>出价</button></div>
      ` : ''}
      ${a.history && a.history.length ? '<div class="hint">出价记录：' +
        a.history.slice(-6).map(h => G._pidName(h.pid) + ' ' + fmt(h.amount)).join(' → ') + '</div>' : ''}
      <div class="hint">押金 = 出价的 ${GG.BAL.bidDepositRate * 100}%，悔拍会被没收。拍卖行抽成 ${GG.BAL.auctionFee * 100}%。</div>
    </div>`;
}

/* ---------- 视图：结算 ---------- */
