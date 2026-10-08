/* ===== part: 10-market.js ===== */
function spark(cid) {
  const c = G.good(cid);          // 加工品也有走势图
  if (!c) return '';
  const h = c.hist || [];
  if (h.length < 2) return '';
  const w = 300, ht = 34, base = c.base;
  const ps = h.map(x => x.p);
  const lo = Math.min(...ps, base), hi = Math.max(...ps, base);
  const span = Math.max(0.01, hi - lo);
  const pt = (x, i) => [(i / (ps.length - 1)) * w, ht - ((x - lo) / span) * ht];
  const d = ps.map((x, i) => (i ? 'L' : 'M') + pt(x, i).map(v => v.toFixed(1)).join(' ')).join(' ');
  const yb = ht - ((base - lo) / span) * ht;
  const up = ps[ps.length - 1] >= ps[0];
  /* 走势图现在画在纸底行情卡上（v3），不再用给深底设计的荧光绿/红 ——
     改成与全站一致的「墨版」语义色，在米色纸上对比度才够。 */
  const col = up ? '#1a6b42' : '#9e2f28';
  return `<canvas width="${w}" height="${ht}" data-spark="${cid}" data-d="${d}" data-base="${yb.toFixed(1)}" data-col="${col}" data-w="${w}" data-h="${ht}"></canvas>`;
}
function drawSparklines() {
  document.querySelectorAll('canvas[data-spark]').forEach(cv => {
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    c.strokeStyle = 'rgba(125,108,80,.5)'; c.setLineDash([3, 3]); c.lineWidth = 1;
    const yb = +cv.dataset.base;
    c.beginPath(); c.moveTo(0, yb); c.lineTo(cv.width, yb); c.stroke();
    c.setLineDash([]);
    const col = cv.dataset.col;
    c.strokeStyle = col; c.lineWidth = 1.6; c.lineJoin = 'round';
    const p = new Path2D(cv.dataset.d);
    c.stroke(p);
    c.globalAlpha = .12; c.fillStyle = col;
    c.lineTo(cv.width, cv.height); c.lineTo(0, cv.height); c.closePath(); c.fill();
    c.globalAlpha = 1;
  });
}

/* 挂单 / 看跌区：只给作物显示。
   加工品不能挂单（引擎会拒绝），所以整块都不渲染 —— 免得玩家点了报错。 */
function limitBlock(cid) {
  const s = G.s, c = G.good(cid);
  return `<details style="margin-top:8px">
        <summary class="dim" style="font-size:11px;cursor:pointer">挂单 / 借货看跌</summary>
        <div style="margin-top:8px">
          <div class="qty">
            <input type="number" inputmode="numeric" id="lp_${cid}" value="${fmt1(c.price * 0.9)}" placeholder="挂单价">
            <button class="btn sm" data-limit="${cid}:buy">挂买单</button>
            <button class="btn sm" data-limit="${cid}:sell">挂卖单</button>
          </div>
          <div class="hint">挂单按你写的价格躺在市场上，价格穿过才成交；买单会先冻结资金。</div>
          <div class="qty" style="margin-top:8px">
            <input type="number" inputmode="numeric" id="sq_${cid}" value="10" placeholder="数量">
            <button class="btn sm" data-short="${cid}">借货卖出（看跌 10 单位）</button>
            ${HUMAN.shorts[cid] ? `<button class="btn sm gold" data-cover="${cid}">买回平仓 ${HUMAN.shorts[cid].qty}</button>` : ''}
          </div>
          ${HUMAN.shorts[cid] ? `<div class="hint gold">看跌仓位 ${HUMAN.shorts[cid].qty} 单位，建仓价 ${fmt1(HUMAN.shorts[cid].entry)}，押金 ${fmt(HUMAN.shorts[cid].margin)} G。
            价格反向涨 30% 会被动清盘。</div>` : ''}
        </div>
      
      </details>`;
}

/* §17.1 ① 收货商 —— 界面身份：一个常年在收货的人（有名字、有头像）。
   ⚠ 术语红线（§17.1 明令）：绝不允许出现「做市商 / 库存偏离 / 保留价 /
     逆向选择 / 流动性 / mmInv / 报价价差」。lint-copy 会查。
   ⚠ 为何只对作物显示：收货商 = 产地收购站 / 粮商，收的是**作物**；
     成品的下家是 docs/13 §17.2「上门的买家」那一套（街坊 / 作坊主 / 豪客）。 */
