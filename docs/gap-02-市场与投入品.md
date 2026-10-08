# gap-02 · 市场与投入品缺口调查 + 设定草案

> **归属**：docs/19 §4.15（市场分四档 + 种子必须买 + 品类自动取全集）· §4.8（资产绑公司）
> **上位**：docs/01（市场与价格引擎）· docs/02 §2.1/§2.9（公司初始资源表 / 供需矩阵）· docs/20 §6（双名制）
> **用户原话（2026-10-08）**：「市场品类太少，给我量大管饱。涵盖目前全部公司的实体产品。且种子也是要在市场买的。」
> **本文纪律**：**不改任何 `game/` 下的文件；不编辑任何已存在的文档；只新建本文件**。
> 所有结论都带 `文件:行` 证据；查不到的就写「查不到」，不推测。
> **基线已实测（2026-10-08，本机跑过）**：`node tools/newbie.test.cjs` → ✅ 主线是赚的（单轮平均 +86 / 三轮平均 +220）；
> `node tools/sim.cjs 3 8` → ✅ 不变量无异常、种子可复现 ✅、往返套利回归 ✅。
> 也就是说——下面列的风险，全是**改前是绿的、改后可能变红**的地方。

---

## ① 现状证据（文件:行）

### 1.1 商品全集：只有 3 个作物 + 3 个加工品，**没有任何投入品层**

| 事实 | 证据（文件:行） |
|---|---|
| 作物表 3 种，`seed` 只是一个数字（不是一种"货"） | `game/parts/01-data.js:130` `const CROPS = [`；`:131` radish `seed:44`；`:134` chili `seed:120`；`:137` ginseng `seed:380` |
| 作物 ID 数组 | `01-data.js:141` `const CROP_IDS = CROPS.map(c => c.id);` |
| 加工品表 3 种 | `01-data.js:147` `const PRODUCTS = [`（dried / sauce / essence）；`:155` `PRODUCT_IDS` |
| 加工增值率 | `01-data.js:156` `const PRODUCT_MARGIN = 0.45;` |
| "所有可交易的东西" = 作物 ∪ 加工品 | `01-data.js:157` `const ALL_GOODS = CROP_IDS.concat(PRODUCT_IDS);` |
| state 里只有 crops / products 两本账 | `game/parts/03-core.js:49-86` 循环 `CROPS`→`crops`、循环 `PRODUCTS`→`products`；`:90-93` `this.s = { …, crops, products, rules, … }` |
| **不存在 `inputs` / `INPUTS` / `INPUT_IDS`** | 在 `game/parts/*.js`、`game/ui-parts/*.js`、`tools/*.cjs` 全文搜索 `inputs\|INPUTS\|INPUT_IDS` → **零命中** |
| **不存在化肥 / 农药 / 地力** | 搜索 `soil\|fertil\|pesticid\|农资\|化肥\|农药` → 唯一命中是 `01-data.js:217` 的 `id:'fertile'`（高产地契，子串巧合），**没有真正的农资实体** |

⇒ docs/19 §4.15 C 写的 `市场列表 = s.crops ∪ s.products ∪ s.inputs` 里，**`s.inputs` 目前根本不存在**——这是本缺口的第一因。

### 1.2 一个"名不副实"的现存设定：稀有种子发的不是种子

| 事实 | 证据 |
|---|---|
| 拍卖标的池里有一条"稀有种子" | `01-data.js:220` `{ id:'seeds', name:'稀有种子', kind:'seeds', desc:'立即获得 40 单位随机作物现货。', value:1600 }` |
| 领取逻辑发的是**作物现货** | `game/parts/15-auction.js:188` `else if (lot.kind === 'seeds') {`；`:189` `const cid = this.rng.main.pick(CROP_IDS);` → 直接写进 `p.storage[cid]` |

⇒ 标的名写「种子」、描述与实现给的都是「作物」。**一旦"种子必须买"，这条标的会自相矛盾**（玩家拍到"稀有种子"却发现仓库里多了 40 个萝卜）。

### 1.3 市场 UI 现在列了什么：UI 侧拼接清单，且只认作物

| 事实 | 证据（文件:行） |
|---|---|
| 市场视图入口 | `game/ui-parts/10-market.js:123` `function viewMarket()` |
| 清单 = `CROP_IDS ∪ PRODUCT_IDS`，且加工品"接触过才显示" | `10-market.js:126` `const goods = GG.CROP_IDS.concat(GG.PRODUCT_IDS).filter(...)`（`:127-130`） |
| 挂单 / 看跌**只对作物** | `10-market.js:40` `function limitBlock(cid)`（注释明写"加工品不能挂单（引擎会拒绝），所以整块都不渲染"） |
| 收货商（§17.1）｜上门买家（§17.2） | `10-market.js:68` `const DEALER = { name: '老赵', icon: '🧺' };`；`:92` `function buyerPanel()` |
| 两个角色**都只认作物**（用 `!isProduct` 判定） | `game/parts/06-trade.js:13`（收货商压价闸）、`:112`（记 `dealerSold` 时 `if (!this.isProduct(cid))`） |

