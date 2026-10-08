/* ===== part: 08-chrome.js ===== */
function renderTop() {
  const s = G.s;
  /* 顶栏永远是“我”（集团），底栏永远是“这家公司”（docs/20 §2.3）。
     · 一级（总账）：crumb 显示 🏠 总账，**不出现公司名**；
     · 二级（公司工作台）：crumb 变成「← 集团」，回根入口恒在左上角，
       不用滚到页顶去找。
     ⚠ crumb 必须走事件委托（data-root），不能绑 onclick：
       #clock 每 120ms 被重写一次，绑在节点上的 handler 会跟着节点一起销毁 ——
       那就是“按钮不灵、要点好几下”那个老坑。 */
  /* 面包屑（docs/20 §2.3）：左上角恒有“回上一层”的路。
     ⚠ 一级屏从布尔变模式串之后，这里必须**按模式分档**：
       原来只有“ui.root 假=二级 / 真=总账”两档，于是进了信匣之后左上角
       变成不可点的 <b>🏠 总账</b> —— 既写错了“你现在在哪”，又**没有出路**
       （信匣成了死胡同，只能刷新页面逃出来）。2026-10-08 真机截图看出来的。
     ⚠ 二级那一档的 data-root 从 "1" 改成 "ledger"：两个值都能用（分派里
       非 'mail' 一律当作 'ledger'），但写明白才不会让下一个人以为是随便填的。 */
  const crumb = !ui.root
    ? '<button class="crumb" data-root="ledger">← 集团</button>'
    : (ui.root === 'mail'
      ? '<button class="crumb" data-root="ledger">← 总账</button>'
      : '<b class="crumb on">🏠 总账</b>');
  $('#clock').innerHTML = crumb + '第 <b>' + dayOf(s.t) + '</b> 天 <b>' + hhmm(s.t) + '</b>' +
    (ui.root ? '' : ' · ' + esc(HUMAN.corpName)) + mailSeal();
  /* ⚠ 顶栏最大字必须是【身价】（集团层并表），不是单一公司的净资产
     （docs/20 §0 三个钱数永不同屏并列 / §2.1 的 Z0 定就是身价）。
     单人公司时两个数相等，所以这个错一直看不见；一旦手里有第二家公司
     （参股 / 控股），顶栏就会开始说谎 —— 而它是玩家判断“我值多少”的唯一大字。
     ⚠ 必须与 index.html 的 #navlab 文案同步（那里原本写的是「净资产」）。 */
  $('#navbig').innerHTML = fmt(G.consolidated(HUMAN).nav) + '<small>G</small>';
  const invV = G.inventoryValue(HUMAN), debt = HUMAN.debt + G.shortLiability(HUMAN);
  /* 四个指标压进一行：净资产在左（大字号），现金/库存/欠款在右。
     改造前 #navmeta 用 <br> 排成两行、净资产再独占一行，#top 一共 145px（占手机 17% 屏高）。
     间距交给 #navmeta 的 flex gap，所以这里只输出三个 span。 */
  /* ⚠ 2026-10-08（第 2 轮试玩）：试玩员看不懂两件事，都出在这一行：
     ① 「G 是什么的单位？」—— 三个小指标原本**连单位都没有**，而大字号那边写「10,000 G」，
        两者贴着出现，玩家「连这是不是钱都定不下来」。现在三个都补上 G。
     ② 「库存 319 是怎么来的？6 块地为什么是 319？」—— 因为这里显示的是
        `inventoryValue`（**货值，钱的数额**），不是**件数**。
        原来叫「库存」，与“件数”混淆。改为「货值」。
        （货 = 手头上还没卖掉的存货，这个说法在农田/市场页已经出现过，不是新词。） */
  $('#navmeta').innerHTML =
    '<span>现金 <b class="mono">' + fmt(HUMAN.cash) + ' G</b></span>' +
    '<span>货值 <b class="mono">' + fmt(invV) + ' G</b></span>' +
    '<span>欠款 <b class="mono ' + (debt > 0 ? 'down' : '') + '">' + fmt(debt) + ' G</b></span>';
  $('#dayfill').style.width = Math.min(100, (s.t / (GG.BAL.days * 1440)) * 100) + '%';
  /* 倒计时 / 拍卖这类时效信息加粗染红；平时的阶段句保持淡色小字 */
  const pt = $('#phasetag');
  pt.textContent = s.over ? '赛季已结束' : phaseText();
  if (!s.over && (s.countdown || (s.auction && s.auction.phase !== 'done'))) pt.dataset.urgent = '1';
  else delete pt.dataset.urgent;
  /* 高亮"当前档"这一个按钮。
     原来写的是 `+b.dataset.sp === s.paused ? 0 : s.speed`：因为 === 优先级高于 ?:，
     实际等价于 `(+b.dataset.sp === s.paused) ? 0 : s.speed`，而数字 === 布尔值恒为 false，
     于是永远传 s.speed —— 运行时 4 个键全亮、暂停时全灭。而且 renderTop() 每 120ms 跑一次。
     现在与 setSpeed() 里的口径统一：暂停看 data-sp=0，否则看 data-sp=speed。 */
  const cur = s.paused ? 0 : s.speed;
  document.querySelectorAll('.sbtn').forEach(b => b.classList.toggle('on', +b.dataset.sp === cur));
}

