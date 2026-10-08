/* ===== part: 01-data.js ===== */
/* ---------------------------------------------------------------------------
 * 0. 平衡常量（唯一权威来源；docs/06 与 docs/09 镜像本表）
 * -------------------------------------------------------------------------*/
const BAL = {
  version: 'demo-0.1',
  days: 3,

  // 开局
  startCash: 8000,
  startPlots: 4,
  plotCost: 500,              // 单块地重置价（用于 NAV 估值）
  plotExpandCost: [1200, 1800, 2600, 3500],  // 第 5~8 块地
  maxPlots: 8,
  storageCap: 200,
  storageUpgradeCost: 1500,
  storageUpgradeStep: 200,
  autoPlotCost: 900,          // 自动收割（放置化）
  workshopCost: 1500,         // 作坊（制造公司的加工设施），第 2 间起 1000
  workshopCost2: 1000,
  plotUpgradeCost: 2000,      // 高产地：单产 ×1.5
  plotUpgradeMult: 1.5,

  // 市场
  marketFee: 0.015,           // 单边手续费 1.5%（成交价改诚实结算后从 2% 下调，让择时有合理回报）
  depthMult: 5,               // 市场深度 = NPC 日吸纳量 × 5（滑点更温和，鼓励多做几轮）
  /* §17.1 收货商：当日胃口见底之后，他往死里压价。
     注意：**不拒绝成交** —— 拒绝会让“有货卖不掉又缺现金”变成死局，
     而症状要传达的是“他吃不下这么多了”，不是“游戏不让你卖”。 */
  dealerFullMult: 2.5,
  /* §17.1 额度：你自己一天能卖给他多少。
     ⚠ 2026-10-08 试玩员实测拓出的一个大 bug：原先额度是**全市场**口径，
        NPC 几分钟就把萝卜的 800 吃光 → 玩家的牌子**永远是「收满了」**，
        他一次都看不到正常状态，而且每一单都吃 ×2.5。
        这同时违反了 §17.0 判据 3（NPC 在卖是玩家看不见的原因）。
     ⇒ 改成按玩家计，额度 = absorbDay × dealerQuotaMult（萝卜→80）。 */
  dealerQuotaMult: 0.10,
  dealerQuotaMin: 20,
  policyFeeMult: 2.0,         // 政策变动：手续费翻倍
  priceRevertHalfLifeH: 14,   // 价格向锚回归半衰期（放慢，让价差有机会存在）
  anchorRevertHalfLifeH: 24,  // 锚向基准回归半衰期
  anchorImpactShare: 0.4,     // 交易对锚的传导比例（决定打压的持久性）
  importValveMult: 1.55,      // 进口阀门：价格带上沿（1.45 → 1.55，价差空间更够用）
  floorBuyerMult: 0.65,       // 地板买家：价格带下沿（0.70 → 0.65）
  /* §17.2 ② 上门的买家 —— 三类人的脾气（docs/13 §17.2）。
     ⚠ 这是**唯一的外部需求**（钱从外面进来），必须夹死上限。
        本项目被“印钱机”坑过两次（往返套利 200 轮净赚 123,231 G；产品锚失控把辣酱推到 36 万），不再犯。
     三道夹子：① 每类每日总量 cap ② 豪客每局只来一次 ③ 出价夹在价格带内 */
  buyers: {
    hood:     { name: '街坊',   icon: '🧺', px: 0.88, cap: 60, growPerDay: 1.5,
                cheapOnly: true, blurb: '他<b>只认便宜货</b>——行价一贵他就不来了' },
    workshop: { name: '作坊主', icon: '🔨', px: 1.02, cap: 25, growPerDay: 1.0, satMult: 0.4,
                blurb: '他<b>拿回去加工的，贵也得买</b>——所以价涨了他还在' },
    tycoon:   { name: '豪客',   icon: '🎩', px: 1.25, cap: 12, growPerDay: 0, once: true,
                blurb: '他<b>只来这一趟</b>，出价高' },
  },
  buyerComeChance: 0.85,  // 他今天来不来的概率（确定性伪随机，不动主 RNG 流）
  buyerSat: 0.0012,       // 同一个买家，你今天每卖他 1 单位，他后面出价就低 0.12%
                          // ⚠ 这个值是按 docs/13 §17.2 自己的例子反推的：
                          //    萝卜基准 10，街坊原价 0.88×10 = 8.8；卖了 60 单位后
                          //    8.8 × (1 − 0.0012×60) = 8.8 × 0.928 = **8.17 ≈ 8.2**
                          //    —— 正好落到它那句「再卖他，他只肯出 8.2」上。
  buyerRegularAt: 3,      // 见过 3 次 → 回头客
  buyerRegularBonus: 1.05,// 回头客出价略高（这 5% 就是 brand 终于长出的可见形态）
  rotLossMult: 0.5,           // 腐坏损失（按市值计）

  // 银行（NPC 公共设施）
  depositRateDay: 0.004,
  loanRateDay: 0.025,
  maxDebtRatio: 0.70,
  maxLoanAbs: 14000,          // 授信绝对上限（Demo）：切断"自我抬价→授信膨胀"的正反馈
  plotRentPerDay: 40,         // 地租：每块地每天 25 G，用现金付，扩地要付得起养得起
  arrearsLimit: 400,          // ⚠ 已废（docs/13 §4.3）：负债本身永远不是破产理由，改由 maintRatio 判。保留此键只为旧存档兼容，引擎不再读它。
  maintRatio: 0.30,           // 维持线：净资产 / 总负债 ≥ 0.30。跌破 → 发追保通知（docs/13 §4.2）
  graceHours: 6,              // 追保窗口（原“现金流断裂宽限期”）：逾期未补 → 破产清算
  liquidationHaircut: 0.30,   // 强制变卖折价 30%

  // 借货看跌（原名"做空"，UI 禁用该词）
  shortMargin: 1.50,          // 押金 = 名义本金 × 150%
  shortBorrowFeeDay: 0.005,
  shortLiqMove: 0.30,         // 不利波动 >30% 被动清盘

  // 情报
  intelInsiderPrice: 300,
  intelInsiderAcc: 0.80,
  intelSecretAcc: 0.95,
  intelLeadH: 4,              // 内幕情报提前量（游戏小时）
  intelCooldownH: 6,          // 两次买内幕之间的最短间隔（同一条消息只能买一次）

  // 舆论
  rumorCost: 200,
  rumorShift: 0.10,           // 锚 ±10%
  rumorDurH: 3,
  rumorCooldownH: 2,          // 两次放消息之间的最短间隔
  rumorExposeChance: 0.25,

  // 皮包公司
  shellCost: 800,
  shellUpkeepDay: 60,
  shellCoverPerUnit: 0.06,    // 每 100 G 隐蔽度成本
  shellExposeBase: 0.04,      // 每游戏小时的暴露基础概率

  // 垄断
  monoCountdownH: 12,         // 达成垄断后的终局倒计时（8→12：实测垄断率 67%→57%，更接近设计值）
  monoAbsorbWeight: 0.37,     // 分母里计入的未来到货量 = NPC 日吸纳 × 0.37（直接杠杆：越大越难垄断；0.34→80% 垄断，0.40→25%）
  monoMinValue: 2500,         // 低于这个金额的仓位不算控盘，防止顺手垄断一个便宜小市场
  monoMaxDebtRatio: 0.75,     // 负债率超过这个值就不算"锁住市场"

  // 拍卖
  /* 拍卖窗口用「真实秒」定义，而不是游戏小时 —— 拍卖是同步的社交事件，
     节奏要对人友好，不该跟着世界压缩比一起被压扁。
     （踩过的坑：按游戏小时定义时，明标阶段在标准局里只持续 2.7 真实秒，
       玩家根本来不及出价。） */
  auctionSealedSec: 30,       // 暗标窗口：真实 30 秒
  auctionOpenSec: 25,         // 明标窗口：真实 25 秒
  auctionSoftCloseSec: 4,     // 软延时步长：真实 4 秒
  auctionWreckSealedSec: 20,  // 破产资产包（突发）：真实 20 秒
  auctionSoftCloseMax: 6,
  auctionFee: 0.05,           // 拍卖行抽成
  bidDepositRate: 0.10,       // 押金 = 标的价值 × 10%

  // 成长
  npcCpMult: 0.35,            // NPC 的资本点数产出系数（NPC 全天在线，不折一下会碾压玩家的成长曲线）
  cpPerHarvestGold: 0.05,     // 每 1 G 收成 → CP
  cpPerTradeVolume: 0.02,
  cpLevels: [40, 110, 210, 350, 530, 760, 1050, 1400, 1820],
  /* 决议表决窗口（docs/19 §4.13）：24 游戏小时 = 1 天。
     给足一天是为了让“没人理”这个状态真的会发生 ——
     否则它只是因为玩家没看见就被判死，那是把“沉默”当成了“否决”。 */
  decisionHours: 24,
  /* ---- 地皮（docs/19 §4.16）：使用 × 地段 ----
     取值定在“**粮田 · 城郊** = plotExpandCost[idx] 本身”上，
     所以**默认地块的价钱与加这条机制之前逐位一致** ——
     加机制不许顺手改平衡（改平衡要单独一刀、单独一份守卫）。
     ⚠ 只有“使用”会**改单产**（所以它是个真选择）；
       “地段”目前只影响地价 —— 它的卖货效应还没实现，
        所以在 UI 上暂时不暴露，免得让玩家花真钱做一个假选择。 */
  landUseMult:      { grain: 1.0, cash: 1.25, facility: 1.6 },
  landDistrictMult: { suburb: 1.0, town: 0.8, core: 1.45 },
  landUseYield:     { grain: 1.0, cash: 1.15, facility: 0.75 },
  landUses: ['grain', 'cash', 'facility'],
  landUseName: { grain: '粮田', cash: '经济作物地', facility: '设施用地' },
  landDistrictName: { suburb: '城郊', town: '镇上', core: '核心地段' },
  /* ---- 估值与上市（docs/19 §4.6 / §4.10）----
     估值 = 可辨认净资产 × 可比乘数，乘数按公司类型给：
     “同一块钱的家底，在不同行当里被市场给不同价”的最简模型。
     ⚠ 估值 ≠ 身价：身价 = 你按**持股比例**拿到的那部分净资产；
       估值 = “整家公司要卖，市场肯出多少”。两者差的就是行当溢价。 */
  corpMult: { grow: 1.0, trade: 1.15, intel: 1.35, shell: 1.25, make: 1.40, fin: 1.30 },
  ipoMaxGive: 0.35,      // 一次发行最多让出的股份
  ipoFeeRate: 0.03,      // 发行费用（从募资里扣）
};

