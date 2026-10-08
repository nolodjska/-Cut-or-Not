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
    out.push('<button class="alert" data-root="bank">⚠ 现金已经是负的（' + fmt(HUMAN.cash) + ' G），钱庄随时上门</button>');
  }
  if (sheet.debt > 0 && sheet.nav < sheet.debt * GG.BAL.maintRatio * 1.5) {
    out.push('<button class="alert" data-root="bank">⚠ 欠的账快赶上手里的家底了</button>');
  }
  const a = G.s.auction;
  if (a && a.phase !== 'done') {
    const end = a.phase === 'sealed' ? a.sealedEndT : a.openEndT;
    out.push('<button class="alert" data-root="auction">⚠ 拍卖会进行中，剩 ' + secLeftTxt(end - G.s.t) + '</button>');
  }
  /* 收尾：待读的信也缀在告急带尾部（docs/20 §2.1 把“告急带 → 信匣”定成一条路）。
     没有这行，信匣就只能靠顶栏那颗小印章发现 —— 新手根本不会去点。
     ⚠ 走 data-root（一级屏切换），不能用 data-view：后者会把 ui.root 复位成二级。 */
  const un = mailUnread();
  if (un) out.push('<button class="alert" data-root="mail">✉ ' + un + ' 封没读的信</button>');
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

/* 进店行的一个键（Z4）。dot = 带红点。 */
function shopBtn(mode, name, dot) {
  return '<button class="shopbtn" data-root="' + mode + '">' + name +
    (dot ? '<span class="dot"></span>' : '') + '</button>';
}

/* Z3 股东会（docs/19 §4.13）：提案 + 表决。
   ⚠ 只在**自己主控**的公司上出现 —— 参股的公司轮不到你提案（§4.13 明写）。
   ⚠ “还没表态 / 同意 / 不同意”必须分开写：同一个按钮点过之后要看得出来已记下了。 */
function decisionBlock() {
  const s = G.s;
  const decs = (s.decisions || []).filter(x => x.corpId === HUMAN.corp && x.status === 'open');
  if (!decs.length) {
    return '<div class="ct"><h3>股东会</h3><span class="sub">没在议的事</span></div>' +
      '<div class="firm"><div class="fmain">' +
        '<div class="fl">想把公司赚的钱发一点到手上，就提个议，股东们表个态。</div>' +
      '</div><div class="fact">' +
        '<button class="btn" data-act="dividend">提议分钱</button>' +
      '</div></div>';
  }
  return '<div class="ct"><h3>股东会</h3><span class="sub">正在议</span></div>' +
    decs.map(dec => {
      const left = Math.max(0, Math.ceil((dec.dueT - s.t) / 60));
      const mine = dec.voters[HUMAN.id];
      return '<div class="firm"><div class="fmain">' +
        '<div class="ft">' + esc(dec.label) + '</div>' +
        '<div class="fl">还剩 ' + left + ' 游戏小时 · ' +
          (mine ? (mine === 'for' ? '你已经同意' : '你已经不同意') : '你还没表态') + '</div>' +
      '</div><div class="fact">' +
        (mine ? '' :
          '<button class="btn p" data-act="votefor" data-id="' + dec.id + '">同意</button>' +
          '<button class="btn" data-act="voteagainst" data-id="' + dec.id + '">不同意</button>') +
      '</div></div>';
    }).join('');
}

/* Z3b 名录与名次（docs/19 §4.6）+ 找人谈事（docs/19 §4.9）。
   ⚠ 榜单读引擎的 G.standings()，UI **不自己排序、不自己算身价** ——
     两处各算一遍必然对不上（本项目踩过“面板价 vs 成交价”）。
   ⚠ 三颗按钮一律 data-act + data-*：wiring-check 会替我验证它们真的接到了分派表。 */
function boardSection() {
  const rows = (G && G.standings) ? G.standings() : [];
  if (!rows.length) return '';
  const list = rows.map(r => {
    const me = r.pid === G.s.humanId;
    const talk = me ? '' :
      '<span class="chips">' +
        '<button class="btn" data-act="contact" data-kind="borrow" data-to="' + r.pid + '">借钱</button>' +
        '<button class="btn" data-act="contact" data-kind="jv" data-to="' + r.pid + '">买他股份</button>' +
        '<button class="btn" data-act="contact" data-kind="invite" data-to="' + r.pid + '">请他议事</button>' +
      '</span>';
    /* 你已经占了人家多少、离下一道门槛还差多远（docs/19 §4.11 B 要求“每个节点都要有说明文本”）。
       门槛表读引擎的 G.rights()，UI 不自己写一份 —— 两处各写一遍必然会对不上。 */
    let mine = '';
    if (!me && G.rights) {
      const rr = G.rights(HUMAN, r.pid);
      if (rr.stake > 0) {
        mine = ' · 你占 ' + Math.round(rr.stake * 100) + '%' +
          (rr.next ? '（再过 ' + ((rr.next.at - rr.stake) * 100).toFixed(1) + '% 可' + esc(rr.next.label) + '）' : '');
      }
    }
    return '<div class="firm">' +
      '<div class="fmain">' +
        '<div class="ft">' + r.rank + '. ' + esc(r.name) +
          (me ? '<span class="tag">你</span>' : '') + '</div>' +
        '<div class="fl">' + esc(r.corpName) + ' · 身价 ' + fmt(r.nav) + ' G' +
          (r.debt > 0 ? ' · 欠着 ' + fmt(r.debt) + ' G' : '') + mine + '</div>' +
      '</div>' +
      (talk ? '<div class="fact">' + talk + '</div>' : '') +
    '</div>';
  }).join('');
  return '<div class="ct"><h3>公司名录 · 名次</h3><span class="sub">共 ' + rows.length +
    ' 家 · 实时</span></div><div class="firms">' + list + '</div>';
}

