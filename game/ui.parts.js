/* ui 模块清单 —— **唯一顺序来源**。
 *
 * game/ui.bundle.js（装配器）与所有消费者（tools/build.mjs、lint-copy、ui-smoke、
 * speed-btn.test、tab-click-race.test）**都只读这里**，保证"扫的/测的/发布的"是同一段文本。
 *
 * ⚠ 顺序 = 拼接顺序。片段之间靠**同一个 IIFE 作用域**里的裸标识符互相引用
 *   （$ / esc / G / HUMAN / view / ui / toast / A / render …），被依赖的必须排在前面。
 *
 * ⚠ 迁移期的每个 part 都必须是 ui.js 原 IIFE 体的**连续切片**，一行不改；
 *   但**迁移完成之后允许新增 part**（如 17-ledger.js：它没有“原始行范围”，
   是新增的一级集团层屏幕，而非旧 ui.js 的某一段）。
 *
 * --- 拆分时的原始行范围（仅供溯源；parts 成为源文件后不再维护）---
 *   ui.js 结构：L1..10 头部注释 / L11 `(function () {` / L12 `'use strict';`
 *               L13..1388 实现体 / L1389 `})();`
 *
 *   01-util.js         13..28     $ / esc / fmt / 全局态 / LS / store
 *   02-codex.js        29..54     emptyCodex / codex / bump / recordRun
 *   03-sfx.js          55..88     WebAudio 音效
 *   04-ui-state.js     89..150    ui 状态对象 / 图标 / 时间与文案
 *   05-toast.js       151..223    TOAST_MAX / toast / moreNode / renderMore / clearMore
 *   06-act-save.js    224..268    A() 动作包装 / 自动存档 / 续档
 *   07-start.js       269..375    renderStart / start / setSpeed
 *   08-chrome.js      376..452    renderTop / renderTabs / warnBox
 *   09-farm.js        453..537    viewFarm
 *   10-market.js      538..730    spark / drawSparklines / limitBlock / DEALER / dealerBoard / buyerPanel / viewMarket
 *   11-make-intel.js  731..857    viewMake / viewIntel
 *   12-bank-auction.js 858..996   viewBank / viewAuction
 *   13-end-codex.js   997..1133   viewEnd / talentModal / viewCodex
 *   14-render.js     1134..1201   render
 *   15-events.js     1202..1329   事件委托（onPointerUp / onClick / handleAction / qtyOf）
 *   16-boot.js       1330..1388   主循环 frame / 启动 / __GG_DEBUG 导出对象
 *
 * ⚠ 本文件是 .js，注释里**不能出现 `星号+斜杠` 连写**（会提前关闭注释块）。
 */
module.exports = [
  '01-util.js',
  '02-codex.js',
  '03-sfx.js',
  '04-ui-state.js',
  '05-toast.js',
  '06-act-save.js',
  '07-start.js',
  '08-chrome.js',
  '09-farm.js',
  '10-market.js',
  '11-make-intel.js',
  '12-bank-auction.js',
  '13-end-codex.js',
  /* 17 放在 14-render 之前：本文件顶层的只有 function 声明（会提升），
     顺序不影响正确性；这样排是为了“根屏先定义、再被 render 引用”好读。 */
  '17-ledger.js',
  '18-mail.js',
  '14-render.js',
  '15-events.js',
  '16-boot.js',
];
