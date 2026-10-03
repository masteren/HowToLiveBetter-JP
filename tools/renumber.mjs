// 按性价比重排指定的节，并同步全书引用和核实记录的标题。
//
//   node tools/renumber.mjs 6 10        # 重排第 6、10 节
//   node tools/renumber.mjs 6 --dry     # 只打印新旧条号，不写文件
//
// 排序和 index.html 的性价比档一致：先按档（极高、高、一般），同档里收益大的在前，
// 再按成本分从低到高，最后保持原来的先后。
// 引用的改法：全书「第 X 节第 Y 条」里 X 是被重排的节就改 Y；被重排的节自己文件里的
// 「本节第 Y 条」和裸「第 Y 条」也改。紧挨着法规名的（「道路交通法第 72 条」）当法条跳过，
// 判据和 check-refs.mjs 相同。所以法条引文必须自带法名，写成「第 117 条」会被当成条目引用改掉。
// 核实记录的正文不改：它记的是写记录时的状态，里面还混着原书的条号。只把「## N.」标题
// 换成新条号、按新顺序排，并在开头附一张旧→新对照。
// 跑完一定要跑 node tools/check-refs.mjs --check，并扫 docs/引用对照.md 的 diff。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const SECS = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
const DRY = process.argv.includes('--dry');
if (!SECS.length) { console.error('用法：node tools/renumber.mjs <节号> [...] [--dry]'); process.exit(1); }

const COST_W = { money: { '0': 0, '少': 1, '多': 2 }, time: { '少': 0, '中': 1, '多': 2 }, will: { '否': 0, '些': 1, '是': 2 } };
const TIER = { '极高': 3, '高': 2, '一般': 1 }, LV = { '大': 3, '中': 2, '小': 1 };
const bookFiles = readdirSync(ROOT + 'book').filter(f => /^\d\d-.*\.md$/.test(f)).sort();
const fileOf = n => bookFiles.find(f => Number(f.slice(0, 2)) === n);