### 1.4 播种路径：现在"点一下"= **直接扣现金**，不消耗库存种子

| 事实 | 证据（文件:行） |
|---|---|
| 播种动作 | `game/parts/08-crop.js:14` `Game.prototype._a_plant = function (p, d) {` |
| 成本 = 作物表里的 `seed` 数字 × 公司折扣 ×（双倍地租 1.25） | `08-crop.js:19` `const cost = Math.round(c.seed * corp.seedDiscount * (this.s.rules.doubleLandRent ? 1.25 : 1));` |
| **直接从现金扣**，`p.storage` 完全不参与 | `08-crop.js:26` `p.cash -= cost;` |
| 一键播种 = 循环调用单块播种 | `08-crop.js:32` `Game.prototype._a_plantAll = function (p, d) {` |
| 收割 / 一键收割 | `08-crop.js:43` `_harvest`；`:80` `_a_harvest`；`:85` `_a_harvestAll` |
| UI：选种子 chip / 一键播种按钮 | `game/ui-parts/09-farm.js:61` `data-pick="${cid}"`；`:67` `data-act="plantAll"`；`:12` `data-plant="${i}"` |
| UI 预览价（**只读**，与引擎同口径） | `09-farm.js:30` `const seedCost = cid => Math.round(s.crops[cid].seed * GG.CORPS.find(...).seedDiscount * (…?1.25:1));` |
| 事件分派 | `game/ui-parts/15-events.js:78` `if (d.pick)`；`:79` `if (d.plant != null) { A('plant', …) }`；`:92` `if (d.act === 'plantAll') { A('plantAll', …) }` |

⇒ **播种是"点一下就用现金结算"，`p.storage` 里根本没有"种子"这个键**。
⇒ ⚠ `08-crop.js:19`（实扣）与 `09-farm.js:30`（预览）是**两份平行实现**，改"必须买"时两处必须同步，否则玩家看到的价与实扣的价会分叉。

### 1.5 NPC 种植路径：同样只查现金，**没有任何备料概念**

| 事实 | 证据（文件:行） |
|---|---|
| NPC 每 30 游戏分钟决策一次 | `game/parts/14-npc.js:3-13` `_npcTick` |
| 「2) 补种」：按耐心选作物，只查现金 | `14-npc.js:19` `// 2) 补种…`；`:24` `const cost = c.seed;`；`:25` `if (p.cash > cost + p.debt * 0.05) this._a_plant(p, { crop: cid });` |
| NPC 卖出 / 买入 / 加工 / 建作坊（都依赖"先有作物入库"） | `14-npc.js:29-43`（卖）、`:45-57`（买）、`:86-94`（6.5 加工，`_a_craft` @ `:90`）、`:95-102`（6.6 建作坊，`_a_buildWorkshop` @ `:101`） |
| NPC 初始持有作物库存（`hold0` 分摊，与播种无关） | `03-core.js:242-244` |

⇒ **NPC 只认现金**。若 `_a_plant` 改成"消耗库存种子"，NPC 的第 2 步会**每一次都返回 `{ok:false}`（静默失败，不抛异常）**→ NPC 全线停种。

### 1.6 加工路径（作为"投入品"的类比参照）

| 事实 | 证据 |
|---|---|
| 配方校验：作坊 → 产线 → **原料够不够** → 仓库 → 加工费 | `game/parts/13-talent.js:57` `_a_craft`；`:60`（无作坊拒绝）、`:61`（产线占满）、`:63`（`原料不够：需要 …`）、`:65`、`:68`（`加工费要 20 G`） |
| 加工品价格 = 跟原料 TWAP 走（不是自由浮动） | `game/parts/04-ticks.js:129` `_productTick`；`:134` `for (const pid of PRODUCT_IDS)` |
| 作物价格 tick（含阀门、TWAP、垄断/泡沫判定） | `04-ticks.js:42` `_priceTick` |
| 产业补贴：按"已播种地块数 ×250 G"发现金 | `04-ticks.js:15` `if (q.subsidy) {` |

⇒ 加工线**已经有"先备原料"的完整前例**（`13-talent.js:63`）。"种子必须买"本质上就是把同一套"先备料"搬到种植线上——**这一点对 ④ 的设计很有用：照抄现成的语义即可**。

### 1.7 `good()` / 估值 / 仓储：目前的"货"只有作物与加工品

| 事实 | 证据（文件:行） |
|---|---|
| `good(id)` = crops ∪ products | `game/parts/07-metrics.js:2` `Game.prototype.good = function (id) { return this.s.crops[id] \|\| this.s.products[id]; };` |
| `isProduct(id)` | `07-metrics.js:3` |
| 仓储占用 = **所有 storage 键求和** | `07-metrics.js:5-7` `storageUsed` |
| 估值价 = TWAP（防自我抬价） | `07-metrics.js:11` `valuePrice` |
| 库存估值 = Σ 数量 × TWAP × 垄断溢价 | `07-metrics.js:24` `inventoryValue` |

