/* ===== part: 13-end-codex.js ===== */
function viewEnd() {
  const st = G.s.settlement;
  if (!st) return '<div class="empty">赛季还在进行中。</div>';
  const rows = st.rows.map(r => `<tr class="${r.id === G.s.humanId ? 'me' : ''}">
      <td>${esc(r.name)}${r.alive ? '' : ' <span class="down">出局</span>'}</td>
      <td class="mono">${fmt(r.nav)}</td>
      <td class="mono">${r.ratio.toFixed(2)}×</td>
      <td class="mono">${(r.monoProx * 100).toFixed(0)}%</td>
      <td class="mono">${r.nominCount}</td></tr>`).join('');
  return `<div id="awards">
    <h1>第 1 赛季 · 结算</h1>
    <div class="sub">种子 ${esc(st.seed)} · ${esc(st.reason || '')}</div>

    <div class="aw chief">
      <div class="who">首席胜利者</div>
      <div class="ttl">${esc(st.chief.name)} —— ${esc(st.chief.title)}</div>
      <div class="why">${esc(st.chief.why)}</div>
    </div>

    ${st.tiers.length ? `<div class="aw">
      <div class="who">胜利路径达成者</div>
      ${st.tiers.map(t => `<div class="ttl" style="font-size:14px">${esc(t.name)} —— ${esc(t.title)}</div>
        <div class="why">${esc(t.why)}</div>`).join('<div style="height:8px"></div>')}
    </div>` : ''}

    <div class="aw">
      <div class="who">叙事提名</div>
      ${st.nominations.length ? st.nominations.map(n => `
        <div style="margin-top:10px">
          <div class="ttl" style="font-size:14px">${esc(n.name)} —— ${esc(n.title)}</div>
          <div class="why">${esc(n.why)}</div>
          <div class="say">${esc(n.text)}</div>
        </div>`).join('') : '<div class="why">这一局没有人留下值得记录的痕迹。</div>'}
    </div>

    <div class="aw">
      <div class="who">全场账本</div>
      <table class="tbl">
        <tr><th>公司</th><th>净资产</th><th>倍数</th><th>控盘度</th><th>提名</th></tr>
        ${rows}
      </table>
      <div class="why" style="margin-top:8px">净资产 = 现金 + 库存×95% + 固定资产×80% − 欠款。控盘度是"占全场该作物库存 + 未来到货量"的比例。</div>
    </div>

    <div class="aw">
      <div class="who">我的赛季</div>
      ${(() => {
        const h = st.rows.find(r => r.id === G.s.humanId) || {};
        return `<div class="line"><span class="k">最终名次</span><span class="v">${st.rows.indexOf(h) + 1} / ${st.rows.length}</span></div>
        <div class="line"><span class="k">净资产</span><span class="v mono">${fmt(h.nav || 0)} G（${(h.ratio || 0).toFixed(2)}×）</span></div>
        <div class="line"><span class="k">累计生产</span><span class="v mono">${fmt(h.harvest || 0)} G</span></div>
        <div class="line"><span class="k">成交总额</span><span class="v mono">${fmt(h.volume || 0)} G</span></div>
        <div class="line"><span class="k">点亮的本领</span><span class="v">${(h.talents || []).length} 个（Lv${h.level || 1}）</span></div>`;
      })()}
    </div>

    <button class="btn p wide" id="again" style="margin-bottom:20px">再来一局（新世界）</button>
  </div>`;
}

/* ---------- 天赋弹层 ---------- */
function talentModal() {
  const offs = HUMAN.talentOffers;
  if (!offs) { $('#ovTalent').classList.add('hide'); return; }
  $('#ovTalent').innerHTML = `<div class="modal">
    <h2>升到 Lv${HUMAN.level}</h2>
    <div class="lead">选一样本事。三张里至少一张来自你这家公司的主色谱系 —— 一局最多点满一条路再加一个。</div>
    <div class="talents">
      ${offs.map(id => {
        const t = GG.TALENTS.find(x => x.id === id);
        return `<button class="tcard ${t.rarity}" data-talent="${t.id}">
          <div class="tree">${ { grow: '种植系', market: '市场系', fight: '斗争系' }[t.tree] } · ${ { common: '常见', rare: '稀有', epic: '史诗' }[t.rarity] }</div>
          <div class="n">${esc(t.name)}</div><div class="d">${esc(t.desc)}</div></button>`;
      }).join('')}
    </div>
    <div class="btnrow" style="margin-top:12px">
      <button class="btn" id="reroll" ${HUMAN.freeReroll ? '' : 'disabled'}>换一批（还有 ${HUMAN.freeReroll} 次）</button>
    </div>
  </div>`;
  $('#ovTalent').classList.remove('hide');
}