const MAP = new Map(); // 节号 -> Map(旧条号 -> 新条号)
for (const s of SECS) {
  const f = fileOf(s);
  const text = readFileSync(ROOT + 'book/' + f, 'utf8').replace(/\r\n/g, '\n');
  const i0 = text.search(/^### \d+\. /m);
  const head = text.slice(0, i0);
  const ents = text.slice(i0).split(/\n(?=### \d+\. )/).map((b, idx) => {
    b = b.replace(/\s+$/, '');
    const n = Number(/^### (\d+)\. /.exec(b)[1]);
    const tag = /成本标签: 钱=(\S+) 时间=(\S+) 毅力=(\S+) 收益=(\S+)/.exec(b);
    if (!tag) throw new Error(`${f} 第 ${n} 条没有成本标签`);
    const cs = COST_W.money[tag[1]] + COST_W.time[tag[2]] + COST_W.will[tag[3]];
    const lv = tag[4];
    const ratio = lv === '大' ? (cs === 0 ? '极高' : (cs <= 2 ? '高' : '一般')) : (lv === '中' && cs === 0 ? '高' : '一般');
    return { b, n, idx, cs, lv, ratio };
  });
  const sorted = [...ents].sort((x, y) => TIER[y.ratio] - TIER[x.ratio] || LV[y.lv] - LV[x.lv] || x.cs - y.cs || x.idx - y.idx);
  const m = new Map(sorted.map((e, k) => [e.n, k + 1]));
  MAP.set(s, m);
  console.log(`第 ${s} 节：` + sorted.map(e => `${e.n}→${m.get(e.n)}`).join(' '));
  if (!DRY) writeFileSync(ROOT + 'book/' + f, head + sorted.map(e => e.b.replace(/^### \d+\. /, `### ${m.get(e.n)}. `)).join('\n\n') + '\n');
}
if (DRY) process.exit(0);

const SPEC = '[\\d、,\\s]+?(?:(?:到|至)\\s*第?\\s*\\d+)?';
const CITE = /(《[^》]*》|〔[^〕]*〕|\d+\s*号|该(?:解释|意见|办法|规定|条例|通知|法)|[^\s，。；：、（）「」]{0,8}(?:法|条例|办法|规定|准则|细则|公约))$/;
const warn = [];
const mapSpec = (spec, m, where) => spec.replace(/\d+/g, d => {
  if (/到|至/.test(spec)) warn.push(`区间引用要人工看：${where}「${spec}」`);
  const v = m.get(Number(d));
  if (v === undefined) { warn.push(`找不到第 ${d} 条，没改：${where}`); return d; }
  return String(v);
});
function fixLine(line, selfSec, where) {
  const re = new RegExp(`第\\s*(\\d+)\\s*节第\\s*(${SPEC})\\s*条|第\\s*(${SPEC})\\s*条`, 'g');
  return line.replace(re, (all, sec, spec1, spec2, off) => {
    if (sec !== undefined) {
      const m = MAP.get(Number(sec));
      return m ? all.replace(spec1, mapSpec(spec1, m, where)) : all;
    }
    if (selfSec === null || !MAP.has(selfSec)) return all;
    if (CITE.test(line.slice(0, off).replace(/\s+$/, ''))) return all;
    return all.replace(spec2, mapSpec(spec2, MAP.get(selfSec), where));
  });
}

// 正文：条目里只改那几个栏位（和 check-refs 一致），节首整段都改
const FIELDS = /^- (说人话|收益|备注|成本)：/;
for (const f of bookFiles) {
  const s = Number(f.slice(0, 2)), p = ROOT + 'book/' + f;
  const t = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  let inEntry = false;
  const out = t.split('\n').map((L, i) => {
    if (/^### \d+\. /.test(L)) { inEntry = true; return L; }
    if (inEntry && !/^- (说人话|收益|备注|成本|来源)：/.test(L)) return L;
    return fixLine(L, !inEntry || FIELDS.test(L) ? s : null, `${f}:${i + 1}`);
  }).join('\n');
  if (out !== t) writeFileSync(p, out);
}
// 长文：只有带节号的引用
for (const f of readdirSync(ROOT + 'docs').filter(f => f.endsWith('.md') && f !== '引用对照.md')) {
  const p = ROOT + 'docs/' + f, t = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const out = t.split('\n').map((L, i) => fixLine(L, null, `docs/${f}:${i + 1}`)).join('\n');
  if (out !== t) writeFileSync(p, out);
}
// 核实记录：只重排标题
for (const s of SECS) {
  const p = ROOT + 'docs/核实记录/' + fileOf(s);
  if (!existsSync(p)) continue;
  const m = MAP.get(s), t = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const i0 = t.search(/^## \d+\. /m);
  if (i0 < 0) continue;
  let pre = t.slice(0, i0).replace(/\s+$/, '');
  const blocks = [];
  for (const b of t.slice(i0).split(/\n(?=## )/)) {
    const h = /^## (\d+)\. /.exec(b);
    if (h && m.has(Number(h[1]))) blocks.push({ n: m.get(Number(h[1])), b: b.replace(/^## \d+\. /, `## ${m.get(Number(h[1]))}. `).replace(/\s+$/, '') });
    else if (h) warn.push(`核实记录 ${fileOf(s)} 有正文里没有的第 ${h[1]} 条，没动`), blocks.push({ n: 999, b: b.replace(/\s+$/, '') });
    else pre += '\n\n' + b.replace(/\s+$/, '');
  }
  blocks.sort((x, y) => x.n - y.n);
  const pairs = [...m].sort((x, y) => x[0] - y[0]).map(([o, n]) => `${o}→${n}`).join('、');
  const today = new Date().toISOString().slice(0, 10);
  pre += `\n\n${today} 本节按性价比重排过。下面各条标题前的编号是重排后的；记录正文里提到的本节条号是写记录时的旧编号，旧→新对照：${pairs}。`;
  writeFileSync(p, pre + '\n\n' + blocks.map(x => x.b).join('\n\n') + '\n');
}
for (const w of [...new Set(warn)]) console.log('注意：' + w);
console.log('改完了。接着跑 node tools/check-refs.mjs --check，再看 docs/引用对照.md 的 diff。');
