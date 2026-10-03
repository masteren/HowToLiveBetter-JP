// 跟原书的修正：比较原书两个提交之间每一条的正文，列出本书要复查的条目。
// 本书沿用原书的条目，标题下记着 <!-- 原条目: 原书文件 / 原书标题 -->，按「文件 + 标题」对应。
// 原书规定标题只许加字、不许删字换词，所以标题改了的，按「新标题包含旧标题」认作同一条。
// 比较前去掉条号（标题里的「N. 」和正文里的「第 N 条 / 第 N 节」），原书插一条、后面整体顺延的不算改动。
//
// 用法：
//   node tools/upstream-check.mjs <原书本地仓库>            从 tools/upstream-base.txt 记的提交比到原书 HEAD
//   node tools/upstream-check.mjs <原书本地仓库> --since <提交>
//   node tools/upstream-check.mjs <原书本地仓库> --update   复查完以后，把同步点记成原书 HEAD
// 原书仓库要先自己 clone 或 pull：git clone https://github.com/eternity4719/HowToLiveBetter
import { readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT, read } from './lib/book.mjs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const up = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--since');
if (!up) {
  console.error('用法：node tools/upstream-check.mjs <原书本地仓库> [--since <提交>] [--update]');
  process.exit(2);
}
const BASE_FILE = 'tools/upstream-base.txt';
const git = (...a) => execFileSync('git', ['-C', up, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const head = git('rev-parse', '--short', 'HEAD').trim();

if (args.includes('--update')) {
  writeFileSync(resolve(ROOT, BASE_FILE), head + '\n');
  console.log(`同步点记成原书 ${head}`);
  process.exit(0);
}
const since = flag('--since') ?? read(BASE_FILE).trim();

// 每个 ### 条目的标题（去掉「N. 」）和正文，遇到 # 或 ## 标题就结束
function items(text) {
  const out = [];
  let cur = null;
  for (const l of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = l.match(/^### (?:\d+\.\s*)?(.+?)\s*$/);
    if (m) out.push(cur = { title: m[1], lines: [] });
    else if (/^#{1,2} /.test(l)) cur = null;
    else if (cur) cur.lines.push(l);
  }
  return out.map(({ title, lines }) => ({ title, body: lines.join('\n').replace(/第 \d+ (节|条)/g, '第 N $1').trim() }));
}
const show = (rev, f) => { try { return git('show', `${rev}:${f}`); } catch { return ''; } };

// 原书改动过的条目：{ file, title（新标题）, oldTitle, kind }
const changed = [];
const rows = git('diff', '--name-status', `${since}..HEAD`, '--', 'book').trim().split('\n').filter(Boolean);
for (const row of rows) {
  const [st, ...ps] = row.split('\t');
  const fOld = ps[0], f = ps.at(-1);
  const name = f.replace(/^book\//, '');
  if (st.startsWith('R')) console.log(`注意：原书 ${fOld} 改名成 ${f}，本书原条目注释里的文件名要跟着改\n`);
  const oldMap = new Map(items(show(since, fOld)).map(i => [i.title, i.body]));
  const newMap = new Map(items(show('HEAD', f)).map(i => [i.title, i.body]));
  const back = new Map(); // 新标题 → 旧标题
  for (const t of newMap.keys()) if (!oldMap.has(t)) {
    const o = [...oldMap.keys()].find(o => !newMap.has(o) && t.includes(o));
    if (o) back.set(t, o);
  }
  const renamedOld = new Set(back.values());
  for (const [t, body] of newMap) {
    if (back.has(t)) changed.push({ file: name, title: t, oldTitle: back.get(t), kind: oldMap.get(back.get(t)) === body ? '改了标题' : '改了标题和内容' });
    else if (!oldMap.has(t)) changed.push({ file: name, title: t, kind: '新增' });
    else if (oldMap.get(t) !== body) changed.push({ file: name, title: t, kind: '改了内容' });
  }
  for (const t of oldMap.keys()) if (!newMap.has(t) && !renamedOld.has(t)) changed.push({ file: name, title: t, kind: '删掉或改得认不出' });
}

// 本书的原条目注释
const ours = [];
for (const f of readdirSync(resolve(ROOT, 'book')).filter(f => f.endsWith('.md'))) {
  items(read(`book/${f}`)).forEach((it, i) => {
    const m = it.body.match(/<!-- 原条目: (.+?) \/ (.+?) -->/);
    if (m) ours.push({ file: f, n: i + 1, title: it.title, upFile: m[1], upTitle: m[2] });
  });
}

const review = [], fresh = [];
let skipped = 0;
for (const c of changed) {
  const mine = ours.filter(o => o.upFile === c.file && (o.upTitle === c.title || o.upTitle === c.oldTitle));
  if (mine.length) review.push({ c, mine });
  else if (c.kind === '新增') fresh.push(c);
  else skipped++;
}

console.log(`原书 ${since}..${head}：改动 ${changed.length} 条，其中本书沿用的 ${review.length} 条\n`);
console.log('## 本书要复查的条目');
if (!review.length) console.log('（没有）');
for (const { c, mine } of review) for (const o of mine) {
  console.log(`- book/${o.file} 第 ${o.n} 条「${o.title}」`);
  console.log(`  ← 原书 ${c.file}「${c.title}」${c.kind}${c.oldTitle ? `，旧标题「${c.oldTitle}」，原条目注释要改成新标题` : ''}`);
}
console.log('\n## 原书新增的条目（本书没搬，看要不要搬）');
if (!fresh.length) console.log('（没有）');
for (const c of fresh) console.log(`- ${c.file}「${c.title}」`);
console.log(`\n原书改了、本书没沿用的条目 ${skipped} 条，不用管。`);
console.log(`看原书具体改了什么：git -C ${up} diff ${since}..HEAD -- book/<文件>`);
console.log(`复查完跑 node tools/upstream-check.mjs ${up} --update，把同步点记成 ${head}。`);