⇒ **两个直接后果**（写进 ③ 的缺口清单）：新增的种子若进 `p.storage`，
（a）会**占仓储**（`storageUsed` 无差别求和）；
（b）**估值为 0**（`good('seed_x')` 未定义 → `valuePrice` 返回 0 → 不进 NAV）。

### 1.8 导出与存档口径

| 事实 | 证据 |
|---|---|
| 引擎导出键 | `game/parts/16-settle.js:236-243` `return { BAL, CROPS, CROP_IDS, CORPS, …, PRODUCTS, PRODUCT_IDS, PRODUCT_MARGIN, Game, …, save, load };` |
| 读档 = 整体替换 `g.s`（**不做字段迁移**） | `16-settle.js:248-255` `load: str => { … g.s = raw.state; … }` |
| **"旧存档新增键"的既有先例：一律兜底、不迁移** | `03-core.js:99-102` 注释「旧存档没有这个键 → 引擎与 UI 一律用 `Array.isArray` 兜底，不做迁移」+ `:102` `inbox: []`；`:107` `offers: []` |

⇒ 新增 `s.inputs` / `s.rules.seedMustBuy` 应当**照抄 `inbox`/`offers` 的兜底写法**，不写迁移脚本。

### 1.9 与六家公司"实体产品"的现状对照（答案：现在只有 3+3）

| 公司 | docs/02 里的实体产品 | 代码里现在有吗 |
|---|---|---|
| 种植 | 作物（出口） | ✅ 3 种（`01-data.js:131-139`） |
| 制造 | 加工品（出口 ×1.2） | ✅ 3 种（`01-data.js:147-154`） |
| 贸易 | 作物 + 加工品（渠道，`docs/02:676-677`） | ⚠️ 无自有实体产品，只有"渠道" |
| 皮包 | 代持（`docs/02:676` "无"） | ❌ 无实体产品 |
| 情报 | 信息（非实体） | ❌ 无实体产品 |
| 金融 | 资金 / 贷款（非实体） | ❌ 无实体产品 |

⇒ 用户要的"涵盖目前全部公司的实体产品"，**实体口径下就是 作物 3 + 加工品 3 = 6 种**；
再加上本次要新建的**投入品档**（种子/农资）才凑齐"市场分四档"。
（`docs/02 §2.9` 那张"供需矩阵"把 种子/催熟剂/情报/贷款/抵押品 都算作"谁向谁卖什么"，
但其中**只有"种子"是需要落到实体货架的投入品**——情报/贷款/抵押品另有系统，不进商品市场。）

---

## ② 现实依据

> 联网检索（2026-10-08）。**说明**：本轮搜索命中的多为商业推广页；下列只保留**官方入口 / 学术 / 标准**类，
> 并明确标注"未逐字核验"的部分。落地前建议人工复核条文号。

| # | 现实规律 | 用于游戏 | 来源（链接级） |
|---|---|---|---|
| R1 | **投入品是生产成本，不是商品**：种子/化肥/农药/农膜/饲料是"农业投入品"，买它为了生产而非转卖 | 种子档 **只买不卖**；播种消耗 1 份 | 农业投入品属农业生产资料（行业通识）；本文件用其**方向性**结论，未引具体法条 |
| R2 | **种子有品种 + 质量硬指标**：标签须标 品种名称、产地/生产年月、质量指标（**纯度、净度、水分、发芽率**）、检测日期 | 每品种补 `germ`（发芽率）、`packSize`（规格）、`sowWindow`（适种期） | 国家标准全文公开系统（官方入口，可查 GB 20464《农作物种子标签通则》）：https://openstd.samr.gov.cn/bzgk/std/index ；四指标行业表述：https://www.antpedia.com/standard/5547071.html ；《作物杂志》玉米种子质量（净度/含水率/发芽率）：http://zwzz.chinacrops.org/CN/10.16035/j.issn.1001-7283.2018.03.028 |
| R3 | **初级品与加工品有价差 = 加工增值**（产业链后端增值） | 市场按"初级/加工"分档；已有 `PRODUCT_MARGIN=0.45`（`01-data.js:156`） | 与 `docs/01 §1`、`docs/19 §4.15 A` 自洽；代码实现见 `04-ticks.js:129` |
| R4 | **批发/现货市场有层级**：产地 → 集散地 → 销地；批发端有独立价格度量 | "农产品（原料）/加工品（成品）"对应产地批发 vs 成品批发；"地皮·牌照"是**资产市场**（另一台） | 农业农村部官网「**农产品批发价格200指数**」（批发端官方价格度量）：https://www.moa.gov.cn/ |
| R5 | **地/牌照与商品不同台**：频次低、金额大、要审批 | 市场分四档，第四档"地皮·牌照"单独处理（`docs/19 §4.16`） | 与 `docs/19 §4.15 B/§4.16` 自洽 |

> ⚠ **未采纳的搜索结果**：多个"批发市场排行/招商"页（南网、maigoo、53shop 等）为商业软文，
> 只作现象佐证，**不作为设计依据**。

