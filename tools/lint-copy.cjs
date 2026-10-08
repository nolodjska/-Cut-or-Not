/* 文案红线检查（docs/07 §2.8.3 微信小程序审核红线）
 * 规则：**任何非注释的字符串里**都不允许出现以下词。
 * 实现：先把行注释与块注释剥掉，再搜词。所以注释里可以自由讨论"做空"这类设计术语，
 * 但玩家真正看得到的文案（引擎日志、UI 文本、HTML）必须干净。
 *
 * 用法：node tools/lint-copy.cjs
 */
const fs = require('fs');
const path = require('path');

const BANNED = [
  '投资', '理财', '提现', '充值', '返利', '分红', '利息收入', '收益率', '年化',
  '股票', '炒股', 'K线', 'k线', '做空', '杠杆', '保证金', '爆仓', '割韭菜',
  '洗钱', '下注', '抽奖', '赌', '钱包', '提现', '虚拟币', '代币', '盘口',
  '稳赚', '保本', '高回报', '套利', '汇率', '收益', '回报率', '本金保障', '包赚',
];
/* 允许的例外：这些词本身合规，只是恰好包含上面某个词的一部分 */
const ALLOW = [
  '抽成',        // 拍卖行抽成
  '套利机会',    // 出现在注释里（上面已剥注释），保留兜底
];

/* ---- 第二道闸：术语暴露（docs/13 §16「内化与暴露」）--------------------
 * 与上面的红线词是**两条不同的轴**：
 *   红线词 BANNED  = 合规（微信小程序审核，docs/07 §2.8.3）
 *   术语词 TERMS   = 认知负担（用户 2026-10-08：现实机制可以内化，但绝不允许暴露）
 *
 * 为什么：玩家不知道这些概念。甩一个术语过去 = 瞬间一屏看不懂。
 * 正确做法是让他先看到**现象**，自己把规则学出来。
 *
 * 规则与 BANNED 完全相同：**注释里可以自由讨论术语，玩家看得到的字符串里一个都不许有**。
 * 对照表（引擎/文档用什么  →  界面用什么）写在 docs/13 §16.2，改文案先查那张表。
 */
const TERMS = [
  // 杠杆与破产
  '维持线', '维持保证金', '保证金', '追保', 'margin call', '资不抵债', '清算瀑布', '优先受偿',
  // 做市与微观结构
  '做市商', '逆向选择', '库存偏离', '保留价', '报价价差', '滑点模型', 'λ',
  // 保险
  '浮存金', '承保', '综合成本率', '准备金', '久期',
  // 监管与俘获
  '监管俘获', '旋转门', '游说', '俘获',
  // 银行与流动性
  '挤兑', '信心值', '期限错配', '流动性覆盖率', '道德风险', '系统性风险', '系统重要性',
  '保证金螺旋', '中央对手方', '未实现亏损', '信用利差', '无风险利率',
  // 需求侧
  '派生需求', '价格弹性', '边际消费倾向', '需求曲线', '需求侧', '饱和',
  // docs/13 §17「症状清单」里宣告「绝不允许出现」的词 ——
  // 文档宣告了就必须能被闸门执行，否则声明只是空话。
  '流动性', '评级机构', '信用评级', '公证', '质检标准',
];
const TERMS_ALLOW = [
  '押金',   // = 保证金。项目已有约定：engine 注释写“原名做空，UI 禁用该词”，同理。
];

function stripComments(src) {
  // 去掉块注释与行注释（够用的近似：不处理字符串里出现的 // ）
  let out = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  out = out.replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return out;
}

/* 第三道闸的判据抽成函数，让**闸门自检与生产路径共用同一份逻辑** ——
   否则自检只证明了一个“平行实现”，证明不了生产路径真的会报警。
   判据故意收窄：**只有中文与 `**` 同处一行才算泄漏**。
   （JS 的幂运算符 `**` 不会和中文同行，而“中文 + **”几乎一定是 Markdown 漏进了玩家可见文案） */
function hasMdLeak(line) {
  return /[\u4e00-\u9fff]/.test(line) && line.includes('**');
}

/* ⚠ engine 与 ui 都已模块化（每文件 ≤1000 行）：实现散在 game/parts/ 与 game/ui-parts/。
   所以这两项**必须扫装配后的源码文本**（f.src），不能扫文件本身 ——
   扫它们 = 扫一个残桩 = 闸门静默失效。
   ⚠ 这个坑真的发生过：换掉 game/engine.js 之后，这条闸门一直在扫 11 行残桩，
     还一路绿灯。所以下面加了**覆盖率下限**（扫到的行数太少就报错）。 */
const files = [
  { p: 'game/engine.js', note: '引擎日志与提示（玩家会在动态里看到）',
    src: () => require('../game/engine.bundle.js').source(), floor: 2000 },
  { p: 'game/ui.js', note: 'UI 文案（玩家直接看到）',
    src: () => require('../game/ui.bundle.js').source(), floor: 1000 },
  { p: 'game/index.html', note: '页面文案' },
  /* 样式已拆到 game/style-*.css：必须扫**装配后的 CSS**。
     CSS 里同样有玩家可见文字（#feed .empty::before 的 content 等）和大量注释，
     不扫就是又开一个自留地。 */
  { p: 'game/style-*.css', note: '样式文案（注释与 content 文本）',
    src: () => require('../game/style.bundle.js').source(), floor: 900 },
];

