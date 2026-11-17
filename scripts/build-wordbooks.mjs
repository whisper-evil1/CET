/**
 * 生成四六级高频词书：data/wordbooks.json
 *
 * 「高频」不是拍脑袋定的，依据是 ECDICT 自带的两个词频字段：
 *   frq —— COCA（当代美国英语语料库）词频排名，1 为最高频
 *   bnc —— BNC（英国国家语料库）词频排名
 * 取两者中更靠前的名次作为 rank，排名越小 = 在真实语料里越常见。
 * 再加上考纲标签（cet4 / cet6）与柯林斯星级、牛津核心词标记做交叉筛选。
 *
 * 词书里只存 word / rank / collins / oxford，释义不重复落盘——
 * 统一从 data/offline-dict.json 取（1.5 万条，同一份数据源，不会出现两处释义不一致）。
 *
 * 用法：node scripts/build-wordbooks.mjs
 */
import fs from "node:fs";
import { createInterface } from "node:readline";

const CSV = "node_modules/ecdict/assets/ecdict.csv";
const OFFLINE = "data/offline-dict.json";
const OUT = "data/wordbooks.json";

/** 每个词书的取词上限 */
const LIMITS = { cet4: 1500, cet6: 1500, essential: 800 };

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else current += ch;
  }
  result.push(current);
  return result;
}

const offline = JSON.parse(fs.readFileSync(OFFLINE, "utf8"));

const rl = createInterface({
  input: fs.createReadStream(CSV, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

let header = null;
const cet4 = [];
const cet6only = [];
const essential = [];
let scanned = 0;

rl.on("line", (line) => {
  if (!header) {
    header = parseCsvLine(line);
    return;
  }
  const cols = parseCsvLine(line);
  if (cols.length < header.length) return;

  const row = {};
  for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? "";

  const word = (row.word ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z'-]*$/.test(word)) return;
  if (!offline[word]) return; // 释义必须在离线词库里，保证导入时不用联网

  const tags = (row.tag ?? "").split(/\s+/).filter(Boolean);
  const isC4 = tags.indexOf("cet4") >= 0;
  const isC6 = tags.indexOf("cet6") >= 0;
  if (!isC4 && !isC6) return;

  const frq = Number(row.frq) || 0;
  const bnc = Number(row.bnc) || 0;
  const positives = [frq, bnc].filter((n) => n > 0);
  if (positives.length === 0) return; // 没有词频数据 = 无法判断高频，直接排除

  const rank = Math.min.apply(null, positives);
  const collins = Number(row.collins) || 0;
  const oxford = row.oxford === "1";
  const entry = { w: word, r: rank, c: collins, o: oxford ? 1 : 0 };

  scanned++;
  if (isC4) cet4.push(entry);
  if (isC6 && !isC4) cet6only.push(entry);
  if ((collins >= 4 || oxford) && (isC4 || isC6)) essential.push(entry);
});

const byRank = (a, b) => a.r - b.r || (a.w < b.w ? -1 : 1);

rl.on("close", () => {
  /** 去重（同一单词理论上只有一行，这里兜底） */
  const dedupe = (list) => {
    const seen = new Set();
    const out = [];
    list.sort(byRank);
    for (const item of list) {
      if (seen.has(item.w)) continue;
      seen.add(item.w);
      out.push(item);
    }
    return out;
  };

  const books = [
    {
      id: "cet4-core",
      name: "四级高频",
      level: "CET4",
      rule: "考纲含 CET4 标签，按 COCA / BNC 综合词频排名取前 1500",
      entries: dedupe(cet4).slice(0, LIMITS.cet4),
    },
    {
      id: "cet6-core",
      name: "六级高频",
      level: "CET6",
      rule: "考纲含 CET6 且不含 CET4（六级新增词），按词频排名取前 1500",
      entries: dedupe(cet6only).slice(0, LIMITS.cet6),
    },
    {
      id: "cet-essential",
      name: "四六级必备核心",
      level: "CET4+CET6",
      rule: "柯林斯 4 星以上或牛津核心词，且属四六级考纲，按词频排名取前 800",
      entries: dedupe(essential).slice(0, LIMITS.essential),
    },
  ];

  const payload = {
    version: 1,
    source: "ECDICT 词频字段（COCA frq / BNC bnc）+ 四六级考纲标签",
    builtAt: new Date().toISOString().slice(0, 10),
    books: books.map((b) => ({
      id: b.id,
      name: b.name,
      level: b.level,
      rule: b.rule,
      count: b.entries.length,
      entries: b.entries,
    })),
  };

  fs.writeFileSync(OUT, JSON.stringify(payload), "utf8");
  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(0);

  console.log(`扫描命中四六级词：${scanned}`);
  for (const b of payload.books) {
    const head = b.entries.slice(0, 6).map((e) => `${e.w}(${e.r})`).join(", ");
    const last = b.entries[b.entries.length - 1];
    console.log(`  ${b.id} ${b.count} 词  ${head} … 末位 ${last.w}(${last.r})`);
  }
  console.log(`写出 ${OUT}（${sizeKB} KB）`);
});
