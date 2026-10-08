/* engine 模块清单 —— **唯一顺序来源**。
 *
 * game/engine.js（Node 聚合器）与 tools/build.mjs（单文件内联）**都只读这里**，
 * 保证 Node 与浏览器跑的是同一份拼接结果。
 *
 * ⚠ 顺序 = 拼接顺序，不能随便调：片段之间靠**同一个函数作用域**里的裸标识符互相引用
 *   （BAL / Game / clamp / CROP_IDS …），被依赖的必须排在前面。
 *
 * ⚠ 每个 part 都必须是 engine.js 原工厂体的**连续切片**，一行不改。
 *   任何改动都会被 tools/parts-verify.cjs 的逐字节比对抓到。
 *
 * ⚠ 本文件是 .js，所以**注释里绝不能出现 `星号+斜杠` 连写**（会提前关闭注释块）。
 *   —— 2026-10-08 我就因为把「advanceReal / _tick」写成了连写形式，导致本文件
 *      语法错误、`Unexpected number`。写函数名清单时，**斜杠两侧务必留空格**。
 *
 * --- 拆分时的原始行范围（仅供溯源；parts 成为源文件后不再维护）---
 *   01-data.js      20..247    平衡常量与数据表（BAL/CROPS/PRODUCTS/CORPS/TALENTS/EVENT_POOL/LOT_POOL）
 *   02-util.js     248..293    工具（hash32/Rng/makeSeed/clamp/money）
 *   03-core.js     294..600    Game 构造 / _init / rng / _ruleText / _newPlayer / _spawnPlayers / advanceReal / advanceGame / _tick
 *   04-ticks.js    601..891    各 tick（事件 / 价格 / 成品 / 生产 / 挂单 / 利息）
 *   05-firm.js     892..1006   consolidated / 破产 / 净值 / 倒计时 / _end
 *   06-trade.js   1007..1205   冲击 / 成交 / 报价 / 买卖
 *   07-metrics.js 1206..1348   指标与口径（good 到 monoProx）
 *   08-crop.js    1349..1442   act + 农田动作
 *   09-dealer.js  1443..1623   §17.1 收货商 + §17.2 买家 + 市场动作
 *   10-plot.js    1624..1673   地块 / 仓储 / 借贷动作
 *   11-intel.js   1674..1774   情报 / 谣言
 *   12-shorts.js  1775..1892   看跌 / 皮包
 *   13-talent.js  1893..2041   天赋 / 作坊 / 加工 / 存贷
 *   14-npc.js     2042..2227   NPC 决策
 *   15-auction.js 2228..2464   拍卖 + _log / _flush / _pidName
 *   16-settle.js  2465..2719   settle + 导出 return{...}
 */
module.exports = [
  '01-data.js',
  '02-util.js',
  '03-core.js',
  '04-ticks.js',
  '05-firm.js',
  '06-trade.js',
  '07-metrics.js',
  '08-crop.js',
  '09-dealer.js',
  '10-plot.js',
  '11-intel.js',
  '12-shorts.js',
  '13-talent.js',
  '14-npc.js',
  '15-auction.js',
  '16-settle.js',
];
