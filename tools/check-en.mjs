// 英文版同步检查：en/NN-slug.md 跟着 book/NN-*.md 走，中文版是准的。
//
//   node tools/check-en.mjs               # 按中文版重排英文条目、改条号、抄成本标签，重写 en/stale.json，列出缺译和过时
//   node tools/check-en.mjs --check       # 只查不改：有缺译、过时、多余、要重排或 stale.json 没更新，退出码 1（CI 用）
//   node tools/check-en.mjs --stamp 05    # 第 5 节译完或复查完，把这节导读和全部条目的指纹记成中文现状
//   node tools/check-en.mjs --stamp 05/3  # 只记第 5 节第 3 条
//
// 英文条目怎么和中文条目对上：每条标题下有一行 <!-- zh: 中文标题 | 指纹 -->。
// 先按中文标题全文找；找不到就按「中文标题只许加字」的规矩，找旧标题的字按顺序都在新标题里的那条。
// 指纹 = 中文条目去掉条号和成本标签后的全文的 sha1 前 8 位。中文一改，指纹就对不上，这条算过时。
// 成本标签不进指纹，由本工具直接抄过去：它只是检索页的数据，不用翻译。
// 英文条号跟中文条号走，缺译的条目留空号，这样两种语言的 #e-节-条 锚点指的是同一条。
// en/stale.json 给检索页用：列出过时和缺译的条号，检索页在这些条目上提示「以中文为准」。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const si = process.argv.indexOf('--stamp');
const STAMP = si > 0 ? process.argv[si + 1] : null;
const read = f => readFileSync(join(ROOT, f), 'utf8');
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 8);
const TAG = /^<!--\s*成本标签:/;
const KEY = /^<!-- zh: (.+) \| ([0-9a-f]{8}) -->$/;
const INTRO_KEY = /^<!-- zh-intro: ([0-9a-f]{8}) -->$/;