---

## ③ 缺口清单

| ID | 缺口 | 证据（文件:行） | 影响 |
|---|---|---|---|
| **G1** | 没有投入品实体层，§4.15 的 `s.inputs` 不存在 | `03-core.js:90-93`；全仓搜 `INPUTS` 零命中（§1.1） | 市场加不了"种子·农资"档；"种子必须买"无处落地 |
| **G2** | 播种直接扣现金、不消耗库存种子 | `08-crop.js:19,26` | 设定核心（先备料）无载体 |
| **G3** | NPC 不备料，只查现金 | `14-npc.js:24-25` | **一旦 G2 改了，NPC 全线停种** → 破坏 §1.5、连带 6.5 加工/6.6 建作坊 |
| **G4** | 市场清单在 UI 侧拼接，且**没有"档位 / 是否有现货价"字段** | `10-market.js:126`；§4.15 C 要求每品种补这两个字段 | 以后每加一个品种就会漏（docs/19 自陈"因手写清单踩过坑"） |
| **G5** | 现有代码用 `!isProduct(cid)` 判"是不是作物"，**没有第三类** | `06-trade.js:13,52,63,112` | 新 seeds 走 `_trade` 时 `isProduct(seed)===false` ⇒ **被误当作物**：进收货商 `dealerSold`、被允许挂单/看跌、被算进单作物循环 |
| **G6** | "稀有种子"标的**名不副实**（发作物现货） | `01-data.js:220` + `15-auction.js:188-189` | 与"种子必须买"直接矛盾 |
| **G7** | 种子进 storage 后**占仓但估值为 0** | `07-metrics.js:5-7`（storageUsed 无差别求和）、`:2`/`:11`（good/valuePrice 未覆盖 seeds） | 仓储口径与 NAV 口径双双失真 |
| **G8** | 六家公司"实体产品"没有一份成体系的**品类全集表** | §1.9；`docs/02 §2.1/§2.9` 有矩阵但无代码实体 | 用户要的"量大管饱"缺一份可执行清单 |
| **G9** | **没有"生产成本"科目**：化肥/农药/地力在代码里完全不存在 | 搜 `soil/fertil/pesticid` 零命中；`docs/02 §2.2` 的 Soil/施肥 200G **未实现** | 现实里投入品是"一条采购线"，现在只有种子一项 |
| **G10** | 无"投入品是否占仓 / 是否计 NAV / 是否可垄断"的口径 | 无任何相关代码 | 不定死会在实现时各自拍脑袋（本项目对这种"没定口径"踩过多次） |

---

## ④ 设定草案

> 原则：**照抄本项目已验证的语义**（加工线的"先备料"、`inbox` 的"兜底不迁移"、§4.15 的"自动取全集"），
> 不发明新范式。所有数值默认 **可关旗标**（`seedMustBuy` 默认在**旧存档 = 关、新局 = 开**）。

### 4.1 品类全集的数据结构（新增 `INPUTS` 层）

放在 `game/parts/01-data.js`（与 CROPS/PRODUCTS 同层，**不在本文件里写代码**，只给结构）：

```js
/* 投入品：买来是为生产，不是为转卖（R1）。只能买、不能卖、不参与垄断。 */
const INPUTS = [
  // —— 种子：每个作物一条，id 规则固定为 'seed_' + cropId，便于用作物反查 ——
  { id:'seed_radish', name:'萝卜种', icon:'🥕', kind:'seed', crop:'radish',
    base:44,  pack:1, germ:0.95, sowWindow:null,
    market:'input', hasSpot:false, tier:'入门' },
  { id:'seed_chili',  name:'辣椒种', icon:'🌶️', kind:'seed', crop:'chili',
    base:120, pack:1, germ:0.92, sowWindow:null,
    market:'input', hasSpot:false, tier:'主力' },
  { id:'seed_ginseng',name:'人参种', icon:'🌿', kind:'seed', crop:'ginseng',
    base:380, pack:1, germ:0.80, sowWindow:null,
    market:'input', hasSpot:false, tier:'高端' },

  // —— 农资（化肥/农药/农膜）：先落"能买、能看见"，效果挂到后续批次 ——
  { id:'fert',      name:'化肥', icon:'🧪', kind:'agchem', market:'input', hasSpot:false, base:60,  note:'撒下去，这一季多收一点。' },
  { id:'pesticide', name:'农药', icon:'🧴', kind:'agchem', market:'input', hasSpot:false, base:90,  note:'虫子来得凶的那几天，全靠它。' },
  { id:'mulch',     name:'农膜', icon:'🎏', kind:'agchem', market:'input', hasSpot:false, base:40,  note:'早春盖一层，苗出得齐。' },
];
const INPUT_IDS = INPUTS.map(i => i.id);

/* ✅ §4.15 C 要的"自动取全集、不手写清单"—— 唯一权威的"上市场的东西" */
const MARKET_GOODS = CROP_IDS.concat(PRODUCT_IDS, INPUT_IDS);
```