function viewLedger() {
  const book = ledgerBook();
  const belt = ledgerBelt();
  const held = book.filter(r => !r.mine).length;

  return '<div class="ledger">' +
    /* Z0 身价**不在这里画**：docs/20 §2.1 的 Z0 就是「顶栏」本身
       （身价印章超大字 · 现金 · 授信 · 日子），不是正文里的一张卡。
       我第一版把它当正文卡片画，结果同一个数在一屏里挂了三个标签
       （顶栏大字 / 身价卡 / 公司卡家底）—— 正是 §0「三个钱数永不同屏并列」要防的事。
       现在顶栏那个大字已经改成身价（08-chrome），本屏从 Z1 告急带开始。 */

    /* Z1 告急带：有内容才显（空数组 = 整条不占屏）。已是一段现成 HTML，直出。 */
    (belt.length ? '<div class="belt">' + belt.join('') + '</div>' : '') +

    /* Z2 控股地图 */
    '<div class="ct"><h3>手里的公司</h3><span class="sub">共 ' + book.length + ' 家' +
      (held ? '（参股 ' + held + ' 家）' : '') + '</span></div>' +
    '<div class="firms">' + book.map(r =>
      /* 卡内布局：左边文字（公司名 + 状态章 + 持股/家底），右边动作按钮。
         ⚠ 原来是「文字两行 + 按钮独占第三行」，卡片被撑成三行、按钮吊在左下角；
           2026-10-08 玩家要求改用左右分布 —— 卡片矮一截，也不用再往下扫一眼找按钮。
         ⚠ 两层包装（.fmain / .fact）是必需的：只给按钮 float/absolute 的话，
           公司名一长就会压到按钮底下（.fmain 的 min-width:0 才是那个“允许被挤”的开关）。 */
      '<div class="firm">' +
        '<div class="fmain">' +
          '<div class="ft">' + esc(r.name) + '<span class="tag">' +
            (r.control >= 0.5 ? '控股' : '参股') + '</span></div>' +
          '<div class="fl"><span class="lamp ' + r.lamp + '"></span>持股 ' +
            Math.round(r.stake * 100) + '% · 家底 ' + fmt(r.nav) + ' G' +
            /* 估值与家底**并列但分清**（§4.6）：家底是你按股比拿到的那部分，
               估值是“整家公司要卖，市场肯出多少”。两个数不一样，是故意的。 */
            (r.mine ? ' · 估值 ' + fmt(G.valuation(HUMAN)) + ' G' : '') + '</div>' +
        '</div>' +
        '<div class="fact">' +
          (r.control >= 0.5
            ? '<button class="btn p" data-enter="' + r.id + '">进入经营</button>' +
              /* §4.12：只在**自己主控**的那家公司上出现 —— “从公司拿钱”是股东与公司之间的事，
                 参股的公司轮不到你插手。拿的是借款、要还，所以身价不变。
                 ⚠ 用 data-act（不用自定义 data-*）：这样 wiring-check 会**自动验证**这颗按钮
                   真的接到了分派表上 —— 当年“工坊修不了”就是一颗没人接的死按钮。 */
              (r.mine ? '<button class="btn" data-act="take">从公司拿钱</button>' : '')
            /* §4.10 上市：发股份换现金。⚠ 只在**自己主控**的公司上出现。 */
            + (r.mine ? '<button class="btn" data-act="ipo">发股份募资</button>' : '')
            : '<button class="btn" disabled>只参股，不下手</button>') +
        '</div>' +
      '</div>').join('') + '</div>' +

    decisionBlock() +

    boardSection() +

    /* Z4 进店行（docs/20 §2.1）：低频重功能收口成一行，把屏幕让给 Z2。
       ⚠ 2026-10-08 玩家要求把 市场/情报/钱庄/拍卖/图鉴 从底栏**搬到总账** ——
         它们本来就是全局动作（行情 / 情报行 / 钱庄 / 拍卖会 / 图鉴），不是“这家公司的活”；
         挂在底栏会两头打架：底栏说“这家公司”，而那几屏与哪家公司无关。
       ⚠ 一律走 data-root：用 data-view 会把 ui.root 复位成二级，画面不变（R1 那个 bug 的成因），
         而且底栏会冒出农田/制造页签。
       ⚠ 拍卖那个红点原本在底栏页签上，跟着搬过来 —— 信号不因为搬家就丢掉。 */
    '<div class="shop">' +
      shopBtn('market', '市场') + shopBtn('intel', '情报') +
      shopBtn('bank', '钱庄') + shopBtn('auction', '拍卖', !!(G.s.auction && G.s.auction.phase !== 'done')) +
      shopBtn('codex', '图鉴') +
    '</div>' +

  '</div>';
  /* Z3「组合摘要」本批**故意不画**（code-reviewer 子代理扫出的 R4）：
     它当时只能写「名下合计 = 身价」，同一组数字在屏幕上挂了四个标签
     （顶栏大数字 / 身价 / 自公司卡家底 / 名下合计），正是 docs/20 §0
     “三个钱数不得同屏并列”要防的事。
     docs/20 §2.1 对 Z3 的定义是「组合总浮盈 + 今日/本季派红」——
     这两项都要等派红与行情落地才有数据，届时再画才是真信息。 */
}