// 把一个文件切成 头部（含导读）+ 条目
function split(text) {
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const head = [], entries = [];
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('### ')) { cur = [l]; entries.push(cur); continue; }
    (cur ?? head).push(l);
  }
  return { head, entries };
}
const clean = ls => { const a = ls.map(l => l.trimEnd()); while (a.length && a[a.length - 1] === '') a.pop(); return a; };
const titleOf = l => l.replace(/^### \d+\.\s*/, '');
const isSubseq = (a, b) => { let i = 0; for (const c of b) if (c === a[i]) i++; return i === a.length; };

function zhSection(file) {
  const { head, entries } = split(read(join('book', file)));
  const h1 = head.find(l => l.startsWith('# ')) ?? '';
  const intro = clean(head.slice(head.indexOf(h1) + 1));
  return {
    introHash: hash([h1.replace(/^# \d+\.\s*/, ''), ...intro].join('\n')),
    entries: entries.map((ls, i) => {
      const body = clean(ls.slice(1));
      const title = titleOf(ls[0]);
      return {
        n: i + 1, title,
        tag: body.find(l => TAG.test(l)) ?? null,
        hash: hash([title, ...body.filter(l => !TAG.test(l))].join('\n')),
      };
    }),
  };
}

const zhFiles = readdirSync(join(ROOT, 'book')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
const enDir = join(ROOT, 'en');
const enFiles = existsSync(enDir) ? readdirSync(enDir).filter(f => /^\d\d-.*\.md$/.test(f)) : [];

const problems = [];          // 让 --check 失败的事
const changed = [];           // 要改写的文件
const stale = {};             // en/stale.json
let total = 0, fresh = 0;

for (const zf of zhFiles) {
  const nn = zf.slice(0, 2);
  const zh = zhSection(zf);
  total += zh.entries.length;
  const ef = enFiles.find(f => f.startsWith(nn + '-'));
  if (!ef) {
    problems.push(`第 ${+nn} 节没有英文版（en/${nn}-*.md）`);
    stale[+nn] = { intro: true, stale: [], missing: zh.entries.map(e => e.n) };
    continue;
  }
  const text = read(join('en', ef));
  const { head, entries } = split(text);

  // 导读指纹
  const ik = head.findIndex(l => INTRO_KEY.test(l));
  if (ik < 0) problems.push(`en/${ef} 导读缺 <!-- zh-intro: 指纹 --> 行`);
  const stampAll = STAMP === nn || STAMP === String(+nn);
  if (ik >= 0 && stampAll) head[ik] = `<!-- zh-intro: ${zh.introHash} -->`;
  const introStale = ik < 0 || head[ik].match(INTRO_KEY)[1] !== zh.introHash;
  if (introStale) problems.push(`第 ${+nn} 节导读的英文过时`);

  // 英文条目逐条对上中文条目
  const en = entries.map(ls => {
    const ki = ls.findIndex(l => KEY.test(l));
    const m = ki >= 0 ? ls[ki].match(KEY) : null;
    return { ls, ki, zhTitle: m?.[1], hash: m?.[2], match: null };
  });
  const taken = new Set();
  for (const e of en) {
    if (e.ki < 0) { problems.push(`en/${ef}「${titleOf(e.ls[0])}」缺 <!-- zh: 中文标题 | 指纹 --> 行`); continue; }
    let z = zh.entries.find(z => z.title === e.zhTitle && !taken.has(z));
    if (!z) {
      const cands = zh.entries.filter(z => !taken.has(z) && isSubseq(e.zhTitle, z.title));
      if (cands.length === 1) z = cands[0];
    }
    if (z) { e.match = z; taken.add(z); }
    else problems.push(`en/${ef}「${e.zhTitle}」在中文版里找不到对应条目（删了，或者标题被删字换词了）`);
  }

  const s = { intro: introStale, stale: [], missing: [] };
  for (const z of zh.entries) {
    const e = en.find(e => e.match === z);
    if (!e) { s.missing.push(z.n); problems.push(`第 ${+nn} 节第 ${z.n} 条「${z.title}」没有英文`); continue; }
    const target = STAMP === `${nn}/${z.n}` || STAMP === `${+nn}/${z.n}`;
    if (stampAll || target) e.hash = z.hash;
    // 改写：条号跟中文、成本标签照抄、zh 行记当前中文标题和指纹
    e.ls[0] = e.ls[0].replace(/^### \d+\./, `### ${z.n}.`);
    e.ls[e.ki] = `<!-- zh: ${z.title} | ${e.hash} -->`;
    const ti = e.ls.findIndex(l => TAG.test(l));
    if (z.tag && ti >= 0) e.ls[ti] = z.tag;
    else if (z.tag) e.ls.splice(1, 0, z.tag), e.ki++;
    if (e.hash !== z.hash) { s.stale.push(z.n); problems.push(`第 ${+nn} 节第 ${z.n} 条「${z.title}」中文改过，英文过时`); }
    else fresh++;
  }
  stale[+nn] = s;

  // 按中文顺序排，对不上的留在最后
  const ordered = [...en.filter(e => e.match).sort((a, b) => a.match.n - b.match.n), ...en.filter(e => !e.match)];
  const blocks = ordered.map(e => clean(e.ls).join('\n'));
  const out = clean(head).join('\n') + '\n\n' + blocks.join('\n\n') + '\n';
  if (out !== text) changed.push([join('en', ef), out]);
}

for (const ef of enFiles) if (!zhFiles.some(z => z.startsWith(ef.slice(0, 2) + '-'))) problems.push(`en/${ef} 没有对应的中文节`);

// 一节一行，diff 好看
const staleJson = '{\n' + Object.entries(stale).map(([k, v]) => ` "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n}\n';
const staleOld = existsSync(join(enDir, 'stale.json')) ? read('en/stale.json') : '';
if (staleJson !== staleOld) changed.push(['en/stale.json', staleJson]);

for (const p of problems) console.log('  ' + p);
console.log(`\n英文版：${total} 条中 ${fresh} 条已译且是最新的`);

if (CHECK) {
  for (const [f] of changed) console.log(`  ${f} 要更新（条目顺序、条号、成本标签或 stale.json）`);
  if (problems.length || changed.length) {
    console.log('\n译文同步检查没过。中文改过的条目照中文重译，然后 node tools/check-en.mjs --stamp 节号/条号。');
    process.exit(1);
  }
  console.log('译文同步检查通过');
} else {
  for (const [f, t] of changed) { writeFileSync(join(ROOT, f), t); console.log(`  已改写 ${f}`); }
}