**三条硬口径**（写进代码注释，防以后各自发挥）：
1. `market` 字段 = 档位（`'input' | 'primary' | 'craft' | 'asset'`）；UI 按它分段，**不手写清单**。
2. `hasSpot` 字段 = 是否参与现货价格浮动。`input` 档 **`hasSpot:false`**（投入品有"牌价"，不作价差炒作）。
3. `seed_*` 的 `base` **直接取 `CROPS[c].seed`**（44/120/380），**单一事实来源**——避免两处数字漂移。

**必须同步改的三处访问器**（都在 `07-metrics.js`，见 G5/G7）：
- `good(id)`（`:2`）→ `this.s.crops[id] || this.s.products[id] || this.s.inputs[id]`
- 新增 `isInput(id)`；把现有 `!this.isProduct(cid)` 的语义**收窄成 `isCrop(cid)`**（否则 seeds 被误当作物，G5）
- `storageUsed`（`:5-7`）与 `inventoryValue`（`:24`）：**投入品占仓**（现实里农资也占仓库），
  但**估值按成本计**（用 `avgCost`，不计垄断溢价、不计 TWAP）——这样 NAV 不会因屯种子虚高。

### 4.2 每品种要补的字段（"可上市场"必须两个，其余按类）

| 类别 | 必补字段（§4.15 C 明令） | 类别特有字段 | 现状 |
|---|---|---|---|
| 作物 | `market:'primary'`、`hasSpot:true` | （保留现有 `growH/yld/base/float0/hold0/eta/absorbDay/vol/rotH/mono/tier/note`） | 缺前两个 |
| 加工品 | `market:'craft'`、`hasSpot:true` | （已有 `from/need/out/hours/absorbDay`） | 缺前两个 |
| 种子 | `market:'input'`、`hasSpot:false` | `crop`（对应作物）、`germ`（发芽率）、`pack`（一份够种几块地，默认 1）、`sowWindow`（适种期，可空） | **整类新增** |
| 农资 | `market:'input'`、`hasSpot:false` | `kind:'agchem'`、`note`（效果说明；效果本体挂后续批次） | **整类新增** |

> **为什么要 `germ`（发芽率）**：R2 里种子质量的四指标（纯度/净度/水分/发芽率）在现实里是硬标注项。
> 游戏里把它做成**可选杠杆**：`germ` 越低，同一块地实收越少（或"十颗里出几颗"）。
> **先只落字段、不落效果**——效果要等"地力/施肥"（G9）一起做，避免半套系统。

### 4.3 四档划分（docs/19 §4.15 B 的落地映射）

同一屏、四个段，**顺序固定**（按玩家视角：先备料 → 再卖货 → 最后置产）：

| 档 | 段标题（玩家看到） | 数据来源 | 买/卖 | 现在的障碍 |
|---|---|---|---|---|
| ① | **种子·农资** | `INPUT_IDS` | **只能买**（卖出被拒） | G1/G2/G5 |
| ② | **刚收的** | `CROP_IDS` | 买/卖（+挂单/看跌/收货商/上门买家） | 现成 |
| ③ | **做好的** | `PRODUCT_IDS` | 买/卖（无挂单/看跌；走上门的买家） | 现成（`10-market.js:126` 的"接触过才显示"保留） |
| ④ | **地块放出来了** | 资产（`docs/19 §4.16`） | 买/招拍挂 | 属另一批次（`docs/19 §4.16 D` 已定"不删 `_a_buyland`，改价"） |

> ④ 本批次**只占位、不实现**（`docs/19 §4.16` 有独立批次）。本缺口只做 ①②③ 的分档。

### 4.4 种子消耗与价格

**价格**（三个数，写死口径避免漂移）：

| 数 | 取值 | 说明 |
|---|---|---|
| 牌价 = 买入价 | `CROPS[c].seed`（44/120/380）→ 即 `INPUTS.seed_x.base` | 单一来源（4.1 第 3 条） |
| 公司折扣 | `CORPS[c].seedDiscount`（种植公司 0.8，`01-data.js:161`） | **从"播种时打折"挪到"买入时打折"**——见下 |
| 双倍地租 | `rules.doubleLandRent ? 1.25`（`08-crop.js:19`） | **保留在"播种"侧**（它是地租性质，不是种子价） |

**消耗**（把 `08-crop.js:14` 的 `_a_plant` 改成两支）：

```
若 rules.seedMustBuy === true：
    const sid = 'seed_' + cid;
    const need = 1;                       // 一份 = 一块地
    if ((p.storage[sid] || 0) < need)
      return { ok:false, msg:'手头没这号种子了，先去「种子·农资」那档买一份。' };   ← 玩家看到的话
    p.storage[sid] -= need; 若为 0 则 delete
    const 地租附加 = rules.doubleLandRent ? 1.25 : 1;   // 不再乘 seedDiscount
    成本扣现金 = 0                                        // 钱已经在"买种子"那一步付了
否则（旗标关，= 现状，兼容旧存档）：
    保持 08-crop.js:19,26 原样（扣现金、乘 seedDiscount）
```

