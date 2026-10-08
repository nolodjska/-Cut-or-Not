/* 无头模拟验证器
 * 用法：node tools/sim.cjs [局数] [secPerGameHour]
 * 目标：
 *   1) 不变量：无 NaN / 价格 > 0 / 库存 ≥ 0 / NAV 有限 / 存档可往返
 *   2) 平衡性：四条路径 3 天后的 NAV 倍数、垄断达成率、破产率
 *   3) 只通过公开 API（act / advanceReal）驱动，证明 API 完备
 */
const GG = require('../game/engine.js');

const N = parseInt(process.argv[2] || '60', 10);
const SPH = parseFloat(process.argv[3] || '8');
const TOTAL_REAL = 3 * 24 * SPH;          // 3 游戏天 = 3*24 游戏小时
const STEP = 1;                            // 每秒一帧

/* ---------------- 不变量检查 ---------------- */
function checkInvariants(g, tag, errs) {
  const s = g.s;
  const bad = (m) => { if (errs.length < 40) errs.push(tag + ': ' + m); };
  if (!isFinite(s.t)) bad('t 非有限');
  for (const cid of GG.CROP_IDS) {
    const c = s.crops[cid];
    if (!isFinite(c.price) || !isFinite(c.anchor) || !isFinite(c.mmInv)) bad(cid + ' 价格/锚/库存非有限');
    if (c.price <= 0) bad(cid + ' 价格 ≤ 0 (' + c.price + ')');
    if (c.anchor <= 0) bad(cid + ' 锚 ≤ 0');
  }
  for (const p of s.players) {
    for (const k of ['cash', 'debt', 'deposit', 'realized', 'cp', 'level']) {
      if (!isFinite(p[k])) bad(p.name + '.' + k + ' 非有限 (' + p[k] + ')');
    }
    if (this === undefined) {}
    for (const cid in p.storage) {
      if (!isFinite(p.storage[cid]) || p.storage[cid] < -0.001) bad(p.name + ' 库存 ' + cid + ' = ' + p.storage[cid]);
    }
    for (const cid in p.shorts) {
      const pos = p.shorts[cid];
      if (!isFinite(pos.qty) || pos.qty < -0.001) bad(p.name + ' 看跌仓位 ' + cid + ' = ' + pos.qty);
      if (!isFinite(pos.margin) || pos.margin < -0.001) bad(p.name + ' 押金 ' + cid + ' = ' + pos.margin);
    }
    const nav = g.nav(p);
    if (!isFinite(nav)) bad(p.name + ' NAV 非有限');
  }
  for (const p of s.players) { for (const pl of p.plots) { if (!isFinite(pl.matureT || 0)) bad(p.name + ' matureT 非有限'); } }
  return errs;
}

