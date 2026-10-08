/* 把各分支文档的「待决问题清单」抽出来，填进 QUESTIONS.md 的 AUTO 标记处。
 * 目的：86 条分支问题不靠手抄（会漏、会改味），改完分支文档重跑一次就同步。
 * 用法：node tools/make-questions.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const docs = join(root, 'docs');
const target = join(root, 'QUESTIONS.md');
const MARK = '<!-- AUTO:AGENT-QUESTIONS -->';

const BRANCHES = [
  { file: '02-公司类型与互动.md', code: 'CORP', title: '公司类型与互动' },
  { file: '03-拍卖与斗争手段.md', code: 'AUC', title: '拍卖与斗争手段' },
  { file: '04-肉鸽天赋与NPC人格.md', code: 'RGN', title: '肉鸽天赋与 NPC 人格' },
  { file: '05-结算与叙事提名.md', code: 'END', title: '结算与叙事提名' },
  { file: '07-技术架构与社交合规.md', code: 'SYS', title: '技术架构与社交合规' },
];

/* 从一份文档里抽出所有 Q-XXX-nn 区块。
   两种排版都见过：
     a) **Q-CORP-01｜标题**   （加粗列表项）
     b) ### Q-RGN-01：标题    （三级标题）
*/
function extract(src, code) {
  const lines = src.split(/\r?\n/);
  // 注意要带 Q- 前缀：文档里是 **Q-CORP-01｜…** / ### Q-RGN-01：…（漏掉 Q- 会一条都抓不到）
  const reBold = new RegExp('^\\s*\\*\\*Q-' + code + '-\\d+');
  const reHead = new RegExp('^\\s*#{2,4}\\s*Q-' + code + '-\\d+');
  const starts = [];
  lines.forEach((ln, i) => { if (reBold.test(ln) || reHead.test(ln)) starts.push(i); });
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : Math.min(lines.length, from + 14);
    let block = lines.slice(from, to);
    // 砍掉下一节标题（防止把下一章并进来）
    const cut = block.findIndex((ln, i) => i > 0 && /^#{2,3}\s/.test(ln) && !new RegExp('^\\s*#{2,4}\\s*Q-' + code + '-').test(ln));
    if (cut > 0) block = block.slice(0, cut);
    // 规整成一条紧凑条目：标题 + 后续最多 4 行实质内容
    const body = block.map(s => s.trim()).filter(Boolean);
    const head = body[0].replace(/^\*\*|\*\*$/g, '').replace(/^#{2,4}\s*/, '').trim();
    const rest = body.slice(1).filter(s => s !== '---' && !/^<\/?details/.test(s)).slice(0, 4);
    out.push({ head, rest });
  }
  return out;
}

let md = '';
let total = 0;
for (const b of BRANCHES) {
  const abs = join(docs, b.file);
  if (!existsSync(abs)) { md += `\n### ${b.code} · ${b.title}\n\n_（未找到 ${b.file}）_\n`; continue; }
  const items = extract(readFileSync(abs, 'utf8'), b.code);
  total += items.length;
  md += `\n### ${b.code} · ${b.title}（${items.length} 条）\n\n`;
  md += `来源：\`docs/${b.file}\` 的 §4 待决问题清单，原文抽取。\n\n`;
  for (const it of items) {
    md += `- **${it.head}**\n`;
    for (const r of it.rest) md += `  - ${r.replace(/^[-*]\s*/, '')}\n`;
  }
}

md += `\n---\n\n**分支问题合计：${total} 条**（其中 MKT / TIME 两个分支未产出文件，相关问题见 docs/01 与 docs/06）\n`;

const src = readFileSync(target, 'utf8');
/* 幂等写法：按「## 第二部分」切分，保留第一部分原文，第二部分整块重写。
   不依赖 HTML 标记 —— 标记一旦被上一次运行吃掉，脚本就再也跑不动了（踩过）。 */
const CUT = '\n## 第二部分';
const at = src.indexOf(CUT);
if (at < 0) {
  console.error('❌ QUESTIONS.md 里找不到「## 第二部分」标题，无法定位插入点。');
  process.exit(1);
}
const head = src.slice(0, at).replace(/\s+$/, '');
const PART2 = `## 第二部分：分支评审员生成的 ${total} 条待决问题

以下为各并行评审分支自己列出的问题，**原文抽取**（含他们各自的推荐默认值）。
分支代号：\`CORP\` 公司类型 / \`AUC\` 拍卖与斗争 / \`RGN\` 肉鸽天赋 / \`END\` 结算提名 /
\`SYS\` 技术架构与合规 / \`MKT\` 市场与价格引擎 / \`TIME\` 时间结构与数值。

> 注：\`MKT\` 与 \`TIME\` 两个分支的评审 agent 连续两次崩溃、未产出文件，
> 这两部分的问题由集成者列在 \`docs/01-市场与价格引擎.md\` 与 \`docs/06-时间结构与Demo数值.md\` 中。
> 本部分由 \`node tools/make-questions.mjs\` 自动生成，**不要手改**（改分支文档后重跑即可）。

`;
writeFileSync(target, head + '\n\n' + PART2 + md.trim() + '\n', 'utf8');
console.log('✅ 已把 ' + total + ' 条分支问题写入 QUESTIONS.md（第一部分保持原样）');