/* 作物表：数值镜像 docs/06 §5 */
const CROPS = [
  { id:'radish', name:'萝卜', icon:'🥕', growH:2,  seed:44, yld:5,  base:10, float0:300, hold0:150,
    eta:3.0, absorbDay:800, vol:0.15, rotH:48, mono:0.60, tier:'入门',
    note:'现金流快、价格容量小，适合练手；但产多了会怎样，卖一次就知道了。' },
  { id:'chili', name:'辣椒', icon:'🌶️', growH:8,  seed:120, yld:10, base:22, float0:200, hold0:100,
    eta:2.5, absorbDay:545, vol:0.22, rotH:72, mono:0.55, tier:'主力',
    note:'斗争主战场。日需求适中、持仓分散，最适合逼仓与看跌。' },
  { id:'ginseng', name:'人参', icon:'🌿', growH:24, seed:380, yld:12, base:60, float0:120, hold0:60,
    eta:2.0, absorbDay:333, vol:0.30, rotH:0,  mono:0.50, tier:'高端',
    note:'单位毛利最高、最适合放置，但买的人最少，一次抛售就能砸出深坑。' },
];
const CROP_IDS = CROPS.map(c => c.id);

/* 加工品：制造公司的命脉（原案 §4.3「加工增值」）。
   增值率统一约 +26%（8 辣椒 @22 = 176 → 2 辣酱 @110 = 220），
   但耗时很长（3/6/12 游戏小时），所以制造是"用时间换溢价"的放置型玩法。
   价格不是固定的：每个 tick 按"原料的估值价"重新推导基本面，原料涨产品就涨。 */