const DEALER = { name: '老赵', icon: '🧺' };

/* 他摊上的那块牌子 —— 牌子 = 他的**可见状态**（docs/13 §17.5 通用法则 1：一个角色 = 一个人 + 一块会变的牌子）。
   刻意**不新增 CSS 类**：这段文字放进已有的 .quote 里继承现成配色，
   避免踩 docs/12 §17 的「深色作用域」坑（新增深底容器不同步名单 → 文字隐形，已犯过两次）。 */
function dealerBoard(p, cid) {
  const quota = G.dealerQuota(cid);
  if (!quota) return '';
  const left = Math.max(0, quota - G.dealerSoldToday(p, cid));
  /* ⚠ 文案三条规则，每一条都来自 2026-10-08 试玩员的实测反馈：
     ① **不说「明天再来」**——他并不拒绝成交。写着“明天再来”却能卖，
        试玩员原话：“让我觉得规则在骗我”。
     ② 主语写清是**他**的胃口、而且**只算你自己**卖的量——
        否则玩家看不出这个数字该归谁（原话：“看不出主语是谁”）。
     ③ 收满时要明说“**还卖得动**”，把因果关系说完整。 */
  return left > 0
    ? `${DEALER.icon} ${DEALER.name}的收货摊：今天还能收 <b>${left}</b> 单位 <span class="dim">（只算你卖的 · 天亮回满）</span>`
    : `${DEALER.icon} ${DEALER.name}的收货摊：<b class="down">今天收够了</b> <span class="dim">（还卖得动，但他会往死里压价 · 天亮回满）</span>`;
}

/* §17.2 ② 上门的买家 —— 「市场不是背景，是有人在外面等我」（§17.2 的设计意图）。
   ⚠ 复用已有的 .crop 类（它在 docs/12 §17 的「深色作用域」名单里），
     **不新增深底容器** —— 否则内部 var(--ink*) 在米色纸上变近白 → 文字隐形（已犯过两次：#feed、.crop）。
   ⚠ 零术语（§17.2 明令）：不说 需求曲线/价格弹性/派生需求/边际消费倾向/饱和/需求侧。 */
function buyerPanel() {
  const rows = Object.keys(GG.BAL.buyers).map(type => {
    const cfg = GG.BAL.buyers[type];
    const off = G.buyerOffer(HUMAN, type);
    if (!off) return '';
    const g = G.good(off.cid);
    const ratio = Math.round(off.price / g.price * 100);
    return `<div class="crop">
      <div class="hd">
        <div class="ic" style="font-size:30px">${cfg.icon}</div>
        <div class="p">
          <div class="row between">
            <div><b>${esc(cfg.name)}</b> 上门来买 <b>${off.qty}</b> 单位${esc(g.name)}</div>
            <div class="px mono">${fmt1(off.price)}<span class="dim" style="font-size:11px"> G</span></div>
          </div>
          <div class="dl dim">${cfg.blurb}</div>
          <div class="dl dim">他出的是行价的 ${ratio}% · ${off.met === 0 ? '头一回见你' : '见过你 ' + off.met + ' 次'}${
            off.regular ? '（<b class="gold">回头客</b>，出价更高）' : ''}${
            off.boughtToday > 0 ? ' · 今天已经买走 ' + off.boughtToday + ' 单位' : ''}</div>
          <div class="dl dim">他买走的货直接拉走，<b>不会把行价砸下来</b></div>
        </div>
      </div>
      <div class="btnrow">
        <button class="btn p" data-sellto="${type}">卖给他 · 到手 ${fmt(off.qty * off.price)} G</button>
        <button class="btn" data-decline="${type}">今天不了</button>
      </div>
    </div>`;
  }).join('');
  return rows ? `<div class="dl dim" style="margin:2px 0 6px">🚪 门口有人在等 —— 卖给他不会砸价</div>${rows}` : '';
}