**买入路径**：走现成的 `_trade(p, sid, qty, 'buy')`（`06-trade.js:29`），
但**必须**先修 G5（`isProduct` → `isCrop`），否则 `06-trade.js:112` 会把买种子记进 `dealerSold`。
种子**挂 `hasSpot:false`** ⇒ 不参与 `_priceTick`（`04-ticks.js:42` 只遍历 `CROP_IDS`，天然不进）、不参与垄断（`07-metrics.js:104/121` 只遍历 `CROP_IDS`）。

**卖出**：`_a_sell` 里加一条前置拒绝 —— `if (this.isInput(cid)) return { ok:false, msg:'这不是拿来转手的，是拿去除草的。' };`
（玩家看到的话；**零术语**，过 `lint-copy` 三道闸。）

**UI 预览同口径**：`09-farm.js:30` 的 `seedCost()` 改成：
- 旗标开：显示"**手上有 N 份**"（来自 `p.storage['seed_'+cid]`），价格列显示牌价（买入价，含折扣）；
- 旗标关：保持现状。

### 4.5 NPC 备料行为（**关键，必须在打开旗标之前或同一批落地**）

三档行为，**照抄 4.6 的现成模板**（加工线 `13-talent.js:63` 的"原料不够"、NPC 买入分支 `14-npc.js:45-57`）：

1. **备料步骤**（插在 `14-npc.js:19` 的「2) 补种」**之前**）：
```
// 2.0) 备料（seedMustBuy 时）：要种几块空地，就备几份种子
const 空地数 = p.plots.filter(pl => !pl.crop).length;
const 想要的种子 = 选中的作物（沿用 14-npc.js:21 的耐心/激进取法）
if (p.storage['seed_'+cid] < 空地数) {
  const 缺 = 空地数 - (p.storage['seed_'+cid] || 0);
  const 预算上限 = p.cash * 0.20;                      // 别把现金全砸种子上
  const 能买 = Math.min(缺, Math.floor(预算上限 / 牌价));
  if (能买 > 0 && p.cash > 牌价 * 能买 + p.debt * 0.05)
    this._trade(p, 'seed_' + cid, 能买, 'buy');        // 走公开 API
}
```
2. **失败兜底**：买不到（市场 `mmInv` 空 / 现金不够）→ **照常跳过补种**，不抛异常、不改其他分支。
   （保住 `sim.cjs` 的不变量：`08-crop.js` 只在"有种子"时扣，**绝不出现负库存**。）
3. **性格挂钩**：备料预算系数乘 `w.patience`（稳健农夫 0.85 → 几乎必买；激进操盘 0.25 → 可能拖欠），
   与 `14-npc.js:21` 已有的"耐心选作物"逻辑同源。

> **为什么这条是硬前提**：NPC 停种 ⇒ NPC 不再产出作物 ⇒ 卖不出货 ⇒ 6.5 加工/6.6 建作坊全断
> ⇒ 660 局仿真的**平衡读数整体失真**；若实现不当（负库存/抛异常）⇒ **不变量直接变红**。详见 ⑤。

### 4.6 旧存档兼容

**照抄 `inbox`/`offers` 的先例**（`03-core.js:99-102`：「旧存档没有这个键 → 一律用 `Array.isArray` 兜底，不做迁移」）：

| 新增项 | 兜底写法 | 理由 |
|---|---|---|
| `s.inputs` | `const inputs = s.inputs \|\| buildInputs();`（falsy 即懒建） | 读档 `16-settle.js:248-255` 整体替换 `g.s`，不会自动补新键 |
| `s.rules.seedMustBuy` | `const smb = !!(s.rules && s.rules.seedMustBuy);`（undefined → 视为 **false**） | **旧存档继续"点一下就种"，只有新局开旗标**——把风险面缩到"新局" |
| `p.storage['seed_*']` | 无需兜底：本来就是普通 storage 键 | 与作物同构 |
| `save()` 的 `v:1` | **不动**（`16-settle.js` 的 `v:1` 不改） | 新键带兜底，旧档读得进；新档在旧引擎里读不出的情况**不承诺兼容**（本项目未做版本迁移） |

**新局初始化**：`03-core.js:90-93` 加 `inputs`；并在 `_spawnPlayers` 里给**每家公司发一小撮起步种子**
（建议种植公司 4 份 / 其他公司 0–2 份），让"新手第一次播种"不必先去市场（呼应 ⑤ 里 `newbie.test.cjs` 的修法）。

### 4.7 六家公司 ↔ 品类全集对照（"量大管饱"的落点）

| 公司 | 自有实体产品 | 上市场哪一档 |
|---|---|---|
| 种植 | 萝卜 / 辣椒 / 人参 | ② 刚收的 |
| 制造 | 萝卜干 / 辣酱 / 参精 | ③ 做好的 |
| 贸易 | 无自有，靠①②③的**渠道**（手续费 7 折 `01-data.js:162`） | ①②（买卖） |
| 皮包 | 无自有（代持） | —（不占货架） |
| 情报 | 无自有（信息） | — |
| 金融 | 无自有（资金） | — |
| **全体共用** | 种子 3 + 农资 3 | ① 种子·农资（**只买**） |