const PRODUCTS = [
  { id:'dried',  name:'萝卜干', icon:'🧺', from:'radish',  need:12, out:4, hours:2,  base:38,
    absorbDay:1200,  note:'把卖不动的萝卜变成放得住的东西。' },
  { id:'sauce',  name:'辣酱',   icon:'🫙', from:'chili',   need:8,  out:2, hours:3,  base:110,
    absorbDay:3200, note:'辣椒的第一次增值，也是斗争期最硬的通货。' },
  { id:'essence',name:'参精',   icon:'🍯', from:'ginseng', need:6,  out:2, hours:8,  base:230,
    absorbDay:4600, note:'把一整天的等待熬成一小瓶钱。' },
];
const PRODUCT_IDS = PRODUCTS.map(p => p.id);
const PRODUCT_MARGIN = 0.45;   // 加工增值率（相对原料估值价）
const ALL_GOODS = CROP_IDS.concat(PRODUCT_IDS);   // 交易循环统一遍历"所有可交易的东西"

/* 公司类型：六种全部开放（原案 §4.2 的六家公司） */
/* 投入品（docs/19 §4.15 / §4.18.2）：**买来是为了生产，不是转卖**。
   与作物/加工品的两条硬区别：
     ① 只能买、不能卖（`seedMustBuy` 开启后，播种从这里扣，不再直接扣现金）
     ② 有“牌价”、不做现货浮动（`hasSpot:false`）—— 投入品不该被炒
   ⚠ 它们**不进 ALL_GOODS**：那条链是“价格会浮动的货”，投入品不浮动。
     市场面板用 MARKET_GOODS 取全集，避免两处各写一份清单（本项目手写清单漏过一次）。 */