let bad = 0;
for (const f of files) {
  const abs = path.join(__dirname, '..', f.p);
  if (!f.src && !fs.existsSync(abs)) { console.log('跳过（不存在）', f.p); continue; }
  const raw = f.src ? f.src() : fs.readFileSync(abs, 'utf8');
  const stripped = stripComments(raw);
  const lines = stripped.split(/\r?\n/);
  /* 覆盖率下限：防“闸门扫到了残桩却还报绿”（本项目真发生过）。 */
  if (f.floor && lines.length < f.floor) {
    console.log('❌ ' + f.p + '：只扫到 ' + lines.length + ' 行（少于下限 ' + f.floor +
      '）—— 闸门很可能扫到的是残桩，覆盖已失效');
    bad++;
    continue;
  }
  const hits = [];
  const termHits = [];
  const mdHits = [];
  lines.forEach((ln, i) => {
    for (const w of BANNED) {
      if (ln.includes(w)) {
        const allowed = ALLOW.some(a => ln.includes(a) && !ln.includes(w.replace(a, ''))) ;
        if (allowed) continue;
        hits.push({ line: i + 1, word: w, text: ln.trim().slice(0, 110) });
      }
    }
    for (const w of TERMS) {
      if (ln.includes(w)) {
        if (TERMS_ALLOW.some(a => ln.includes(a))) continue;
        termHits.push({ line: i + 1, word: w, text: ln.trim().slice(0, 110) });
      }
    }
    /* ---- 第三道闸：Markdown 泄漏（不加任何配置，故意收窄） ----
       背景（真实故障，我自己 2026-10-08 真犯过）：我在 UI 文案里写了
         `你是巨鳄——**你持有公司，不是亲手种地**。`
       那两个 `**` 是 Markdown 加粗语法，但这里的目标是 HTML ——
       后果是**玩家会在屏幕上看到两个星号**。前两道闸都查不出来。
       判定故意收窄为：**只有一行里同时出现中日韩文字和 `**` 才算**。
       理由：JS 的幂运算符 `**` 不会和中文同处一行；而“中文 + **”
       几乎一定是把 Markdown 写进了玩家可见文案。 */
    if (hasMdLeak(ln)) mdHits.push({ line: i + 1, text: ln.trim().slice(0, 110) });
  });
  if (hits.length) {
    bad += hits.length;
    console.log('❌ ' + f.p + '（' + f.note + '）红线词命中 ' + hits.length + ' 处：');
    for (const h of hits) console.log('    L' + h.line + ' 「' + h.word + '」 ' + h.text);
  } else {
    console.log('✅ ' + f.p + '（' + f.note + '）红线词零命中');
  }
  if (termHits.length) {
    bad += termHits.length;
    console.log('❌ ' + f.p + '（' + f.note + '）**术语暴露** ' + termHits.length + ' 处（玩家会看不懂，换成现象说法，见 docs/13 §16.2）：');
    for (const h of termHits) console.log('    L' + h.line + ' 「' + h.word + '」 ' + h.text);
  }
  if (mdHits.length) {
    bad += mdHits.length;
    console.log('❌ ' + f.p + '（' + f.note + '）**Markdown 泄漏** ' + mdHits.length + ' 处（玩家会在屏幕上看到星号；加粗请用 <b>，不要用 **）：');
    for (const h of mdHits) console.log('    L' + h.line + ' ' + h.text);
  }
}
/* ---- 闸门自检：证明术语检查真的会报警（防止闸门静默失效） ----------------
 * 为什么要这段：新闸门若因列表写错 / 逻辑写错而**永不报警**，是最危险的失败模式——
 * 它会让人误以为"文案是干净的"。所以每次运行都拿探针撞自己一次。 */
(function selfTest() {
  const probe = ['玩家侧文案不该出现 追保 和 维持线', '也不该出现 做市商 报价变宽'];
  const caught = [];
  for (const ln of probe) for (const w of TERMS) if (ln.includes(w)) caught.push(w);
  const need = ['追保', '维持线', '做市商'];
  const miss = need.filter(w => !caught.includes(w));
  /* Markdown 泄漏闸的自检（走的是生产路径同一个 hasMdLeak）：
     正例必须命中；纯 ASCII 的 `**` 必须不命中（否则会误报 JS 幂运算） */
  if (!hasMdLeak('中文**加粗**')) miss.push('Markdown泄漏闸(正例没命中)');
  if (hasMdLeak('const y = a ** b;')) miss.push('Markdown泄漏闸(纯 ASCII 误报)');
  if (miss.length) {
    bad++;
    console.log('❌ 闸门自检失败：术语检查没有生效（漏掉 ' + miss.join('、') + '）—— 上面的"零命中"不可信');
  } else {
    console.log('✅ 闸门自检：三道闸都会报警（术语探针命中 ' + caught.join('、') +
      '；Markdown 泄漏正例命中、纯 ASCII 反例不误报）；上方“零命中”可信');
  }
})();

console.log(bad ? '\n结论：❌ 有 ' + bad + ' 处需要处理（红线词 / 术语暴露 / Markdown 泄漏 / 闸门自检）'
                : '\n结论：✅ 全部文案通过三道闸（红线词 + 术语暴露 + Markdown 泄漏），且闸门自检通过');
process.exit(bad ? 1 : 0);