⇒ 若后续要把"量大管饱"继续加厚，**扩容点就在 ①（每作物一条种子 + 农资）与 ②（加作物）**，
③ 跟着 ② 自动长出（一条配方一个成品）。**结构性扩容，不是硬编码加行。**

### 4.8 UI 文案（双名制 · docs/20 §6；给"玩家看到的话"）

| 术语（引擎/文档） | 玩家看到 | 出处 |
|---|---|---|
| 投入品 / 农资 | **种子·农资** | `docs/19 §4.15 D` |
| 初级品 | **刚收的** | `docs/19 §4.15 D` |
| 加工品 | **做好的** | `docs/19 §4.15 D` |
| 招拍挂 | **地块放出来了** | `docs/19 §4.15 D` |
| 种子库存不足 | **手头没这号种子了，先去「种子·农资」那档买一份。** | 本文 4.4 |
| 种子卖出被拒 | **这不是拿来转手的，是拿去除草的。** | 本文 4.4 |
| 发芽率 | **十颗里能出几颗**（若落效果） | 本文 4.2 |
| 现货价 / TWAP | **今天的行情价** / **估值**（沿用现有写法 `10-market.js`） | 现成 |

> ⚠ **新文案必须过的闸**（`tools/lint-copy.cjs`）：
> **红线词**（合规）：投资 / 理财 / 分红 / 套利 / 收益 / 年化 / 杠杆 / 保证金 …；
> **术语词**（认知负担）：需求侧 / 饱和 / 流动性 / 做市商 / 滑点模型 / 评级机构 / 质检标准 …；
> **Markdown 泄漏**：任何"中文 + `**`"同行 → 报警（加粗请用 `<b>`）。
> ⇒ 上面的"玩家看到的话"**已规避**这三类词。

---

## ⑤ 落地风险

### 5.1 会变红的守卫与测试（按"多快变红"排序）

| # | 守卫 / 测试 | 变红机制（**带证据**） | 会不会真的红 |
|---|---|---|---|
| **R-1** | **`tools/newbie.test.cjs`** | `:30` `g.act(hid,'plantAll',…)` 是**每轮第一句**；`:78` `const pass = oneAvg > 0 && threeAvg > 0;` + `process.exit`。没种子 ⇒ 种不了 ⇒ 收到 0 ⇒ 卖 0 ⇒ 家底不涨 ⇒ **退出码 1** | **必红（最硬）** |
| **R-2** | **`tools/ui-smoke.cjs`** | `:120`（只查不抛）、`:165`（制造线：plantAll→advance→harvestAll→`if (!D.human.storage.sauce > 0) throw`）、`:189`（收货商/买家线）、`:239`。播种不成 ⇒ 后续**硬 `throw`** | **必红** |
| **R-3** | **`tools/sim.cjs`（check-all 里的「660 局仿真」项）** | **两条路，必须说清**：<br>（a）**只让 `_a_plant` 返回 `ok:false`**：`checkInvariants`（`sim.cjs:17-39`）只查 NaN / 价格>0 / 库存≥0 / NAV 有限 ⇒ **不会红**；但 `farmer` 策略（唯一纯种植流，`sim.cjs:52-56`）整局停种 ⇒ **NAV 倍数读数塌方**（本机 3 局基线 farmer 中位 1.08），`monopolist/bust/allround/raider` 等读数一并失真。<br>（b）**若实现成抛异常 / 负库存**：`sim.cjs:34` 的 `'库存 X = -1'` 断言命中 ⇒ 输出「不变量异常：❌ N 条」⇒ check-all 判 `line.indexOf('❌')>=0`（`check-all.cjs:52`）⇒ **该行直接红** | **(a) 不红但读数失真；(b) 必红** —— 这正是"必须先补 NPC 备料（G3）+ 扣减绝不为负"的原因 |
| **R-4** | `tools/dealer.test.cjs` / `tools/buyers.test.cjs` | 两者**直接塞 storage**（`dealer.test.cjs:51` `h.storage.radish=500`；`buyers.test.cjs:44-47` `function stock(h){h.storage={…}}`），**不走播种** ⇒ 不受"种子必须买"影响。**但**若种子接进 `_trade` 而没修 G5，`06-trade.js:112` 会把种子记进 `dealerSold` ⇒ 牌子数字被污染；`dealer.test.cjs` 断言 `dealerQuota('radish')===80`、`absorbDay===800`（`:43-45`）**本身不会红，但 D1/D4/D8 的归因句会变** | ⚠️ 条件性 |
| **R-5** | `tools/wiring-check.cjs` | 新增"买种子"按钮若没有 `d.种子键` 分支 → **红**（它的存在意义就是这个）；反向检查还会提示"引擎有动作、UI 从不调用" | 视实现 |
| **R-6** | `tools/lint-copy.cjs` | 新文案含 红线词 / 术语词 / "中文+`**`" → **红**；且它有行数下限（engine ≥2000 / ui ≥1000），改到残桩也会红 | 视文案 |
| **R-7** | `tools/size.test.cjs` | 每源文件 ≤1000 行（含 `game/`、`tools/`）。现 `01-data.js` 230 行、`ui-parts/10-market.js` 195 行，**尚有空间**；但"量大管饱"若把品类表写在同一文件要留神 | 视体量 |
| **R-8** | `tools/ui-verify.cjs` | 关键函数白名单（`ui-verify.cjs:47-49`）：`viewFarm/viewMarket/viewBank/render/handleAction/dealerBoard/buyerPanel/toast`。**重命名**会红，**新增**不影响 | 视改名 |
| **R-9** | `tools/parts-verify.cjs` | 只查"**缺**"（`:62` 的 `need` 白名单），**加导出不会红**；但新增 part 文件**必须**进 `game/engine.parts.js` 清单，否则「parts/ 里有孤儿文件」**红** | 视新增文件 |
| **R-10** | `tools/parts-ranges.cjs` | **已失效**：它拿 `game/engine.js` 的 `[20..247]` 等原始区间逐行比对，而 engine.js 现已是 601 行装配入口 ⇒ 必然不符。**但它不在 `check-all.cjs` 的 STEPS 里**（`check-all.cjs:26-44`），是拆分迁移期遗留工具 ⇒ **不构成约束** | 不红（不在闸内） |