const INPUTS = [
  { id:'seed_radish',  name:'萝卜种', icon:'🥕', kind:'seed', crop:'radish',  base:44,  pack:1, germ:0.95, tier:'入门' },
  { id:'seed_chili',   name:'辣椒种', icon:'🌶️', kind:'seed', crop:'chili',   base:120, pack:1, germ:0.92, tier:'主力' },
  { id:'seed_ginseng', name:'人参种', icon:'🌿', kind:'seed', crop:'ginseng', base:380, pack:1, germ:0.80, tier:'高端' },
  { id:'fert',      name:'化肥', icon:'🧪', kind:'agchem', base:60, note:'撒下去，这一季多收一点。' },
  { id:'pesticide', name:'农药', icon:'🧴', kind:'agchem', base:90, note:'虫子来得凶的那几天，全靠它。' },
  { id:'mulch',     name:'农膜', icon:'🎏', kind:'agchem', base:40, note:'早春盖一层，苗出得齐。' },
];
const INPUT_IDS = INPUTS.map(i => i.id);
/* 上市场的东西 = 全集（作物 + 加工品 + 投入品）。市场面板只读这一条，不许手写清单。
   ⚠ 前三类里只有作物/加工品会浮动；投入品是牌价。分档在 UI 侧按 `market` 字段做。 */
const MARKET_GOODS = ALL_GOODS.concat(INPUT_IDS);

