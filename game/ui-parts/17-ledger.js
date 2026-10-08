/* ===== part: 17-ledger.js ===== */
/* 一级 · 集团层根屏「总账」（docs/20 §1.1 / §2.1 / §7 第一批）。
 *
 * 为什么先做它：一级屏定义「集团 ↔ 公司」的**唯一接口**（docs/19 §4.5 的公司卡）。
 * 没有它，后面每个面板都得自己猜层级。
 *
 * 本批只做「读」（docs/19 §6：骨架先只读不交易）：
 *   一屏看清「我值多少 / 手里有什么 / 有什么要出事」。
 *
 * ⚠ 三个钱数永不同屏并列（docs/20 §0）：
 *     本屏只出现【身价】（集团层并表 G.consolidated）；
 *     公司净资产只进公司卡；市值只该出现在「行市」（尚未落地）。
 * ⚠ 术语不上屏（docs/20 §6 双名制）：只说现象人话。
 * ⚠ 导航键一律用 data-root / data-enter，**不能用 data-corp**
 *     （15-events 里 `if (d.corp || d.pace) return;` 会把它吞掉）。
 */

/* 告急带（Z1）：把「会出事」的提到眼前。
   资产不会自己少，但决议会超时、要约会过期、杠杆会被强平 —— 所以它排在资产列表之上。
   ⚠ 本批只能取引擎已有的来源：现金转负 / 追保（并表负债逼近家底）/ 拍卖进行中。
     决议倒计时、要约到期、评估过期要等对应系统落地；返回空数组时整条不占屏。
   ⚠ 这里直接返回**拼好的 HTML**，而不是「{文字, 视图名} 数据」。
     tools/wiring-check.cjs 的【页签 → 视图函数】检查是**静态扫源码**的，
     它只认得属性值当场写成字面量的那种（如 bank / auction）；一旦把变量拼进去，
     它就解析不出来，报“map 里没这个视图、点了会回落 viewFarm”。
     ——而这个警告是对的：那个变量的值**没有任何东西能静态保证**，写错就是静默回落。
     ⚠ 这段注释本身也不能出现那个属性的“赋值形态”字面量：
       它是盲扫正则、注释也照扫（我已因此把“反面示例”照抄一遍而报假错）。 */
function ledgerBelt() {
  const out = [];
  const sheet = G.consolidated(HUMAN);
  if (HUMAN.cash < 0) {
    out.push('<button class="alert" data-view="bank">⚠ 现金已经是负的（' + fmt(HUMAN.cash) + ' G），钱庄随时上门</button>');
  }
  if (sheet.debt > 0 && sheet.nav < sheet.debt * GG.BAL.maintRatio * 1.5) {
    out.push('<button class="alert" data-view="bank">⚠ 欠的账快赶上手里的家底了</button>');
  }
  const a = G.s.auction;
  if (a && a.phase !== 'done') {
    const end = a.phase === 'sealed' ? a.sealedEndT : a.openEndT;
    out.push('<button class="alert" data-view="auction">⚠ 拍卖会进行中，剩 ' + secLeftTxt(end - G.s.t) + '</button>');
  }
  return out;
}

/* 健康度灯：不写字，只看「欠的钱 ÷ 家底」落在哪一档。
   阈值与 08-chrome 的 warnBox 同一口径（maintRatio × 1.5），避免两处说法打架。 */
function ledgerLamp(sheet) {
  if (sheet.debt <= 0) return 'ok';
  if (sheet.nav <= 0) return 'bad';
  const ratio = sheet.debt / sheet.nav;
  if (ratio >= 1 / (GG.BAL.maintRatio * 1.5)) return 'bad';
  if (ratio >= 0.5) return 'mid';
  return 'ok';
}

/* 持股名册：把 holdings 摊平成「一张卡一家公司」。
   ⚠ 不能只画主控公司：docs/19 §4.5 的参股也要有卡（参股卡只读、不进 route UI）。
   旧存档兼容口径与 05-firm.js 的 consolidated() 保持一致（没有 holdings 时只有自己一家）。 */
function ledgerBook() {
  const rows = [];
  const hs = (Array.isArray(HUMAN.holdings) && HUMAN.holdings.length)
    ? HUMAN.holdings.filter(h => !h.bankrupt)
    : [{ corpId: HUMAN.corp, stake: 1, control: 1, debt: 0 }];
  for (const h of hs) {
    const mine = h.corpId === HUMAN.corp;
    const c = GG.CORPS.find(x => x.id === h.corpId) || {};
    const sheet = mine
      ? { nav: G.nav(HUMAN), debt: (HUMAN.debt || 0) + G.shortLiability(HUMAN) }
      : { nav: h.navSnapshot || 0, debt: h.debt || 0 };
    const control = h.control == null ? 1 : h.control;
    rows.push({
      id: h.corpId,
      name: mine ? HUMAN.corpName : (c.name || h.corpId),
      stake: h.stake == null ? 1 : h.stake,
      control,
      mine,
      nav: sheet.nav,
      debt: sheet.debt,
      lamp: ledgerLamp(sheet),
    });
  }
  return rows;
}

function viewLedger() {
  const sheet = G.consolidated(HUMAN);
  const book = ledgerBook();
  const belt = ledgerBelt();
  const held = book.filter(r => !r.mine).length;

  return '<div class="ledger">' +
    /* Z0 身价：本屏唯一的大字（顶栏那个数仍归公司层，本批不动它 —— 见 docs/20 §0 待办） */
    '<div class="worth">' +
      '<div class="wlab">身价</div>' +
      '<div class="wnum">' + fmt(sheet.nav) + '<small>G</small></div>' +
      '<div class="wsub">手上的现金 ' + fmt(HUMAN.cash + (HUMAN.deposit || 0)) + ' G' +
        ' · 欠着 ' + fmt(sheet.debt) + ' G' +
        ' · 还能借 ' + fmt(G.creditLimit(HUMAN)) + ' G</div>' +
    '</div>' +

    /* Z1 告急带：有内容才显（空数组 = 整条不占屏）。已是一段现成 HTML，直出。 */
    (belt.length ? '<div class="belt">' + belt.join('') + '</div>' : '') +

    /* Z2 控股地图 */
    '<div class="ct"><h3>手里的公司</h3><span class="sub">共 ' + book.length + ' 家' +
      (held ? '（参股 ' + held + ' 家）' : '') + '</span></div>' +
    '<div class="firms">' + book.map(r =>
      '<div class="firm">' +
        '<div class="ft">' + esc(r.name) + '<span class="tag">' +
          (r.control >= 0.5 ? '控股' : '参股') + '</span></div>' +
        '<div class="fl"><span class="lamp ' + r.lamp + '"></span>持股 ' +
          Math.round(r.stake * 100) + '% · 家底 ' + fmt(r.nav) + ' G</div>' +
        (r.control >= 0.5
          ? '<button class="btn p" data-enter="' + r.id + '">进入经营</button>'
          : '<button class="btn" disabled>只参股，不下手</button>') +
      '</div>').join('') + '</div>' +

  '</div>';
  /* Z3「组合摘要」本批**故意不画**（code-reviewer 子代理扫出的 R4）：
     它当时只能写「名下合计 = 身价」，同一组数字在屏幕上挂了四个标签
     （顶栏大数字 / 身价 / 自公司卡家底 / 名下合计），正是 docs/20 §0
     “三个钱数不得同屏并列”要防的事。
     docs/20 §2.1 对 Z3 的定义是「组合总浮盈 + 今日/本季派红」——
     这两项都要等派红与行情落地才有数据，届时再画才是真信息。 */
}