/* ---------- 标签 ---------- */
function renderTabs() {
  /* 一级根屏**没有 tab**（docs/20 §2.1 Z5）：tab 属于二级公司层，
     两套导航同屏必打架（430px 下互抢空间，层级也错位）。 */
  if (ui.root) {
    const b = $('#tabs');
    if (b.innerHTML !== '') b.innerHTML = '';
    return;
  }
  const s = G.s;
  const tabs = [
    ['farm', '农田'], ['make', '制造'], ['market', '市场'], ['intel', '情报'], ['bank', '钱庄'],
    ['auction', '拍卖'], ['codex', '图鉴'], ['end', '结算'],
  ];
  const dot = {};
  if (s.auction && s.auction.phase !== 'done') dot.auction = 1;
  if (HUMAN.talentOffers) dot.farm = 1;
  if (HUMAN.craftJobs.length) dot.make = 1;
  if (s.over) dot.end = 1;
  const html = tabs.map(([k, n]) => {
    if (k === 'end' && !s.over) return '';
    return `<button class="tab ${view === k ? 'on' : ''}" data-view="${k}">${n}${dot[k] ? '<span class="dot"></span>' : ''}</button>`;
  }).join('');
  /* 内容没变就别碰 DOM。
     以前这里是无脑 innerHTML = ...，而 render() 每 120ms 跑一次：
     一次人手点击的 mousedown→mouseup 常在 80~150ms，正好会跨过一次重建，
     此时浏览器把 click 派发到共同祖先 #tabs（它没有 data-view），
     事件委托里 e.target.closest('button,[data-view]') 拿到 null，点击被静默吞掉 ——
     表现就是“点标签没反应”。 */
  const box = $('#tabs');
  if (box.innerHTML === html) return;
  box.innerHTML = html;
}

/* ---------- 视图：农田 ---------- */
function warnBox() {
  const out = [];
  if (HUMAN.cash < 0) out.push('现金已经是负的。卖掉点货或者去钱庄借，' + GG.BAL.graceHours + ' 小时内没补上，就要拿地、货、公司抵债。');
  /* 只给现象，不给术语（docs/13 §16）：玩家看到的是“欠的账快赶上家底了”，
     不是“维持线”“百分比”。1.5 倍阈值只为提前预警，界面上不出现任何口径数字。 */
  const _sheet = G.consolidated(HUMAN);
  if (_sheet.debt > 0 && _sheet.nav < _sheet.debt * GG.BAL.maintRatio * 1.5) {
    out.push('你欠的账（' + fmt(_sheet.debt) + ' G）快赶上手里的家底（' + fmt(_sheet.nav) + ' G）了 —— 债主随时可能上门。');
  }
  const rent = HUMAN.plots.length * GG.BAL.plotRentPerDay;
  if (HUMAN.cash < rent * 1.2) out.push('你的现金快付不起地租了（' + rent + ' G/天）。');
  if (!out.length) return '';
  return out.map(t => '<div class="warn">⚠ ' + t + '</div>').join('');
}

