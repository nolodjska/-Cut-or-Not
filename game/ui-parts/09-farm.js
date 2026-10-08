/* ===== part: 09-farm.js ===== */
function viewFarm() {
  const s = G.s;
  const plots = HUMAN.plots.map((pl, i) => {
    const badges = [
      pl.auto ? '<span class="badge auto">自动</span>' : '',
      pl.upgraded ? '<span class="badge up">高产</span>' : '',
    ].join('');
    if (!pl.crop) {
      return `<div class="plot empty"><div class="ic">＋</div><div class="nm">空地</div>
        <div class="meta">选好种子点下面一键播种</div>${badges}
        <div class="acts"><button class="btn sm" data-plant="${i}">种这里</button>${!pl.upgraded ? `<button class="btn sm" data-upgrade="${i}" title="把这块地改成高产地：单产 ×${GG.BAL.plotUpgradeMult}，永久生效">高产地 ${GG.BAL.plotUpgradeCost}G</button>` : ''}</div></div>`;
    }
    const c = s.crops[pl.crop];
    const total = pl.matureT - pl.plantedT;
    const done = Math.min(1, (s.t - pl.plantedT) / Math.max(1, total));
    const left = Math.max(0, (pl.matureT - s.t) / 60);
    return `<div class="plot ${pl.ready ? 'ready' : ''}">${badges}
      <div class="ic">${icon(pl.crop, 30)}</div><div class="nm">${esc(c.name)}</div>
      <div class="meta">${pl.ready ? '<span class="up">可以收割了</span>' : '还差 ' + left.toFixed(1) + ' 小时'}
        · 约 ${Math.round(c.yld * HUMAN.mods.yieldMult * (pl.upgraded ? GG.BAL.plotUpgradeMult : 1))} 单位</div>
      <div class="bar"><i style="width:${(done * 100).toFixed(0)}%"></i></div>
      <div class="acts">
        ${pl.ready ? `<button class="btn sm g" data-harvest="${i}">收割</button>` : ''}
        ${!pl.auto ? `<button class="btn sm" data-auto="${i}" title="永久买断这块地：之后自动收割，不用再点（按成本 70% 计入身价）">自动收割 ${GG.BAL.autoPlotCost}G</button>` : ''}
        ${!pl.upgraded ? `<button class="btn sm" data-upgrade="${i}" title="把这块地改成高产地：单产 ×${GG.BAL.plotUpgradeMult}，永久生效（当前作物也适用）">高产地 ${GG.BAL.plotUpgradeCost}G</button>` : ''}
      </div></div>`;
  }).join('');

  const seedCost = cid => Math.round(s.crops[cid].seed * GG.CORPS.find(x => x.id === HUMAN.corp).seedDiscount * (s.rules.doubleLandRent ? 1.25 : 1));
  const expandN = HUMAN.plots.length - GG.BAL.startPlots;
  /* ⚠ 取价必须和引擎 _a_expand 同口径。那里是 `clamp(n, 0, len-1)` —— **有下界**；
     这里原先是裸 `Math.min(expandN, len-1)`，**下界缺失**：
     贸易/金融这类“开局地块数少于 BAL.startPlots”的公司，expandN 为负
     ⇒ 取到 undefined ⇒ 按钮上印出 `扩一块地 (NaNG)`。
     引擎实际扣费是对的（它有 clamp），**只有预览价成了 NaN**。
     2026-10-08 浏览器实测发现 —— 这类 bug 静态检查、仿真、闸门全都看不见，
     只有“把页面打开看一眼”才会报出来。 */
  const expandIdx = Math.max(0, Math.min(expandN, GG.BAL.plotExpandCost.length - 1));
  const expandCost = GG.BAL.plotExpandCost[expandIdx] * (s.rules.doubleLandRent ? 1.3 : 1);

  const ev = s.activeEvents[0];
  const evPool = ev ? GG.EVENT_POOL.find(e => e.id === ev.id) : null;
  const evArt = ev && EV_ART[ev.id];
  const evBanner = ev ? `<div class="evcard">
      ${evArt ? `<img src="assets/ev-${evArt}.webp" alt="" onerror="this.remove()">` : ''}
      <div class="evtxt"><div class="evname">${esc(evPool ? evPool.name : ev.id)}${ev.crop ? ' · ' + esc(s.crops[ev.crop].name) : ' · 全场'}</div>
        ${esc(evPool ? evPool.text : '')}</div></div>` : '';

  return `
    ${warnBox()}
    ${evBanner}
    <div class="card">
      <div class="ct"><h3>选种子</h3><span class="sub">点一下就播种</span></div>
      <div class="btnrow" style="margin-bottom:8px">
        ${GG.CROP_IDS.map(cid => {
          const c = s.crops[cid];
          /* 成熟时间必须乘上「催芽」天赋的 growMult —— 否则玩家被自己的卡片告知 8 小时，
             而农田倒计时从 6.8 小时开始走，同一屏两个数（2026-10-08 审计拓到）。 */
          const gh = c.growH * (HUMAN.mods.growMult || 1);
          return `<button class="chip ${ui.pick === cid ? 'on' : ''}" data-pick="${cid}">
            ${c.icon}${esc(c.name)} · ${seedCost(cid)}G · ${gh.toFixed(1)} 小时
            <span class="dim">（约 ${Math.round(gh * (G.s.secPerGameHour || 8))} 秒）</span></button>`;
        }).join('')}
      </div>
      <div class="btnrow">
        <button class="btn p" data-act="plantAll">一键播种（${esc(s.crops[ui.pick].name)}）</button>
        <button class="btn g" data-act="harvestAll">一键收割</button>
      </div>
      <div class="hint">${esc(s.crops[ui.pick].note)}</div>
    </div>

    <div class="card">
      <div class="ct"><h3>我的地（${HUMAN.plots.length}/${GG.BAL.maxPlots}）</h3>
        <span class="sub">仓储 ${G.storageUsed(HUMAN)}/${G.storageMax(HUMAN)}</span></div>
      <div id="plots">${plots}</div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn" data-act="expand" ${HUMAN.plots.length >= GG.BAL.maxPlots ? 'disabled' : ''}>
          扩一块地 ${HUMAN.plots.length >= GG.BAL.maxPlots ? '' : '(' + fmt(expandCost) + 'G)'}</button>
        <button class="btn" data-act="upgradeStorage">仓储 +${GG.BAL.storageUpgradeStep}（${fmt(Math.round(GG.BAL.storageUpgradeCost * (G.s.rules.doubleStoragePrice ? 1.5 : 1)))}G）</button>
      </div>
      <div class="hint">地租每块 ${GG.BAL.plotRentPerDay} G/天，用现金付 —— 占地越多，每天睁眼就欠得越多。</div>
    </div>

    <div class="card">
      <div class="ct"><h3>我的仓库</h3><span class="sub">按估值价计</span></div>
      ${Object.keys(HUMAN.storage).length ? Object.keys(HUMAN.storage).map(cid => {
        const c = G.good(cid) || {};
        return `<div class="line"><span class="k">${icon(cid, 18)} ${esc(c.name || cid)} × ${HUMAN.storage[cid]}</span>
          <span class="v mono">${fmt(HUMAN.storage[cid] * G.valuePrice(cid))} G</span></div>`;
      }).join('') : '<div class="empty">仓库是空的。<br>没有货，就没有话语权。</div>'}
    </div>`;
}

/* ---------- 视图：市场 ---------- */