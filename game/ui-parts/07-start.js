/* ===== part: 07-start.js ===== */

/* 公司星级（docs/19 §2）：稳定 / 利润 / 上手，满星五颗。
   为什么画成**一行**而不是三行：三行 × 6 张卡 = 多 18 行，浮层直接撑爆；
   一行小字才装得下。星级本身不参与玩法计算，只是给玩家的选人依据。 */
const starTxt = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

function renderStart() {
  const CORPS = GG.CORPS;
  let corp = 'grow';
  const paces = [
    { id: 1.6, n: '极速局', d: '整局约 2 分钟', s: '开发/测试用' },
    { id: 8, n: '标准局', d: '整局约 10 分钟', s: '推荐，一次坐下来玩完' },
    { id: 3600, n: '放置局', d: '整局 3 天', s: '每天上来收菜' },
  ];
  let pace = 8;
  const sv = store.get(LS.save, null);
  const canContinue = !!(sv && sv.blob && !sv.over);
  /* 复仇开局：上一局被清算过，就可以带着遗产回来（docs/04 的结论：
     遗产 = 上局净值 12%、上限 300 G + 自选一个已点天赋；NPC 对你更狠） */
  const canRevenge = !!(sv && sv.summary && sv.summary.died);
  let revenge = false;
  const seed = GG.makeSeed(new GG.Rng(GG.hash32('ui', Date.now() % 100000)));
  const paint = () => {
    $('#ovStart').innerHTML = `
      <div class="modal" style="padding-top:0">
        <div class="mbody">
        <img class="hero" src="assets/bg-share.webp" alt="" onerror="this.remove()">
        <h2 style="margin-top:12px">割不割</h2>
        <div class="lead">种地是入场券，市场是绞肉机，拍卖是屠宰场，结算是一场颁奖礼。<br>
        你是这一带的金融巨鳄——<b>你持有公司，不是亲手种地</b>。<br>
        先挑一家作为起点。第一步：进「农田」种一茬、收一茬，再拉到「市场」卖掉。<br>
        3 个游戏天里把它做大；全场只有一个首席，但人人都有称号。</div>
        ${canContinue ? `<button class="btn p wide" id="cont" style="margin-bottom:10px">
          继续上局（第 ${sv.summary.day} 天 · ${esc(sv.summary.corpName)} · 净资产 ${fmt(sv.summary.nav)} G）</button>` : ''}
        ${canRevenge ? `<button class="corp ${revenge ? 'on' : ''}" data-revenge="1" style="margin-bottom:10px">
          <div class="t">复仇开局<span class="tag">上一局你被清算了</span></div>
          <div class="ds">带走上局净值的 12%（上限 300 G）和上一个天赋重新开始。
            代价：第 1 天全场都看得见你的标记，NPC 会重点照顾你。</div></button>` : ''}
        <div class="ct"><h3>选你的第一家公司</h3></div>
        <div class="corps">
          ${CORPS.map(c => `<button class="corp ${c.id === corp ? 'on' : ''}" data-corp="${c.id}">
            <div class="t">${esc(c.name)}<span class="tag">${esc(c.tag)}</span></div>
            <div class="ds">${esc(c.desc)}</div>
            <div class="starrow">稳定 ${starTxt(c.stars.stab)} · 利润 ${starTxt(c.stars.profit)} · 上手 ${starTxt(c.stars.ease)}</div></button>`).join('')}
        </div>
        <div class="ct"><h3>节奏</h3><span class="sub" id="paceDesc">${paces.find(x => x.id === pace).d}</span></div>
        <div class="pacerow">
          ${paces.map(p => `<button class="corp ${p.id === pace ? 'on' : ''}" data-pace="${p.id}">
            <div class="t" style="font-size:12px">${p.n}</div></button>`).join('')}
        </div>
        <div class="ct"><h3>世界种子</h3><span class="sub">同一个种子 = 同一个世界，可以和朋友对局</span></div>
        <div class="seedin">
          <input id="seedin" value="${esc(seed)}">
          <button class="btn" id="reseed">换一个</button>
        </div>
        <div class="hint" style="margin-top:9px">纯娱乐。局内没有真钱往来，也没有任何东西能换回真钱。价格由供需、事件和其他玩家一起决定。</div>
        </div><!-- /.mbody 以上可滚动；以下才是真正的固定页脚 -->
        <div class="goFoot"><button class="btn p wide" id="go">开始赛季</button></div>
      </div>`;
    /* 选中态一律「就地改 class」，不再重建 innerHTML。
       原因（用户 2026-10-08 反馈「选公司会重载/闪动」）：重建 innerHTML 会
         ① 让 .modal 的入场动画每点一次就重播一遍 → 肉眼就是闪动；
         ② 把浮层滚动位置弹回顶部；
         ③ 把用户手输/粘贴的世界种子冲回默认值（渲染的是闭包里的旧 seed）。
       sync() 只做 class 切换 + 更新节奏说明，三件事一并解决。 */
    const sync = () => {
      const box = $('#ovStart');
      box.querySelectorAll('[data-corp]').forEach(b => b.classList.toggle('on', b.dataset.corp === corp));
      box.querySelectorAll('[data-pace]').forEach(b => b.classList.toggle('on', +b.dataset.pace === pace));
      box.querySelectorAll('[data-revenge]').forEach(b => b.classList.toggle('on', revenge));
      const pd = box.querySelector('#paceDesc');
      if (pd) pd.textContent = paces.find(x => x.id === pace).d;
    };
    $('#ovStart').querySelectorAll('[data-corp]').forEach(b => b.onclick = () => { corp = b.dataset.corp; sync(); });
    $('#ovStart').querySelectorAll('[data-revenge]').forEach(b => b.onclick = () => { revenge = !revenge; sync(); });
    const cont = $('#cont'); if (cont) cont.onclick = () => continueSave();
    $('#ovStart').querySelectorAll('[data-pace]').forEach(b => b.onclick = () => { pace = +b.dataset.pace; sync(); });
    $('#reseed').onclick = () => {
      $('#seedin').value = GG.makeSeed(new GG.Rng(GG.hash32('ui', (Date.now() ^ (Math.random() * 1e6)) >>> 0)));
    };
    $('#go').onclick = () => {
      if (revenge && sv && sv.summary) {
        start(corp, $('#seedin').value.trim() || undefined, pace, {
          nav: sv.summary.nav, talentId: (store.get(LS.save, {}).summary || {}).talentId || HUMAN_LAST_TALENT,
        });
      } else start(corp, $('#seedin').value.trim() || undefined, pace);
    };
  };
  paint();
  $('#ovStart').classList.remove('hide');
}

let HUMAN_LAST_TALENT = null;   // 复仇开局时默认带走上一个天赋
function start(corp, seed, pace, inheritance) {
  ui.pace = pace;
  G = new GG.Game({ seed, corp, npcs: 3, secPerGameHour: pace, inheritance });
  HUMAN = G.s.players.find(p => p.id === G.s.humanId);
  ui.seen = 0; ui.qty = {}; ui.talentFor = 0; ui.warnShown = false; ui.recorded = false;
  if (!inheritance) clearSave();
  $('#ovStart').classList.add('hide');
  $('#corp').textContent = HUMAN.corpName;
  setSpeed(1);
  // 只播引擎那条开局日志，避免同一条消息弹两次（试玩时发现的重复）
  toast('赛季 ' + G.s.seed + ' 开始。本局规矩：' + G._ruleText(), 'info', 4600);
  render(true);
}

/* ---------- 速度 ---------- */
function setSpeed(mult) {
  if (!G) return;
  G.s.speed = mult;
  G.s.paused = mult === 0;
  document.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('on', +b.dataset.sp === mult));
}

/* ---------- 顶栏 ---------- */
