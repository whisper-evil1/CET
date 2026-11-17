#!/usr/bin/env node
/**
 * 题材去重审计：找出「同一题材写了多套卷」的篇目。
 *
 * 做法：把每篇正文切成实词，取词频前 14 个作为签名，两篇签名交集 / 较小集合 ≥ 0.5
 * 即判为疑似同题材。只读，不改文件。
 *
 * 用法：node scripts/audit-topics.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./papers-catalog.mjs";

const DIR = path.join(process.cwd(), "data", "papers");
const JSON_OUT = process.argv.includes("--json");
const ids = new Set(buildCatalog().map((e) => e.id));

const STOP = new Set(
  "the a an and or but of to in on for with that this these those is are was were be been being it its as at by from not no than then so such which who whom whose what when where why how more most less least very much many few other another same own only just also however therefore because while if though although about into over under between among during before after above below up down out off again further once here there all any both each either neither one two three four five six seven eight nine ten first second new old".split(
    " ",
  ),
);

const items = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const id = file.replace(/\.json$/, "");
  if (!ids.has(id)) continue;
  const json = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const reading = (json.sections ?? []).find((s) => s.type === "reading");
  (reading?.passages ?? []).forEach((p, i) => {
    const txt = (p.paragraphs ?? [])
      .filter((x) => x.label !== "词库")
      .map((x) => x.text)
      .join(" ")
      .toLowerCase();
    const words = txt.split(/[^a-z]+/).filter((w) => w.length > 4 && !STOP.has(w));
    const freq = new Map();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map((x) => x[0]);
    items.push({
      id,
      idx: i + 1,
      title: p.title,
      top,
      lead: txt.slice(0, 90),
      words,
    });
  });
}

const pairs = [];
for (let i = 0; i < items.length; i += 1) {
  for (let j = i + 1; j < items.length; j += 1) {
    const A = new Set(items[i].top);
    const B = new Set(items[j].top);
    const inter = [...A].filter((x) => B.has(x)).length;
    const score = inter / Math.min(A.size, B.size);
    if (score >= 0.5) pairs.push({ score, a: items[i], b: items[j] });
  }
}
pairs.sort((x, y) => y.score - x.score);

if (JSON_OUT) {
  console.log(JSON.stringify(pairs.map((p) => ({ score: +p.score.toFixed(2), a: `${p.a.id}#${p.a.idx}`, b: `${p.b.id}#${p.b.idx}` })), null, 1));
} else {
  console.log(`篇目 ${items.length} 篇，疑似同题材 ${pairs.length} 对\n`);
  for (const p of pairs) {
    console.log(`${p.score.toFixed(2)}  ${p.a.id}#${p.a.idx} ↔ ${p.b.id}#${p.b.idx}`);
    console.log(`      ${p.a.top.slice(0, 5).join(", ")}`);
  }
}