const CORPS = [
  { id:'grow',  name:'种植公司', tag:'稳健经营', desc:'种地是你的命。初始多 2 块地、种子成本 8 折、收成多 10%。', route:'A', stars:{ stab:4, profit:2, ease:2 },
    start: { plots:2, cashMod:-400, storageMod:0 }, seedDiscount:0.8, yieldMult:1.10, feeMod:1.0, intelMod:1.0 },
  { id:'trade', name:'贸易公司', tag:'市场操盘', desc:'吃价差的人。手续费 7 折、开局现金最多，但只有 3 块地。', route:'C', stars:{ stab:2, profit:4, ease:3 },
    start: { plots:-1, cashMod:440, storageMod:100 }, seedDiscount:1.0, yieldMult:1.0, feeMod:0.7, intelMod:1.0 },
  { id:'intel', name:'情报公司', tag:'信息博弈', desc:'卖的是命运。情报便宜 40%、准确率 +10%，能靠卖情报抽成。', route:'D', stars:{ stab:3, profit:4, ease:4 },
    start: { plots:-1, cashMod:800, storageMod:0 }, seedDiscount:1.0, yieldMult:1.0, feeMod:1.0, intelMod:0.6,
    intelAccBonus:0.10, intelCommission:0.35 },
  { id:'shell', name:'皮包公司', tag:'隐身操控', desc:'看不见的手。开局自带一层皮，隐蔽度成长快 50%。', route:'B', stars:{ stab:2, profit:5, ease:5 },
    start: { plots:-1, cashMod:800, storageMod:0 }, seedDiscount:1.0, yieldMult:1.0, feeMod:1.0, intelMod:1.0,
    freeShell:1, shellGrowthMult:1.5 },
  { id:'make',  name:'制造公司', tag:'加工增值', desc:'把原料变成值钱的东西。开局自带一间作坊和 4 块地、加工耗时 −20%、品牌溢价涨得更快。', route:'A', stars:{ stab:4, profit:5, ease:3 },
    start: { plots:0, cashMod:-1600, storageMod:100 }, seedDiscount:1.0, yieldMult:1.0, feeMod:1.0, intelMod:1.0,
    freeWorkshop:1, craftSpeed:0.8, brandGrowthMult:1.5 },
  { id:'fin',   name:'金融公司', tag:'资本运作', desc:'钱生钱。授信额度 2.5 倍、利息 5 折，还能把钱放给别人收利息。', route:'C', stars:{ stab:3, profit:4, ease:4 },
    start: { plots:-1, cashMod:800, storageMod:0 }, seedDiscount:1.0, yieldMult:1.0, feeMod:1.0, intelMod:1.0,
    creditMult:2.5, loanRateMult:0.5, canLend:true, depositRateBonus:0.002 },
];

/* 天赋：3 系 × 6（Demo 精简版，镜像 docs/04 的 27 个中优先落地的 18 个） */
const TALENTS = [
  // 种植系
  { id:'g1', tree:'grow',  name:'催芽',     rarity:'common', desc:'所有作物生长时间 −15%。',                 apply:p=>p.mods.growMult *= 0.85 },
  { id:'g2', tree:'grow',  name:'密植',     rarity:'common', desc:'单产 +20%。',                            apply:p=>p.mods.yieldMult *= 1.20 },
  { id:'g3', tree:'grow',  name:'抗灾',     rarity:'rare',   desc:'天灾减产减半，腐坏损失 −50%。',           apply:p=>{p.mods.disasterMult*=0.5; p.mods.rotMult*=0.5;} },
  { id:'g4', tree:'grow',  name:'轮作',     rarity:'common', desc:'收获时 12% 概率额外产出一份。',            apply:p=>p.mods.doubleHarvest += 0.12 },
  { id:'g5', tree:'grow',  name:'仓储学',   rarity:'common', desc:'仓储上限 +150。',                        apply:p=>p.mods.storageBonus += 150 },
  { id:'g6', tree:'grow',  name:'产地议价', rarity:'rare',   desc:'卖出时价格冲击 −25%。',                   apply:p=>p.mods.sellImpactMult *= 0.75 },
  // 市场系
  { id:'m1', tree:'market',name:'内幕线人', rarity:'common', desc:'市场价格事件提前 6 小时看到预告。',        apply:p=>p.mods.intelLeadH += 6 },
  { id:'m2', tree:'market',name:'低吸',     rarity:'common', desc:'买入价格冲击 −20%。',                     apply:p=>p.mods.buyImpactMult *= 0.80 },
  { id:'m3', tree:'market',name:'舆论操盘', rarity:'common', desc:'舆论成本 −40%，效果 +50%。',              apply:p=>{p.mods.rumorCostMult*=0.6; p.mods.rumorShiftMult*=1.5;} },
  { id:'m4', tree:'market',name:'借货池',   rarity:'rare',   desc:'看跌的押金降到 120%，手里没货也能直接先卖。', apply:p=>p.mods.shortMarginMult *= 0.80 },
  { id:'m5', tree:'market',name:'规模效应', rarity:'common', desc:'手续费 5 折。',                           apply:p=>p.mods.feeMult *= 0.5 },
  { id:'m6', tree:'market',name:'顺势',     rarity:'rare',   desc:'持有 12 小时后卖出，该笔少付全部手续费。',  apply:p=>p.mods.holdFeeFree = 1 },
  // 斗争系
  { id:'f1', tree:'fight', name:'债务陷阱', rarity:'common', desc:'你放出的贷款周息翻倍。',                  apply:p=>p.mods.loanIncomeMult *= 2 },
  { id:'f2', tree:'fight', name:'狙击手',   rarity:'rare',   desc:'拍卖软延时窗口内出价，押金减半。',         apply:p=>p.mods.snipeDeposit *= 0.5 },
  { id:'f3', tree:'fight', name:'挖角',     rarity:'common', desc:'对手一次收成减产 10%（全局一次）。',       apply:p=>p.mods.sabotage += 1 },
  { id:'f4', tree:'fight', name:'深仓',     rarity:'common', desc:'仓储不占用（隐藏 100 单位库存不被计入垄断分母）。', apply:p=>p.mods.hiddenStorage += 100 },
  { id:'f5', tree:'fight', name:'快刀',     rarity:'rare',   desc:'卖出冲击 +25%，你更擅长砸盘。',            apply:p=>p.mods.dumpBonus = 1.25 },
  { id:'f6', tree:'fight', name:'金蝉脱壳', rarity:'epic',   desc:'被动清盘时保住 20% 库存，且债务减免 30%。', apply:p=>p.mods.escapeRope = 1 },
];

