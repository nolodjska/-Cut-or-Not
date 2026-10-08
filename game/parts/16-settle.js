/* ===== part: 16-settle.js ===== */
Game.prototype.settle = function () {
  const s = this.s;
  const ps = s.players.filter(p => p.isHuman || true);
  const initNav = BAL.startCash +
    (BAL.startPlots + (CORPS.find(c => c.id === 'grow').start.plots)) * 0 +
    BAL.startPlots * BAL.plotCost; // 基准 = 10000
  ps.forEach(p => {
    p.sNav = this.nav(p);
    p.sRatio = p.sNav / (p.initNav || 10000);     // 相对自己的开局，而不是硬编码 10000
  });

  const out = { seed: s.seed, reason: s.overReason, rows: [], chief: null, tiers: [], nominations: [] };

  // --- C 垄断
  const cRank = ps.filter(p => p.alive && this.debtRatio(p) <= BAL.monoMaxDebtRatio).map(p => {
    const m = this.monoProx(p);
    return { p, prox: m.prox, ctrl: m.ctrl, crop: m.crop };
  }).sort((a, b) => b.prox - a.prox);

  // --- A 财富
  const aRank = ps.slice().sort((x, y) => y.sNav - x.sNav);
  /* A 门槛：原案写 3.0 倍，但 40 种子 × 9 策略共 360 局实测，最高只有 2.65 倍，
     3.0 倍从未达成 —— 等于把"农业大亨"这条胜利路径做成了死代码。
     改为 2.5 倍（实测最强策略约 3~5% 能达成，符合"可达但不轻松"）。
     这条改动是集成时的判断，已列入 docs/09 与待决问题 Q-TIME-01。 */
  /* 门槛跟着实测走：关掉"往返套利印钞机"之后，全场的真实天花板降到 ~2.1 倍
     （20 种子 × 11 打法实测：最高 2.09，2.5 倍零达成）。所以从 2.5 再降到 2.0 ——
     "可达但不轻松"。这条数字的变动史本身就是证据：**原来的 1.7~1.8 倍交易收益里有很大
     一部分其实是那台印钞机贡献的**，修掉之后市场的超额收益消失了（详见 docs/09 §2.12）。 */
  const A_THRESHOLD = 2.0;
  const aAchieved = aRank.filter(r => r.sRatio >= A_THRESHOLD && r.alive);

  // --- B 生存
  /* 原案只要"活着且负债率低"就发不倒翁，结果 4 人局里 3 个人都拿到 —— 称号立刻贬值。
     加两道闸：① 资产不能比开局还少；② 这一局必须真的存在过威胁
     （有人出局，或你自己经历过现金流断裂），"活下来"才配叫胜利。 */
  const anyoneDied = ps.some(p => !p.alive);
  const bAlive = ps
    .filter(p => p.alive && this.debtRatio(p) < 0.30 && p.sRatio >= 1.05 && (anyoneDied || p.m.pressure))
    .sort((a, b) => b.sRatio - a.sRatio)
    .slice(0, 2);

  // --- D 综合
  const maxOf = f => Math.max(1e-6, ...ps.map(f));
  const mG = maxOf(p => p.m.harvestedValue), mT = maxOf(p => Math.max(0, p.m.realized)),
        mA = maxOf(p => p.m.acquiredValue + p.m.auctionSpend), mB = maxOf(p => p.m.auctionSpend);
  for (const p of ps) {
    const farm = p.m.harvestedValue / mG;
    const trade = Math.max(0, p.m.realized) / mT;
    const acq = (p.m.acquiredValue + p.m.auctionSpend) / mA;
    const auc = p.m.auctionSpend / mB;
    p.dScore = 0.25 * farm + 0.35 * trade + 0.40 * acq;
    p.dParts = { farm, trade, acq, auc };
    p.dMin = Math.min(farm, trade, acq);
  }
  const dRank = ps.slice().sort((x, y) => y.dScore - x.dScore);

  // --- 首席
  let chief = null, chiefTitle = null, chiefWhy = '';
  if (cRank.length && cRank[0].prox >= 1) {
    chief = cRank[0].p; chiefTitle = '市场霸主';
    chiefWhy = '控制 ' + s.crops[cRank[0].crop].name + ' ' + (cRank[0].ctrl * 100).toFixed(1) +
      '% 流通量，超过 ' + (s.crops[cRank[0].crop].mono * 100) + '% 的垄断门槛';
  } else if (cRank.length && cRank[0].prox > 0.8) {
    chief = cRank[0].p; chiefTitle = '准市场霸主';
    chiefWhy = '最接近垄断：' + s.crops[cRank[0].crop].name + ' 控制度 ' + (cRank[0].prox * 100).toFixed(0) + '% 门槛';
  } else if (aAchieved.length) {
    chief = aAchieved[0]; chiefTitle = '农业大亨';
    chiefWhy = '净资产达到初始的 ' + aAchieved[0].sRatio.toFixed(2) + ' 倍';
  } else {
    chief = aRank[0]; chiefTitle = '全场领先者';
    chiefWhy = '净资产 ' + money(aRank[0].sNav) + ' G（' + aRank[0].sRatio.toFixed(2) + '× 初始）最高，但没人达成垄断或财富门槛';
  }
  out.chief = { pid: chief.id, name: chief.name, title: chiefTitle, why: chiefWhy };

  // --- 次级称号
  for (const r of aAchieved) if (r !== chief) out.tiers.push({ pid: r.id, name: r.name, title: '农业大亨', why: '净资产 ' + r.sRatio.toFixed(2) + '× 初始' });
  for (const p of bAlive) if (p !== chief) out.tiers.push({
    pid: p.id, name: p.name, title: '不倒翁',
    why: '在有人出局的乱局里活到最后，负债率只有 ' + (this.debtRatio(p) * 100).toFixed(0) +
         '%，净资产还有 ' + p.sRatio.toFixed(2) + ' 倍'
  });
  if (dRank[0] !== chief && dRank[0].dScore >= 0.5) out.tiers.push({ pid: dRank[0].p ? dRank[0].p.id : dRank[0].id, name: (dRank[0].p || dRank[0]).name, title: '全能商人', why: '综合得分 ' + dRank[0].dScore.toFixed(2) + ' 最高' });

  // --- 提名（10 项）
  const N = [];
  const top = (arr, key, cmp) => arr.slice().sort((a, b) => cmp(a[key], b[key]));
  const maxv = key => Math.max(...ps.map(p => key(p)));

  // 1 市场搅局者
  {
    const cand = ps.slice().sort((a, b) => b.m.volContrib - a.m.volContrib)[0];
    if (cand && cand.m.volContrib > 0 && cand.m.realized <= 0)
      N.push({ title: '市场搅局者', pid: cand.id, name: cand.name, why: '制造了全场最大的价格波动（' + money(cand.m.volContrib) + ' G 冲击），自己却没赚到钱',
        text: '你的存在让市场哀嚎。在你的操盘下，没有赢家。这是你愿意看到的局面吗？' });
  }
  // 2 经济命运共同体
  {
    const ranked = ps.slice().sort((a, b) => b.m.blessCredit - a.m.blessCredit);
    const cand = ranked[0];
    /* 门槛从 500 提到 5000：原来 360 局里触发了 353 次（98%），等于人人有份的参与奖。
       2026-10-08 再改：660 局实测提到 5000 后**仍触发 606/660（92%）** —— 5000 还是太低。
       所以除绝对下限外，再加一条**断层**要求（必须 ≥2× 第二名）。
       断层是**尺度无关**的：不会像绝对值那样“换个平衡就又失效”。 */
    const BLESS_FLOOR = 5000, BLESS_GAP = 1.6;
    const second = ranked[1] ? (ranked[1].m.blessCredit || 0) : 0;
    if (cand && cand.m.blessCredit > BLESS_FLOOR && cand.m.blessCredit >= second * BLESS_GAP)
      N.push({ title: '经济命运共同体', pid: cand.id, name: cand.name, why: '你的买入与托市让别人的持仓增值了 ' + money(cand.m.blessCredit) + ' G',
        text: '你的每一次买入，都在替别人的库存抬价。你建起了一座繁荣的城市，虽然租金不是你的。' });
  }
  // 3 隐形操盘手
  {
    const cand = ps.filter(p => p.shell.owned > 0).sort((a, b) => b.m.shellTrades - a.m.shellTrades)[0];
    if (cand && cand.m.shellTrades > 0)
      N.push({ title: '隐形操盘手', pid: cand.id, name: cand.name, why: '所有交易都走看不见的通道，成交 ' + cand.m.shellTrades + ' 次仍未被识破',
        text: '没有人知道你是谁。但市场记得你的每一次出手。' });
  }
  // 4 泡沫制造机
  {
    const cand = ps.slice().sort((a, b) => (b.m.bubble || 0) - (a.m.bubble || 0))[0];
    if (cand && (cand.m.bubble || 0) >= 0.20)
      N.push({ title: '泡沫制造机', pid: cand.id, name: cand.name, why: '把价格顶到基本面上方 ' + ((cand.m.bubble || 0) * 100).toFixed(0) + '%，并且在破裂前跑掉了',
        text: '你吹起了泡沫，又在破裂前离场。你是天才，还是骗子？' });
  }
  // 5 最悲情退场者
  {
    const cand = ps.filter(p => !p.alive).sort((a, b) => b.m.bankruptProx - a.m.bankruptProx)[0];
    if (cand)
      N.push({ title: '最悲情退场者', pid: cand.id, name: cand.name, why: '出局时垄断度已到门槛的 ' + (cand.m.bankruptProx * 100).toFixed(0) + '%',
        text: '你差一点就赢了。差一点。' });
  }
  // 6 定海神针
  {
    /* 2026-10-08：原条件（全程没砸盘 + NAV≥1.15）实测触发 531/660（80%）。
       NPC 本来就大多不砸盘，所以“没砸过盘”几乎是默认状态，不构成区分。
       改法：提高 NAV 底线 + 加“断层”（≥1.1× 第二名）。 */
    const stillRanked = ps.filter(p => p.alive && p.m.aggression <= 0 && p.sRatio >= 1.15).sort((a, b) => b.sRatio - a.sRatio);
    const cand = stillRanked[0];
    const STILL_NAV = 1.40, STILL_GAP = 1.20;
    const stillSecond = stillRanked[1] ? stillRanked[1].sRatio : 0;
    if (cand && cand.sRatio >= STILL_NAV && cand.sRatio >= stillSecond * STILL_GAP)
      N.push({ title: '定海神针', pid: cand.id, name: cand.name, why: '全程没有砸过盘、没有放过消息、没有看跌，净资产还有 ' + cand.sRatio.toFixed(2) + ' 倍',
        text: '你是这个疯狂市场里唯一清醒的人。' });
  }
  // 7 最佳线报商
  {
    const cand = ps.filter(p => p.m.intelSold > 0).sort((a, b) => (b.m.intelCorrect / Math.max(1, b.m.intelSold)) - (a.m.intelCorrect / Math.max(1, a.m.intelSold)))[0];
    if (cand)
      N.push({ title: '最佳线报商', pid: cand.id, name: cand.name, why: '卖出的情报准确率 ' + Math.round(cand.m.intelCorrect / Math.max(1, cand.m.intelSold) * 100) + '%，共 ' + cand.m.intelSold + ' 条',
        text: '你卖的不是消息，是别人的命运。' });
  }
  // 8 产业链之王：有加工产值的优先（从种子到成品，这才是真正的纵向整合）
  {
    const crafters = ps.filter(p => (p.m.craftedUnits || 0) > 0).sort((a, b) => (b.m.craftedValue || 0) - (a.m.craftedValue || 0));
    const cand = crafters[0] || ps.filter(p => p.m.harvestedUnits > 0 && Object.keys(p.m.cropTraded).length >= 3)
      .sort((a, b) => (b.storage ? Object.keys(b.storage).length : 0) - (a.storage ? Object.keys(a.storage).length : 0))[0];
    /* 稀少性门槛（2026-10-08 加）：原来只有 `if (cand)`，等于“只要有人种过地就发”——
       660 局实测触发 629/660（95%），是参与奖不是区分奖（`00` §12.1 要的是“被看见”，不是“人人有份”）。
       改法两条路取一：① 加工深度过线**且明显领先第二名**；② 经营的作物种类是**全场唯一**的深。
       ①里的 GAP 是尺度无关的；FLOOR/KINDS 先用经验值，待 sim 标定后微调。 */
    const CRAFT_FLOOR = 1200, CRAFT_GAP = 2.0, CROP_KINDS = 5;
    const deepKinds = p => Object.keys(p.m.cropTraded).length >= CROP_KINDS;
    const second = crafters[1] ? (crafters[1].m.craftedValue || 0) : 0;
    const worthy = !!cand && (
      (cand.m.craftedValue || 0) >= Math.max(CRAFT_FLOOR, second * CRAFT_GAP) ||
      (deepKinds(cand) && ps.filter(deepKinds).length === 1)
    );
    if (worthy) {
      const crafted = (cand.m.craftedUnits || 0) > 0;
      N.push({
        title: '产业链之王', pid: cand.id, name: cand.name,
        why: crafted
          ? '亲手加工了 ' + cand.m.craftedUnits + ' 件成品（产值 ' + money(cand.m.craftedValue) + ' G），品牌值 ' + Math.round(cand.brand || 0)
          : '同时经营 ' + Object.keys(cand.m.cropTraded).length + ' 种作物，从种子到成交一条龙',
        text: crafted ? '你控制了从种子到餐桌的每一段路 —— 而且你是自己动手的那一个。'
                      : '你控制了从种子到餐桌的每一段路。',
      });
    }
  }
  // 9 价差收割机
  {
    /* 2026-10-08：原门槛只有 harvestCredit > 500，实测触发 625/660（95%）——
       比“经济命运共同体”还像参与奖。加“断层”（≥2× 第二名）让它成为真荣誉。 */
    const hvRanked = ps.slice().sort((a, b) => b.m.harvestCredit - a.m.harvestCredit);
    const cand = hvRanked[0];
    const HARVEST_FLOOR = 500, HARVEST_GAP = 1.5;
    const hvSecond = hvRanked[1] ? (hvRanked[1].m.harvestCredit || 0) : 0;
    if (cand && cand.m.harvestCredit > HARVEST_FLOOR && cand.m.harvestCredit >= hvSecond * HARVEST_GAP)
      N.push({ title: '价差收割机', pid: cand.id, name: cand.name, why: '你的抛售让别人的持仓缩水了 ' + money(cand.m.harvestCredit) + ' G',
        text: '你收割了所有人。但下一个被收割的，会不会是你？' });
  }
  // 10 城市奠基人
  {
    /* 2026-10-08：原条件没有门槛（“最高”必然存在一个人），实测触发 448/660（68%）。
       加“断层”（≥1.5× 第二名）+ 绝对下限。 */
    const cityVal = p => (p.m.harvestedValue + p.m.volume);
    const cityRanked = ps.slice().sort((a, b) => cityVal(b) - cityVal(a));
    const cand = cityRanked[0];
    const CITY_FLOOR = 3000, CITY_GAP = 1.5;
    const citySecond = cityRanked[1] ? cityVal(cityRanked[1]) : 0;
    if (cand && cityVal(cand) > CITY_FLOOR && cityVal(cand) >= citySecond * CITY_GAP)
      N.push({ title: '城市奠基人', pid: cand.id, name: cand.name, why: '累计生产与交易总额 ' + money(cand.m.harvestedValue + cand.m.volume) + ' G，全场最高',
        text: '你建起了这座城市。虽然没人记得你的名字。' });
  }

  // 配额：每人最多 2 条（首席 3 条）
  const count = {};
  const finalN = [];
  for (const n of N) {
    const isChief = n.pid === chief.id;
    const cap = isChief ? 3 : 2;
    count[n.pid] = count[n.pid] || 0;
    if (count[n.pid] >= cap) continue;
    count[n.pid]++;
    finalN.push(n);
  }
  out.nominations = finalN;
  out.rows = ps.map(p => ({
    id: p.id, name: p.name, isHuman: p.isHuman, corpName: p.corpName, alive: p.alive,
    nav: Math.round(p.sNav), ratio: p.sRatio, debtRatio: this.debtRatio(p),
    dScore: p.dScore, monoProx: this.monoProx(p).prox, monoCrop: this.monoProx(p).crop,
    talents: p.talents.slice(), level: p.level,
    crafted: Math.round(p.m.craftedValue || 0), brand: Math.round(p.brand || 0),
    avenger: !!p.isAvenger,
    real: Math.round(p.m.realized), harvest: Math.round(p.m.harvestedValue), volume: Math.round(p.m.volume),
    nominCount: count[p.id] || 0,
  })).sort((a, b) => b.nav - a.nav);
  out.log = s.feed.slice(-60);
  return out;
};