/* ---------------- 策略（只用公开 API） ---------------- */
const strategies = {
  // 只种地、不参与斗争的放置玩家：每天上线 2 次
  farmer(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    g.act(pid, 'harvestAll');
    // 有闲钱先扩地、自动化
    if (p.cash > 4000 && p.plots.length < 6) g.act(pid, 'expand');
    if (p.cash > 6500) { const i = p.plots.findIndex(pl => !pl.auto); if (i >= 0) g.act(pid, 'buyAuto', { index: i }); }
    g.act(pid, 'plantAll', { crop: 'chili' });
    // 卖货：价格高于基准就卖
    for (const cid of GG.CROP_IDS) {
      const held = p.storage[cid] || 0;
      if (held > 0 && g.s.crops[cid].price >= g.s.crops[cid].base * 0.98) g.act(pid, 'sell', { crop: cid, qty: held });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 纯贸易：不种地，低吸高抛，适度借贷
  trader(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      const held = p.storage[cid] || 0;
      if (c.price < c.anchor * 0.85 && p.cash > 800) {
        const budget = Math.min(p.cash * 0.5, 2500);
        g.act(pid, 'buy', { crop: cid, qty: Math.floor(budget / c.price) });
      } else if (held > 0 && c.price > c.anchor * 1.14) {
        g.act(pid, 'sell', { crop: cid, qty: held });
      }
    }
    if (p.cash < 900 && g.creditLimit(p) > 200) g.act(pid, 'loan', { amount: Math.floor(g.creditLimit(p)) });
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 情报玩家：靠卖消息赚钱 + 小规模交易
  intel(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    if (p.cash > 600) g.act(pid, 'intel', { tier: 'insider' });
    g.act(pid, 'sellIntel');
    const known = p.m.intelKnown.filter(k => !k.sold && k.dir === '涨');
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      const held = p.storage[cid] || 0;
      const bullish = known.some(k => k.crop === cid);
      if (bullish && p.cash > 1200) g.act(pid, 'buy', { crop: cid, qty: Math.floor(Math.min(p.cash * 0.3, 1200) / c.price) });
      if (held > 0 && c.price > c.anchor * 1.05) g.act(pid, 'sell', { crop: cid, qty: held });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 垄断者：只囤辣椒，借钱扫货，绝不卖
  monopolist(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    const cid = 'chili', c = g.s.crops[cid];
    g.act(pid, 'harvestAll');
    g.act(pid, 'plantAll', { crop: cid });
    // 尽量借钱（额度由引擎的成本法授信封顶）
    if (g.creditLimit(p) > 200) g.act(pid, 'loan', { amount: Math.floor(g.creditLimit(p)) });
    // 扫货
    if (p.cash > 600 && c.mmInv > 0 && c.price < c.base * 2.2) {
      const qty = Math.min(Math.floor(p.cash * 0.9 / c.price), Math.floor(c.mmInv));
      if (qty > 0) g.act(pid, 'buy', { crop: cid, qty });
    }
    if (p.cash > 5000) g.act(pid, 'expand');
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 隐身操盘：皮包公司 + 低吸高抛
  shell(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    if (p.shell.owned === 0 && p.cash > 5000) g.act(pid, 'shell', {});
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      const held = p.storage[cid] || 0;
      if (c.price < c.anchor * 0.94 && p.cash > 900) g.act(pid, 'buy', { crop: cid, qty: Math.floor(Math.min(p.cash * 0.4, 2000) / c.price) });
      else if (held > 0 && c.price > c.anchor * 1.06) g.act(pid, 'sell', { crop: cid, qty: held });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 熟练操盘手：只在阀门边缘出手（贴地板买、贴天花板卖），并适度用杠杆
  sniper(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    g.act(pid, 'harvestAll');
    g.act(pid, 'plantAll', { crop: 'chili' });
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      const held = p.storage[cid] || 0;
      const buyAt = c.base * 0.84, sellAt = c.base * 1.30;   // 熟练操盘手贴着阀门出手
      if (c.price <= buyAt && c.mmInv > 3) {
        const budget = Math.min(p.cash * 0.95, 6000);
        const qty = Math.min(Math.floor(budget / c.price), Math.floor(c.mmInv));
        if (qty > 0) g.act(pid, 'buy', { crop: cid, qty });
      } else if (held > 0 && c.price >= sellAt) {
        g.act(pid, 'sell', { crop: cid, qty: held });
      }
    }
    if (p.cash < 2500) g.act(pid, 'loan', { amount: Math.floor(g.creditLimit(p)) });
    if (p.debt > 0 && p.cash > p.debt * 1.4) g.act(pid, 'repay', { amount: Math.floor(p.debt) });
    if (p.cash > 5000 && p.plots.length < 6) g.act(pid, 'expand');
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 莽夫：能借就借、见货就买、从不卖出 —— 用来检验破产→拍卖→收购这条必做链路
  bust(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    if (g.creditLimit(p) > 100) g.act(pid, 'loan', { amount: Math.floor(g.creditLimit(p)) });
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      if (p.cash > c.price * 4 && c.mmInv > 3) {
        const qty = Math.min(Math.floor(p.cash * 0.9 / c.price), Math.floor(c.mmInv));
        if (qty > 0) g.act(pid, 'buy', { crop: cid, qty });
      }
    }
    if (p.cash > 3000) {
      const i = p.plots.findIndex(pl => pl.upgraded);
      if (i >= 0) { /* 已经升级过就算了 */ }
      g.act(pid, 'expand');
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 全能遍历：把引擎里每个动作都点一遍（限价单、扩地、升级、拍卖出价、借货、舆论、皮包）
  allround(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    const t = g.s.t;
    g.act(pid, 'harvestAll');
    g.act(pid, 'plantAll', { crop: 'radish' });
    // 拍卖必须每帧盯（暗标窗口只有 1.5 游戏小时，被节流就错过）
    const auc = g.s.auction;
    if (auc && auc.phase === 'sealed' && !auc._myBid && p.cash > 1200) {
      auc._myBid = 1;
      const r = g.act(pid, 'bid', { amount: Math.floor(Math.min(p.cash * 0.5, auc.lot.value)) });
      void r;
    }
    if (auc && auc.phase === 'open' && auc.finalists.includes(pid) && p.cash > 1200) {
      const next = auc.nextBid || Math.ceil((auc.high ? auc.high.amount : auc.startPrice) + auc.minIncrement);
      if (next < p.cash * 0.6 && next < auc.lot.value * 1.6 && auc._myOpenAt !== next) {
        auc._myOpenAt = next;
        g.act(pid, 'bid', { amount: next });
      }
    }
    // 每 3 游戏小时动一次，避免刷屏
    if (t - (p._lastAll || -1e9) < 180) return;
    p._lastAll = t;

    if (p.plots.length < 5) g.act(pid, 'expand');
    if (p.plots[0] && !p.plots[0].upgraded) g.act(pid, 'upgradePlot', { index: 0 });
    if (p.plots[1] && !p.plots[1].auto) g.act(pid, 'buyAuto', { index: 1 });
    if (p.storageCap < 400) g.act(pid, 'upgradeStorage');
    if (g.creditLimit(p) > 400) g.act(pid, 'loan', { amount: 800 });
    if (p.debt > 0) g.act(pid, 'repay', { amount: 200 });
    if (p.shell.owned === 0 && p.cash > 3000) g.act(pid, 'shell', {});
    g.act(pid, 'shellToggle', { on: !p.shell.on });
    if (p.cash > 1500) g.act(pid, 'intel', { tier: 'insider' });
    g.act(pid, 'sellIntel');
    if (p.cash > 1200) g.act(pid, 'rumor', { crop: 'chili', dir: 'up' });
    // 限价单：挂一个远低于市价的买单（会一直挂着，顺便验证撤单）
    const c = g.s.crops.radish;
    if (p.limitOrders.length === 0 && p.cash > 1500) {
      g.act(pid, 'limit', { crop: 'radish', side: 'buy', qty: 10, price: +(c.price * 0.75).toFixed(2) });
    } else if (p.limitOrders.length > 0 && p.cash < 1000) {
      g.act(pid, 'cancelOrder', { id: p.limitOrders[0].id });
    }
    // 现货买卖
    const chili = g.s.crops.chili;
    if (chili.price < chili.base * 0.9 && p.cash > 900) g.act(pid, 'buy', { crop: 'chili', qty: 15 });
    else if ((p.storage.chili || 0) > 0) g.act(pid, 'sell', { crop: 'chili', qty: p.storage.chili });
    // 借货看跌 + 平仓
    if (p.cash > 5000 && chili.price > chili.base * 1.15 && !p.shorts.chili) {
      g.act(pid, 'short', { crop: 'chili', qty: 8 });
    } else if (p.shorts.chili && chili.price < chili.base * 1.0) {
      g.act(pid, 'cover', { crop: 'chili' });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 制造流：种辣椒 → 加工成辣酱 → 卖成品（验证产业链）
  maker(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    g.act(pid, 'harvestAll');
    g.act(pid, 'plantAll', { crop: 'chili' });
    if (p.cash > 3000 && p.workshops < 3) g.act(pid, 'buildWorkshop');
    if (p.cash > 4000 && p.plots.length < 8) g.act(pid, 'expand');       // 制造必须自己扩产原料
    if (p.cash > 2500) { const i = p.plots.findIndex(pl => !pl.auto); if (i >= 0) g.act(pid, 'buyAuto', { index: i }); }
    if (p.workshops > p.craftJobs.length) {
      const r = g.act(pid, 'craft', { product: 'sauce' }, true);
      if (!r.ok) {  // 原料不够就去市场补货（买比自己种更贵，但能把产能喂饱）
        const need = g.s.products.sauce.need - (p.storage.chili || 0);
        if (need > 0 && p.cash > 1500) g.act(pid, 'buy', { crop: 'chili', qty: need });
        g.act(pid, 'craft', { product: 'sauce' }, true);
      }
    }
    // 卖成品优先，其次卖原料
    for (const id of GG.PRODUCT_IDS) {
      const held = p.storage[id] || 0;
      if (held > 0 && g.s.products[id].price >= g.s.products[id].anchor * 0.98) g.act(pid, 'sell', { crop: id, qty: held });
    }
    for (const cid of GG.CROP_IDS) {
      const held = p.storage[cid] || 0;
      if (held > 40 && g.s.crops[cid].price >= g.s.crops[cid].base) g.act(pid, 'sell', { crop: cid, qty: Math.floor(held * 0.5) });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 放贷流：低息借钱 → 放给别人收息 → 顺手低吸高抛
  banker(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    if (g.creditLimit(p) > 500) g.act(pid, 'loan', { amount: Math.floor(g.creditLimit(p)) });
    if (p.loansOut.length < 3 && p.cash > 4000) {
      // 分散 + 只借给负债率低、现金正常的对手（借给快倒的人就是坏账）
      const safe = g.s.players.filter(x => !x.isHuman && x.alive && g.debtRatio(x) < 0.35 &&
        !p.loansOut.some(l => l.toPid === x.id)).sort((a, b) => g.debtRatio(a) - g.debtRatio(b));
      const target = safe[0];
      if (target) g.act(pid, 'lend', { pid: target.id, amount: Math.floor(Math.min(p.cash * 0.15, 1500)) });
    }
    for (const cid of GG.CROP_IDS) {
      const c = g.s.crops[cid];
      const held = p.storage[cid] || 0;
      if (c.price < c.anchor * 0.92 && p.cash > 1500) g.act(pid, 'buy', { crop: cid, qty: Math.floor(Math.min(p.cash * 0.5, 3000) / c.price) });
      else if (held > 0 && c.price > c.anchor * 1.08) g.act(pid, 'sell', { crop: cid, qty: held });
    }
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },

  // 打手：砸盘、放消息、看跌，用来验证"搅局者/收割机"提名会不会被触发
  raider(g, pid) {
    const p = g.s.players.find(x => x.id === pid);
    if (!p.alive) return;
    g.act(pid, 'harvestAll');
    g.act(pid, 'plantAll', { crop: 'chili' });
    const cid = 'chili', c = g.s.crops[cid];
    const held = p.storage[cid] || 0;
    if (held > 15) g.act(pid, 'sell', { crop: cid, qty: held });       // 大额抛售砸盘
    if (p.cash > 800) g.act(pid, 'rumor', { crop: cid, dir: 'down' });
    if (p.cash > 4000 && c.price > c.base * 1.1) g.act(pid, 'short', { crop: cid, qty: Math.floor(Math.min(p.cash * 0.2, 1500) / c.price) });
    for (const k in p.shorts) if (c.price < c.anchor * 0.95) g.act(pid, 'cover', { crop: k });
    if (p.talentOffers) g.act(pid, 'talent', { id: p.talentOffers[0] });
  },
};

/* ---------------- 单局运行 ---------------- */
function runGame(seed, stratName) {
  const g = new GG.Game({ seed, corp: ({ monopolist:'trade', intel:'intel', shell:'shell', farmer:'grow', maker:'make', banker:'fin', sniper:'trade', trader:'trade', bust:'trade', allround:'trade', raider:'trade' })[stratName] || 'trade', npcs: 3, secPerGameHour: SPH });
  const pid = g.s.humanId;
  const errs = [];
  let frames = 0;
  while (!g.s.over && frames < TOTAL_REAL + 10) {
    g.advanceReal(STEP);
    frames += STEP;
    if (frames % 5 === 0) strategies[stratName](g, pid);
    if (frames % 17 === 0) checkInvariants(g, seed, errs);
    if (errs.length) break;
  }
  // 结算是引擎自动跑的；防御：如果没跑（例如提前 over 而没算），强制算一次
  const st = g.s.settlement || g.settle();
  const me = st.rows.find(r => r.id === pid);
  const human = g.s.players.find(p => p.id === pid);
  return {
    seed, strat: stratName, over: g.s.over, reason: g.s.overReason, frames,
    nav: me ? me.nav : NaN, ratio: me ? me.ratio : NaN, alive: me ? me.alive : false,
    mono: me ? me.monoProx : NaN, debtRatio: me ? me.debtRatio : NaN,
    nomin: st.nominations.filter(n => n.pid === pid).map(n => n.title),
    allNomin: st.nominations.map(n => n.title),
    bankrupt: !me ? false : !me.alive,
    chief: st.chief.name === human.name ? st.chief.title : null,
    errs,
    priceEnd: GG.CROP_IDS.map(c => +g.s.crops[c].price.toFixed(2)),
    logTail: g.s.feed.slice(-3).map(f => f.text),
    auctionWins: human ? human.m.auctionWins : 0,
    totalLots: g.s.players.reduce((a, q) => a + q.m.auctionWins, 0),
    auctionsHeld: g.s.auctionCount,
    acts: human ? Object.keys(human.m.cropTraded).length : 0,
    limitOrdersLeft: human ? human.limitOrders.length : 0,
  };
}

/* ---------------- 跑 ---------------- */
console.log('=== 《割不割》无头模拟：' + N + ' 局 × 6 策略，secPerGameHour=' + SPH + '（单局真实 ' + (TOTAL_REAL) + ' 秒） ===\n');
const results = [];
const allErrs = [];
for (const strat of Object.keys(strategies)) {
  for (let i = 0; i < N; i++) {
    const seed = 'GG-TEST' + String(i).padStart(3, '0') + strat.slice(0, 2).toUpperCase();
    let r;
    try { r = runGame(seed, strat); }
    catch (e) { r = { seed, strat, errs: ['抛异常: ' + e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n')], nav: NaN, ratio: NaN }; }
    results.push(r);
    if (r.errs && r.errs.length) allErrs.push(...r.errs);
  }
}

/* 汇总 */
const byStrat = {};
for (const r of results) {
  const b = byStrat[r.strat] || (byStrat[r.strat] = { n: 0, ratios: [], mono: 0, chief: 0, dead: 0, noms: {}, errs: 0, reasons: {} });
  b.n++;
  if (isFinite(r.ratio)) b.ratios.push(r.ratio);
  if (r.mono >= 1) b.mono++;
  if (r.chief) b.chief++;
  if (!r.alive) b.dead++;
  for (const t of (r.nomin || [])) b.noms[t] = (b.noms[t] || 0) + 1;
  b.reasons[r.reason] = (b.reasons[r.reason] || 0) + 1;
  if (r.errs && r.errs.length) b.errs++;
}
const pct = (a, b) => b ? ((a / b) * 100).toFixed(0) + '%' : '-';
const mean = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : NaN;
const med = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('策略'.padEnd(12) + 'NAV倍数中位  NAV倍数均值  最高  ≥2.0×率  ≥2.5×率  垄断  首席  出局  异常');
console.log('-'.repeat(99));
for (const k of Object.keys(byStrat)) {
  const b = byStrat[k];
  const ge20 = b.ratios.filter(r => r >= 2.0).length;
  const ge25 = b.ratios.filter(r => r >= 2.5).length;
  console.log(
    k.padEnd(14) +
    (med(b.ratios)).toFixed(2).padStart(10) +
    mean(b.ratios).toFixed(2).padStart(12) +
    Math.max(0, ...b.ratios).toFixed(2).padStart(6) +
    pct(ge20, b.n).padStart(10) +
    pct(ge25, b.n).padStart(9) +
    pct(b.mono, b.n).padStart(7) +
    pct(b.chief, b.n).padStart(6) +
    pct(b.dead, b.n).padStart(6) +
    String(b.errs).padStart(6)
  );
}
console.log('\n末局价格（相对基准）：');
const last = results[results.length - 1];
if (last && last.priceEnd) console.log('  ', GG.CROP_IDS.map((c, i) => c + ' ' + last.priceEnd[i]).join('  '));

// 提名覆盖率
const allNoms = {};
for (const r of results) for (const t of (r.allNomin || [])) allNoms[t] = (allNoms[t] || 0) + 1;
console.log('\n提名触发次数（' + results.length + ' 局）：');
const nomKeys = Object.keys(allNoms).sort((a, b) => allNoms[b] - allNoms[a]);
for (const k of nomKeys) console.log('  ' + k.padEnd(14) + allNoms[k]);
const neverFired = ['市场搅局者', '经济命运共同体', '隐形操盘手', '泡沫制造机', '最悲情退场者', '定海神针', '最佳线报商', '产业链之王', '价差收割机', '城市奠基人'].filter(t => !allNoms[t]);
console.log('  从未触发：' + (neverFired.length ? neverFired.join('、') : '（全部至少触发过一次）'));

// 种子可复现性
const a = runGame('GG-REPRODUCE01', 'trader');
const b = runGame('GG-REPRODUCE01', 'trader');
const repro = JSON.stringify(a) === JSON.stringify(b);
console.log('\n种子可复现（同种子同策略逐位相同）：' + (repro ? '✅ 通过' : '❌ 失败'));

// 存档往返
const g1 = new GG.Game({ seed: 'GG-SAVE0001', corp: 'grow', npcs: 2, secPerGameHour: SPH });
for (let i = 0; i < 60; i++) { g1.advanceReal(1); if (i % 5 === 0) strategies.farmer(g1, g1.s.humanId); }
const snap = JSON.stringify(g1.s);
const g2 = new GG.Game({ seed: 'GG-SAVE0001', secPerGameHour: SPH });
g2.s = JSON.parse(snap);
g2._buildRngs();
const p1 = g1.s.players[0].cash, p2 = g2.s.players[0].cash;
for (let i = 0; i < 200; i++) { g1.advanceReal(1); g2.advanceReal(1); }
const saveOk = Math.abs(g1.s.players[0].cash - g2.s.players[0].cash) < 1e-6 && g1.s.t === g2.s.t;
console.log('存档往返（读档后继续跑 200 秒结果一致）：' + (saveOk ? '✅ 通过' : '❌ 失败  离线=' + g1.s.players[0].cash + ' 读档=' + g2.s.players[0].cash));
void p1; void p2;

/* 功能覆盖诊断：确认那些"必做但难触发"的动作真的跑通过 */
const ar = results.filter(r => r.strat === 'allround');
if (ar.length) {
  const held = ar.reduce((a, r) => a + (r.auctionsHeld || 0), 0);
  const won = ar.reduce((a, r) => a + (r.auctionWins || 0), 0);
  const allLots = ar.reduce((a, r) => a + (r.totalLots || 0), 0);
  console.log('\n功能覆盖（allround 策略 ' + ar.length + ' 局）：');
  console.log('  拍卖举办 ' + held + ' 场；全场共成交 ' + allLots + ' 件标的（其中玩家本人 ' + won + ' 件）');
  console.log('  拍到东西的局数 ' + ar.filter(r => (r.auctionWins || 0) > 0).length + ' / ' + ar.length);
  console.log('  触发破产（出局）的局数 ' + results.filter(r => !r.alive).length + ' / ' + results.length);
  const sample = results.filter(r => !r.alive)[0] || results[0];
  console.log('  出局样例的最后几条日志：');
  for (const l of (sample.logTail || [])) console.log('    · ' + l);
}

console.log('\n不变量异常：' + (allErrs.length ? '❌ ' + allErrs.length + ' 条' : '✅ 无'));
for (const e of allErrs.slice(0, 12)) console.log('  ' + e);

/* 异常明细（策略级） */
const thrown = results.filter(r => r.errs && r.errs.length && String(r.errs[0]).startsWith('抛异常'));
if (thrown.length) {
  console.log('\n抛异常的局：' + thrown.length + ' / ' + results.length);
  const seen = new Set();
  for (const t of thrown) {
    const key = String(t.errs[0]).split('\n')[0].slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('  [' + t.strat + '] ' + key);
    console.log('    ' + String(t.errs[0]).split('\n').slice(1).join('\n    '));
  }
}
/* 校验失败明细 */
const failed = results.filter(r => r.errs && r.errs.length && !String(r.errs[0]).startsWith('抛异常'));
if (failed.length) {
  console.log('\n不变量校验失败的局：' + failed.length);
  const seen = new Set();
  for (const t of failed) {
    const key = String(t.errs[0]).slice(0, 140);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log('  [' + t.strat + '] ' + key);
  }
}

/* 定向验证：给玩家充足资金，确认"参与拍卖并真的拍到手"对玩家本人也通 */
{
  const g2 = new GG.Game({ seed: 'GG-AUCTION-WIN', corp: 'trade', npcs: 3, secPerGameHour: SPH });
  const pid2 = g2.s.humanId;
  g2.s.players.find(p => p.id === pid2).cash = 40000;
  let sealed = false;
  for (let i = 0; i < 1200 && !g2.s.over; i++) {
    g2.advanceReal(1);
    const a = g2.s.auction;
    if (!a) continue;
    if (a.phase === 'sealed' && !sealed) {
      sealed = true;
      g2.act(pid2, 'bid', { amount: Math.floor(a.lot.value * 1.2) });
    }
    if (a.phase === 'open' && a.finalists.includes(pid2) && a.nextBid && a.nextBid < 30000 && a._lastBid !== a.nextBid) {
      a._lastBid = a.nextBid;
      g2.act(pid2, 'bid', { amount: a.nextBid });
    }
  }
  const ow = g2.s.players.find(p => p.id === pid2).m.auctionWins;
  console.log('\n定向验证·拍卖链路：玩家共拍得 ' + ow + ' 件标的 —— ' +
    (ow > 0 ? '✅ 通过（暗标→入围→明标→软延时→成交→过户 全线打通）' : '❌ 未拍到'));
}

/* ===== 回归断言：往返套利 =====
   曾经存在一个致命漏洞：整笔按"成交前价格"结算、冲击只改下一笔报价，于是
   "买满 → 立刻卖出"会把价格推高再砸回来，市场状态逐位复原、现金却凭空变多。
   实测 200 轮往返净赚 123,231 G，全程没有推进任何游戏时间 —— 它让所有平衡数据失效。
   改用"冲击在数量上的积分均值"作为成交价后，同规模往返必须恰好零净额（只剩手续费）。
   这条断言把这个类别的漏洞钉死，不让它再回来。 */
{
  const g3 = new GG.Game({ seed: 'GG-ROUNDTRIP', corp: 'trade', npcs: 3, secPerGameHour: SPH });
  const pid3 = g3.s.humanId, p3 = g3.s.players[0];
  p3.cash = 100000;
  const c3 = g3.s.crops.chili;
  const before = { cash: p3.cash, price: c3.price, mmInv: c3.mmInv };
  const Q = 40;
  const b = g3.act(pid3, 'buy', { crop: 'chili', qty: Q });
  const sl = g3.act(pid3, 'sell', { crop: 'chili', qty: Q });
  const net = p3.cash - before.cash;
  const fee = Q * before.price * 2 * GG.BAL.marketFee;
  const okTrip = b.ok && sl.ok && net <= 0;
  console.log('\n回归断言·往返套利：单次 ' + Q + ' 单位往返净额 ' + net.toFixed(2) +
    ' G（应 ≤0，约等于 −' + fee.toFixed(1) + ' 手续费）—— ' +
    (okTrip ? '✅ 通过（印钞机已关闭）' : '❌ 失败：存在无风险套利'));

  const qq = g3.quote(p3, 'chili', 30, 'buy');
  const b2 = g3.act(pid3, 'buy', { crop: 'chili', qty: 30 });
  const drift = b2.ok ? Math.abs(qq.total - (b2.gross + b2.fee)) / Math.max(1, qq.total) : 1;
  console.log('回归断言·报价一致性：面板 vs 实际偏差 ' + (drift * 100).toFixed(2) + '% —— ' +
    (drift < 0.01 ? '✅ 通过' : '❌ 失败：面板在骗玩家'));

  const lim = g3.act(pid3, 'limit', { crop: 'sauce', side: 'buy', qty: 5, price: 100 });
  console.log('回归断言·加工品挂单：' + (lim.ok === false ? '✅ 被干净拒绝（' + lim.msg + '）' : '❌ 居然成功了，会崩主循环'));

  const lend = g3.act(pid3, 'lend', { pid: 'N1', amount: 500 });
  console.log('回归断言·非金融公司不能放贷：' + (lend.ok === false ? '✅ 被拒绝' : '❌ 通过了'));
}