/* 事件池：docs/06 §2 镜像 */
const EVENT_POOL = [
  { id:'drought',  name:'干旱预警',  weight:3, durH:12, all:true,  yieldMult:0.80, anchorMult:1.15, text:'气象台说这个月不下雨。所有人都知道要涨，但没人知道涨多少。' },
  { id:'harvest',  name:'丰收季',    weight:3, durH:12, all:true,  yieldMult:1.00, anchorMult:0.85, text:'今年意外的风调雨顺。产量上去了，价格下来了。' },
  { id:'influencer',name:'网红带货', weight:3, durH:8,  all:false, yieldMult:1.00, anchorMult:1.35, text:'某个直播间突然开始卖它。订单像雪崩一样涌进来。' },
  { id:'plague',   name:'病虫害',    weight:2, durH:16, all:false, yieldMult:0.50, anchorMult:1.25, text:'一半的苗子烂在地里。活下来的人会赚很多。' },
  { id:'policy',   name:'政策变动',  weight:2, durH:12, all:true,  yieldMult:1.00, anchorMult:1.05, policy:true, text:'新的规定下来了：这段时间这笔买卖要交双份手续费。' },
  { id:'subsidy',  name:'产业补贴',  weight:2, durH:0,  all:false, yieldMult:1.00, anchorMult:1.00, subsidy:true, text:'扶持资金到账：每个正在种地的人都能领一笔。' },
  { id:'frenzy',   name:'抢购潮',    weight:1, durH:6,  all:false, yieldMult:1.00, anchorMult:1.55, text:'不知道谁先动的手，反正所有人都在抢。' },
];

/* 拍卖标的池 */
const LOT_POOL = [
  { id:'fertile',  name:'高产地契',   kind:'plot',     desc:'一块单产 +50% 的宝地，无需额外打理。',        value:2600 },
  { id:'taxfree',  name:'免税凭证',   kind:'privilege',desc:'接下来 24 游戏小时，你的手续费归零。',        value:2200, durH:24 },
  { id:'export',   name:'独家出口权', kind:'privilege',desc:'接下来 24 游戏小时，你卖出价格冲击 −40%。',   value:2800, durH:24 },
  { id:'seeds',    name:'稀有种子',   kind:'seeds',    desc:'立即获得 40 单位随机作物现货。',              value:1600 },
  { id:'dossier',  name:'绝密情报',   kind:'intel',    desc:'下一场市场事件的准确时间、作物与方向。',      value:1400 },
  { id:'debtpack', name:'债务包',     kind:'debt',     desc:'买下它，债权人变成你：对手欠你的钱由你还。',  value:1800 },
];

/* ---------------------------------------------------------------------------
 * 1. PRNG：字符串种子 → 字段级独立子流。可复现、可序列化。
 *    注：docs/07 规范为 FNV-1a64 + splitmix64；demo 实现为 FNV-1a32 + mulberry32
 *    变体（状态是普通 number，便于 JSON 存档）。接口与可复现性要求一致。
 * -------------------------------------------------------------------------*/