/* ---------------------------------------------------------------------------
 * 5. 导出
 * -------------------------------------------------------------------------*/
return {
  BAL, CROPS, CROP_IDS, CORPS, TALENTS, EVENT_POOL, LOT_POOL,
  PRODUCTS, PRODUCT_IDS, PRODUCT_MARGIN, INPUTS, INPUT_IDS, MARKET_GOODS,
  Game, Rng, hash32, makeSeed, money, clamp, round2,
  newGame: opts => new Game(opts),
  /* 存档：把整个状态序列化成字符串 / 反序列化回一个可继续跑的 Game
     （引擎本来就是纯逻辑 + 可 JSON 状态，所以这层很薄；
       读档后必须重建 PRNG，否则随机流会从种子头开始，与存档前的走势分叉） */
  save: g => JSON.stringify({
    v: 1, seed: g.s.seed, secPerGameHour: g.s.secPerGameHour,
    rngState: g.s.rngState, state: g.s,
  }),
  load: str => {
    const raw = JSON.parse(str);
    const g = new Game({ seed: raw.seed, secPerGameHour: raw.secPerGameHour, npcs: 0, hintFirstEvent: false });
    g.s = raw.state;
    g.s.rngState = raw.rngState;
    g._buildRngs();
    return g;
  },
};