### 5.2 先改谁、后改谁（把风险面切到最小）

**每一步结束都要求：`node tools/check-all.cjs` 全绿（含 660 局），再走下一步。**

| 批次 | 改什么 | 为什么这个顺序 | 期望状态 |
|---|---|---|---|
| **0** | **本文件定口径** + 定 `rules.seedMustBuy` 旗标（**默认关**） | 口径未定就动手，会各自拍脑袋（本项目对这种坑有记忆） | 无代码变更，全绿 |
| **1** | **数据层**：`01-data.js` 加 `INPUTS/INPUT_IDS/MARKET_GOODS` + 给 CROPS/PRODUCTS 补 `market`/`hasSpot`；`03-core.js` state 加 `inputs`（falsy 懒建） | **这一批不改任何行为**（只是"多了一套没人读的数据"） | 应全绿 |
| **2** | **访问器**：`07-metrics.js` 的 `good` 扩到 inputs、新增 `isInput`、把 `!isProduct` 收窄成 `isCrop`；明确"投入品占仓、按成本计 NAV、不参与垄断" | **必须先于**任何"种子进出 storage"的动作，否则 G5/G7 会静默污染 | 应全绿（无调用方变化） |
| **3** | **市场 UI**：`10-market.js` 改四档、清单取 `MARKET_GOODS`；`15-events.js` 补分派；文案过 `lint-copy` | UI 先上、行为不变 ⇒ 玩家能"看见档位"，但播种仍是老逻辑 | 应全绿（wiring/lint/ui-smoke 复核） |
| **4** | **NPC 备料**（`14-npc.js` 插 2.0 步） | **必须在开旗标之前**——否则 R-1/R-2 立刻红、R-3b 可能红 | 旗标仍关，行为不变，全绿 |
| **5** | **播种改口径**：`08-crop.js` 加 `seedMustBuy` 分支；`09-farm.js:30` 预览同口径 | 到这一步才动"核心行为"；且**新局才开旗标** | 新局行为变；旧存档不变 |
| **6** | **修测试**：`newbie.test.cjs:30` / `ui-smoke.cjs:165,189,239` 的 `plantAll` 前先买种子（或给 `_spawnPlayers` 发起步种子，一次修两处） | 不改测试，R-1/R-2 必红 | 全绿 |
| **7** | **跑全量 + 目视**：`node tools/check-all.cjs`（含 660 局）+ **打开市场页看一眼** | 本项目"打开看一眼"抓到过静态检查/仿真/闸门全都看不见的 bug（`09-farm.js:30` 那道 NaN 就是浏览器实测拓出来的） | 全绿 + 目视通过 |
| **8** | **收尾**：把"稀有种子"标的名实相符（`01-data.js:220` + `15-auction.js:188` 改成发 `seed_*`） | 它和本设定直接矛盾，但不影响前面几步的绿灯 | 全绿 |

### 5.3 三条"绝不要做"

1. **不要**为了省事把种子塞进 `CROPS` 数组（会污染 `CROP_IDS`：`_priceTick`、`monoShare`、收货商、看跌全都只遍历 `CROP_IDS`）——**必须新建 `INPUTS` 层**。
2. **不要**写"旧存档迁移脚本"——照 `03-core.js:101` 的先例，一律 falsy 兜底、`rules.seedMustBuy` 默认 **false**。
3. **不要**在 NPC 备料落地之前打开 `seedMustBuy`——这是 R-1/R-2 必红、R-3 可能红的唯一触发点。
