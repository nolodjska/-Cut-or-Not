/* ===== part: 11-make-intel.js ===== */
function viewMake() {
  const s = G.s;
  const corp = GG.CORPS.find(c => c.id === HUMAN.corp);
  const busy = HUMAN.craftJobs.length;
  const jobs = HUMAN.craftJobs.map(j => {
    const pd = s.products[j.pid];
    const total = j.doneT - j.startedT, done = Math.min(1, (s.t - j.startedT) / Math.max(1, total));
    return `<div class="line" style="flex-direction:column;align-items:stretch;gap:5px">
      <div class="row between"><span>${pd.icon} ${esc(pd.name)} × ${j.out}</span>
        <span class="mono dim">还差 ${Math.max(0, (j.doneT - s.t) / 60).toFixed(1)} 游戏小时</span></div>
      <div class="bar" style="height:5px;background:#0d131a;border-radius:3px;overflow:hidden">
        <i style="display:block;height:100%;width:${(done * 100).toFixed(0)}%;background:linear-gradient(90deg,#4aa8ff,#35d07f)"></i></div>
    </div>`;
  }).join('');

  const recipes = GG.PRODUCTS.map(pd => {
    const crop = s.crops[pd.from];
    const have = HUMAN.storage[pd.from] || 0;
    const inCost = pd.need * G.valuePrice(pd.from);
    const outVal = pd.out * G.valuePrice(pd.id) * (1 + 0.30 * Math.pow(HUMAN.brand / 100, 1.5));
    const margin = outVal - inCost;
    const hours = pd.hours * (corp.craftSpeed || 1);
    const can = HUMAN.workshops > busy && have >= pd.need && HUMAN.cash >= 20;
    return `<div class="card" style="background:var(--panel2);margin-bottom:8px">
      <div class="ct"><h3>${pd.icon} ${esc(pd.name)}</h3>
        <span class="sub">${pd.need} ${esc(crop.name)} → ${pd.out} ${esc(pd.name)} · ${hours.toFixed(1)} 时</span></div>
      <div class="hint">${esc(pd.note)}</div>
      <div class="line"><span class="k">原料成本</span><span class="v mono">${fmt(inCost)} G</span></div>
      <div class="line"><span class="k">成品估值${HUMAN.brand > 0 ? '（含品牌溢价）' : ''}</span><span class="v mono">${fmt(outVal)} G</span></div>
      <div class="line"><span class="k">一批毛利</span><span class="v mono ${margin >= 0 ? 'up' : 'down'}">${margin >= 0 ? '+' : ''}${fmt(margin)} G</span></div>
      <div class="line"><span class="k">你的原料</span><span class="v mono ${have >= pd.need ? 'up' : 'down'}">${have} / ${pd.need}</span></div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn p" data-craft="${pd.id}" ${can ? '' : 'disabled'}>开一批</button>
        ${have < pd.need ? `<button class="btn" data-buyneed="${pd.id}">买齐原料（${pd.need - have}）</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const prods = GG.PRODUCT_IDS.filter(id => (HUMAN.storage[id] || 0) > 0).map(id => {
    const pd = s.products[id], n = HUMAN.storage[id];
    const q = G.quote(HUMAN, id, n, 'sell');
    return `<div class="line"><span class="k">${pd.icon} ${esc(pd.name)} × ${n}</span>
      <span><span class="v mono">${fmt(q.total)} G</span>
      <button class="btn sm g" data-sellone="${id}" style="margin-left:6px">全卖</button></span></div>`;
  }).join('');

  return `
    ${warnBox()}
    <div class="card">
      <div class="ct"><h3>作坊</h3><span class="sub">${busy}/${HUMAN.workshops} 条产线在跑</span></div>
      <div class="line"><span class="k">作坊数量</span><span class="v mono">${HUMAN.workshops}</span></div>
      <div class="line"><span class="k">品牌值</span><span class="v mono gold">${Math.round(HUMAN.brand)} / 100</span></div>
      <div class="bar" style="height:6px;background:#0d131a;border-radius:3px;overflow:hidden;margin:6px 0">
        <i style="display:block;height:100%;width:${HUMAN.brand}%;background:linear-gradient(90deg,#f5c451,#ff9d5c)"></i></div>
      <div class="hint">品牌值来自"出货量"，每出货一件涨一点。品牌越高，成品卖价越高（最高 +30%）。
        ${corp.brandGrowthMult ? '你的公司品牌涨得更快。' : ''}</div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn" data-act="buildWorkshop">
          再建一间作坊（${HUMAN.workshops === 0 ? GG.BAL.workshopCost : GG.BAL.workshopCost2} G）</button>
      </div>
      ${jobs ? '<div style="margin-top:8px">' + jobs + '</div>' : '<div class="empty">产线空着。空着的作坊不赚钱。</div>'}
    </div>

    <div class="card">
      <div class="ct"><h3>配方</h3><span class="sub">把原料变成值钱的东西</span></div>
      ${recipes}
      <div class="hint">加工品有自己的市场，价格跟着原料的估值价走 ——
        原料涨，成品的基本面就涨。下游每天能吃下的量是有限的，卖不进去就得等。</div>
    </div>

    ${prods ? `<div class="card"><div class="ct"><h3>成品仓库</h3><span class="sub">按估值价 + 品牌溢价计</span></div>${prods}</div>` : ''}`;
}

/* ---------- 视图：情报 ---------- */
function viewIntel() {
  const s = G.s;
  const corp = GG.CORPS.find(x => x.id === HUMAN.corp);
  const price = Math.round(GG.BAL.intelInsiderPrice * corp.intelMod);
  const cd = Math.max(0, (HUMAN.intelCdT || 0) - s.t) / 60;
  const known = (HUMAN.m.intelKnown || []).filter(k => !k.sold);
  const nextEv = s.eventQueue.find(q => !q.fired);
  return `
    <div class="card">
      <div class="ct"><h3>我的信誉</h3><span class="sub">信誉越高，消息卖得越贵</span></div>
      <div class="line"><span class="k">信誉值</span><span class="v mono">${Math.round(HUMAN.reputation)} / 100</span></div>
      <div class="bar" style="height:6px;background:#0d131a;border-radius:3px;overflow:hidden;margin-top:6px">
        <i style="display:block;height:100%;width:${HUMAN.reputation}%;background:linear-gradient(90deg,#4aa8ff,#a97bff)"></i></div>
    </div>

    <div class="card">
      <div class="ct"><h3>打听消息</h3></div>
      <div class="btnrow">
        <button class="btn" data-intel="free">听听风声（免费）</button>
        <button class="btn p" data-intel="insider" ${HUMAN.cash < price ? 'disabled' : ''}>
          买内幕（${price}G）</button>
      </div>
      <div class="hint">${cd > 0 ? '线人还在外面打听，' + cd.toFixed(1) + ' 游戏小时后有新消息。' :
        '内幕情报能提前知道下一场市场事件的作物与方向，但不保证百分百准确。'}</div>
      ${ui.lastIntel ? `<div class="quote" style="margin-top:8px">${esc(ui.lastIntel)}</div>` : ''}
      ${nextEv ? `<div class="hint">已知：下一场事件大约在第 ${Math.floor(nextEv.at / 1440) + 1} 天 ${Math.floor((nextEv.at % 1440) / 60)} 时。</div>` : ''}
    </div>

    ${corp.intelCommission ? `<div class="card">
      <div class="ct"><h3>卖消息</h3><span class="sub">你的公司靠这个吃饭</span></div>
      <div class="btnrow"><button class="btn gold" data-sellintel="1" ${known.length ? '' : 'disabled'}>
        卖掉一条（手上 ${known.length} 条）</button></div>
      <div class="hint">同一条消息可以卖给不同的人，但越往后越不值钱 —— 消息会扩散。假消息被识破会掉信誉。</div>
      ${known.map(k => `<div class="line"><span class="k">${esc(s.crops[k.crop] ? s.crops[k.crop].name : '全场')} 偏${k.dir}</span>
        <span class="v dim">待验证</span></div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="ct"><h3>放消息</h3><span class="sub">${GG.BAL.rumorCost}G · 效果 ${GG.BAL.rumorDurH} 小时</span></div>
      <div class="btnrow" style="margin-bottom:7px">
        ${GG.CROP_IDS.map(cid => `<button class="chip ${ui.pick === cid ? 'on' : ''}" data-pick="${cid}">
          ${s.crops[cid].icon}${esc(s.crops[cid].name)}</button>`).join('')}
      </div>
      <div class="btnrow">
        <button class="btn g" data-rumor="up">放"要涨"的消息</button>
        <button class="btn d" data-rumor="down">放"要跌"的消息</button>
      </div>
      <div class="hint">有 ${Math.round(GG.BAL.rumorExposeChance * 100)}% 概率被当场拆穿：效果减半，信誉掉 10。
        被拆穿多了，你的消息就没人信了。</div>
    </div>`;
}

/* ---------- 视图：钱庄 ---------- */