/* §4.15 ① 种子·农资 —— 投入品档（买来是为了用，**只能买不能卖**）。
   为什么单独一套小卡，不复用下面作物/加工品那张大卡：
   大卡里有挂单、借货看跌、收货商、市场占有……这些对投入品**全都不适用**
   （它们不参与控价，也没有做市商）。硬套会渲染出一堆点了就报错的按钮。
   ⚠ 图标直接用 `g.icon`（数据里带），不走 icon() —— 少一个“它认不认得这个 id”的未知数。 */
function inputSection() {
  const ids = (GG.MARKET_GOODS || []).filter(id => G.isInput(id));
  if (!ids.length) return '';
  const rows = ids.map(id => {
    const g = G.good(id);
    const q = ui.qty[id] == null ? 10 : ui.qty[id];
    const qb = G.quote(HUMAN, id, q, 'buy');
    const held = HUMAN.storage[id] || 0;
    const useTxt = g.crop
      ? ' · 种' + esc((GG.CROPS.find(c => c.id === g.crop) || {}).name || '') + '用'
      : '';
    const noteTxt = g.note ? ' · ' + esc(g.note) : '';
    return `<div class="crop">
      <div class="hd">
        <div class="ic">${g.icon}</div>
        <div class="p">
          <div class="row between"><div class="px mono">${fmt1(qb.avgPrice)}<span class="dim" style="font-size:11px"> G</span></div>
            <div class="dl dim">今天的价</div></div>
          <div class="dl dim">${esc(g.name)}${useTxt}${noteTxt}</div>
        </div>
      </div>
      <div class="stats">
        <div>我的持仓<b>${held}</b></div>
        <div>最多可买<b>${qb.maxQty}</b></div>
      </div>
      <div class="qty">
        <input type="number" inputmode="numeric" min="0" id="q_${id}" value="${q}" data-qin="${id}">
        <div class="chips">
          <button class="chip" data-qset="${id}:10">10</button>
          <button class="chip" data-qset="${id}:50">50</button>
          <button class="chip" data-qset="${id}:max">买满(${qb.maxQty})</button>
        </div>
      </div>
      <div class="quote">买入 ${q} 单位：要花 <b>${fmt(qb.total)}</b> G（含手续费 ${fmt1(qb.fee)}）<br>
        <span class="dim">这一档买来是为了用，不能倒手卖。</span></div>
      <div class="btnrow"><button class="btn g" data-buy="${id}">买入</button></div>
    </div>`;
  }).join('');
  return `<div class="dl dim" style="margin:2px 0 6px">🧺 种子·农资 —— 买来是为了用，不能倒手卖</div>${rows}`;
}

/* §4.16 地皮 —— 四种“使用”里只暴露**三种**，因为只有它们有真差别：
     · 粮田：便宜、单产基准（= 原来的地）
     · 经济作物地：贵一些、单产更高
     · 设施用地：最贵、单产更低，但适合放自动化（放置化）
   ⚠ **地段暂不上**：它目前只影响地价、不影响任何玩法，
     放上来就是让玩家花真钱做一个假选择 —— 宁可少一个按钮。
   ⚠ 价钱读的是 G.landPrice，与记账/引擎**同一个函数**（不许两处各算一遍）。 */
function landSection() {
  const rows = (GG.BAL.landUses || []).map(use => {
    const cost = G.landPrice(HUMAN, { use });
    const nm = (GG.BAL.landUseName || {})[use] || use;
    const yld = (GG.BAL.landUseYield || {})[use];
    const tag = yld == null ? '' : (yld >= 1 ? ' · 收成 ×' + yld : ' · 收成 ×' + yld);
    return `<button class="chip${HUMAN.cash >= cost ? '' : ' off'}" data-act="expand" data-use="${use}">` +
      `${esc(nm)} ${fmt(cost)}${tag}</button>`;
  }).join('');
  return `<div class="dl dim" style="margin:2px 0 6px">🏞 地皮 —— 不同的地用不同的价，收成也不一样</div>` +
    `<div class="chips" style="flex-wrap:wrap">${rows}</div>`;
}

