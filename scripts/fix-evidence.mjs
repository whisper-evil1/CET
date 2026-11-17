#!/usr/bin/env node
/**
 * 修「原文依据」指错段的问题。
 *
 * 每道题带 `evidencePara` + `evidenceText`，刷题页据此把原文那段标出来。批量生产时常见的
 * 两类瑕疵：
 *   1. 引文本身是原文的一句话，但 `evidencePara` 指错了段（高亮到别的段，等于误导）；
 *   2. 引文是改写/带省略号的概括，原文里没有逐字对应（高亮不到，但解析里说得清，可以留着）。
 *
 * 这个脚本只处理第 1 类：在**本篇其它段落**里逐字找到引文 → 改为那一段的 label。
 * 找不到（第 2 类）就原样保留，只统计。
 *
 * 用法：
 *   node scripts/fix-evidence.mjs --check   # 只统计，不改文件
 *   node scripts/fix-evidence.mjs           # 修好并写回 JSON
 */
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./papers-catalog.mjs";

const DIR = path.join(process.cwd(), "data", "papers");
const DRY = process.argv.includes("--check");
const ids = new Set(buildCatalog().map((e) => e.id));
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

let total = 0;
let wrongPara = 0;
let fixed = 0;
let paraphrase = 0;
const leftovers = [];

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const id = file.replace(/\.json$/, "");
  if (!ids.has(id)) continue;
  const full = path.join(DIR, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  let dirty = false;

  for (const section of json.sections ?? []) {
    for (const passage of section.passages ?? []) {
      const paras = (passage.paragraphs ?? []).map((p) => ({ label: p.label, text: norm(p.text) }));
      for (const q of passage.questions ?? []) {
        const evidence = norm(q.evidenceText);
        if (!evidence) continue;
        total += 1;
        const own = paras.find((p) => p.label === q.evidencePara);
        if (own && own.text.includes(evidence)) continue;

        wrongPara += 1;
        const hits = paras.filter((p) => p.text.includes(evidence));
        if (hits.length === 1) {
          q.evidencePara = hits[0].label;
          fixed += 1;
          dirty = true;
        } else {
          paraphrase += 1;
          leftovers.push(`${id}#${q.number}`);
        }
      }
    }
  }

  if (dirty && !DRY) fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

console.log(`带引文的题 ${total}；指错段 ${wrongPara}；已改指 ${DRY ? 0 : fixed}；无法逐字定位（保留原样）${paraphrase}`);
if (leftovers.length) console.log(`保留原样：${leftovers.slice(0, 12).join(" ")}${leftovers.length > 12 ? " …" : ""}`);