/* ---------- 视图：图鉴（跨局只保留"广度"，不保留强度） ---------- */
function viewCodex() {
  const c = codex();
  const bar = (got, total) => `<div class="bar" style="height:6px;background:#0d131a;border-radius:3px;overflow:hidden;margin:5px 0">
    <i style="display:block;height:100%;width:${Math.min(100, (got / total) * 100)}%;background:linear-gradient(90deg,#4aa8ff,#a97bff)"></i></div>`;
  const list = (map, all, nameOf) => Object.keys(map).length
    ? Object.keys(map).sort((a, b) => map[b] - map[a]).map(k => {
        const n = nameOf(k);
        return `<span class="chip on" style="margin:2px 4px 2px 0">${esc(n)} ×${map[k]}</span>`;
      }).join('')
    : '<div class="hint">还没有记录。</div>';
  const totalT = GG.TALENTS.length;
  return `
    <div class="card">
      <div class="ct"><h3>我的生涯</h3><span class="sub">跨局保留，只记"见过什么"，不给你任何数值优势</span></div>
      <div class="line"><span class="k">打过的赛季</span><span class="v mono">${c.games}</span></div>
      <div class="line"><span class="k">当上首席</span><span class="v mono gold">${c.wins}</span></div>
      <div class="line"><span class="k">被清算过</span><span class="v mono down">${c.dead}</span></div>
      <div class="line"><span class="k">最好成绩</span><span class="v mono">${c.bestRatio ? c.bestRatio.toFixed(2) + ' 倍' : '—'}</span></div>
      <div class="line"><span class="k">见过的世界</span><span class="v mono">${Object.keys(c.seeds || {}).length} 个</span></div>
    </div>

    <div class="card">
      <div class="ct"><h3>作物</h3><span class="sub">${Object.keys(c.crops).length} / ${GG.CROP_IDS.length}</span></div>
      ${bar(Object.keys(c.crops).length, GG.CROP_IDS.length)}
      ${Object.keys(c.crops).length ? GG.CROP_IDS.filter(id => c.crops[id]).map(id =>
        `<div class="line"><span class="k">${G.s.crops[id].icon} ${esc(G.s.crops[id].name)}</span>
          <span class="v mono">${c.crops[id]} 局</span></div>`).join('') : '<div class="hint">还没有记录。</div>'}
      ${GG.CROP_IDS.filter(id => !c.crops[id]).length ? '<div class="hint">还没碰过：' +
        GG.CROP_IDS.filter(id => !c.crops[id]).map(id => G.s.crops[id].icon + G.s.crops[id].name).join('、') + '</div>' : ''}
    </div>

    <div class="card">
      <div class="ct"><h3>公司</h3><span class="sub">${Object.keys(c.corps).length} / ${GG.CORPS.length}</span></div>
      ${bar(Object.keys(c.corps).length, GG.CORPS.length)}
      ${Object.keys(c.corps).length ? GG.CORPS.filter(x => c.corps[x.id]).map(x =>
        `<div class="line"><span class="k">${esc(x.name)} <span class="dim" style="font-size:10px">${esc(x.tag)}</span></span>
          <span class="v mono">${c.corps[x.id]} 局</span></div>`).join('') : '<div class="hint">还没有记录。</div>'}
      ${GG.CORPS.filter(x => !c.corps[x.id]).length ? '<div class="hint">还没开过：' +
        GG.CORPS.filter(x => !c.corps[x.id]).map(x => x.name).join('、') + '</div>' : ''}
    </div>

    <div class="card">
      <div class="ct"><h3>点亮过的本领</h3><span class="sub">${Object.keys(c.talents).length} / ${totalT}</span></div>
      ${bar(Object.keys(c.talents).length, totalT)}
      ${list(c.talents, GG.TALENTS, id => { const t = GG.TALENTS.find(x => x.id === id); return t ? t.name : id; })}
    </div>

    <div class="card">
      <div class="ct"><h3>拿过的称号</h3><span class="sub">${Object.keys(c.noms).length} 种</span></div>
      ${list(c.noms, null, k => k)}
    </div>`;
}

/* ---------- 主渲染 ---------- */