function viewMarket() {
  const s = G.s;
  /* 加工品只在"你已经接触过"之后才出现，避免开局就丢 6 张卡给新手 */
  const goods = GG.CROP_IDS.concat(GG.PRODUCT_IDS).filter(id => {
    if (!G.isProduct(id)) return true;
    return (HUMAN.storage[id] || 0) > 0 || HUMAN.craftJobs.some(j => j.pid === id) || HUMAN.workshops > 0;
  });

  return inputSection() + landSection() + buyerPanel() + goods.map(cid => {
    const c = G.good(cid);
    const isProd = G.isProduct(cid);
    const chg = (c.price / c.base - 1) * 100;
    const q = ui.qty[cid] == null ? 10 : ui.qty[cid];
    const qb = G.quote(HUMAN, cid, q, 'buy');
    const qs = G.quote(HUMAN, cid, q, 'sell');
    const held = HUMAN.storage[cid] || 0;
    const book = HUMAN.avgCost[cid];
    const share = isProd ? 0 : G.monoShare(HUMAN, cid) * 100;
    const need = isProd ? 0 : Math.round(c.mono * 1000) / 10;

    return `<div class="crop">
      <div class="hd">
        <div class="ic">${icon(cid, 34)}</div>
        <div class="p">
          <div class="row between"><div class="px mono">${fmt1(c.price)}<span class="dim" style="font-size:11px"> G</span></div>
            <div class="dl ${chg >= 0 ? 'up' : 'down'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(1)}%</div></div>
          <div class="dl dim">${esc(c.name)} · ${isProd ? ('由 ' + esc(s.crops[c.from].name) + ' 加工而来') : esc(c.tier)} · 基准 ${fmt1(c.base)} · 估值 ${fmt1(G.valuePrice(cid))}</div>
        </div>
      </div>
      ${spark(cid)}
      <div class="stats">
        <div>我的持仓<b>${held}</b></div>
        <div>我的均价<b>${book && book.c ? fmt1(book.c) : '—'}</b></div>
        ${isProd
          ? `<div>品牌溢价<b class="gold">+${(0.30 * Math.pow(HUMAN.brand / 100, 1.5) * 100).toFixed(0)}%</b></div>`
          : `<div>市场占有<b class="${share >= need ? 'gold' : ''}">${share.toFixed(1)}% / ${need}%</b></div>`}
      </div>
      <div class="qty">
        <input type="number" inputmode="numeric" min="0" id="q_${cid}" value="${q}" data-qin="${cid}">
        <div class="chips">
          <button class="chip" data-qset="${cid}:5">5</button>
          <button class="chip" data-qset="${cid}:20">20</button>
          <button class="chip" data-qset="${cid}:50">50</button>
          <button class="chip" data-qset="${cid}:max">买满(${qb.maxQty})</button>
        </div>
      </div>
      <div class="quote">
        买入 ${q} 单位：均价 <b>${fmt1(qb.avgPrice)}</b> · 要花 <b>${fmt(qb.total)}</b> G（含手续费 ${fmt1(qb.fee)}）<br>
        会把价格推到 <b>${fmt1(qb.priceAfter)}</b>（${qb.impactPct >= 0 ? '+' : ''}${qb.impactPct.toFixed(1)}%）· 最多可买 <b>${qb.maxQty}</b>
        ${held >= q
          ? `<br>卖出 ${q} 单位：到手 <b class="up">${fmt(qs.total)}</b> G ·
             会把价格砸低 <b class="down">${Math.abs(qs.impactPct).toFixed(1)}%</b> —— 你卖得越多，跌得越狠`
          : `<br><span class="dim">（手里还没有 ${q} 单位可卖）</span>`}
        ${isProd ? '' : `<br>${dealerBoard(HUMAN, cid)}`}
      </div>
      <div class="btnrow">
        <button class="btn g" data-buy="${cid}">买入</button>
        <button class="btn d" data-sell="${cid}">卖出</button>
        <button class="btn" data-buymax="${cid}">一次买满（${qb.maxQty}）</button>
      </div>
      ${isProd ? '' : limitBlock(cid)}
    </div>`;
  }).join('') + (HUMAN.limitOrders.length ? `
    <div class="card">
      <div class="ct"><h3>我的挂单</h3></div>
      ${HUMAN.limitOrders.map(o => `<div class="line">
        <span class="k">${o.side === 'buy' ? '买' : '卖'} ${o.qty} ${esc((G.good(o.crop) || {}).name || o.crop)} @ ${fmt1(o.price)}</span>
        <button class="btn sm" data-cancel="${o.id}">撤单</button></div>`).join('')}
    </div>` : '');
}

/* ---------- 视图：制造 ---------- */
