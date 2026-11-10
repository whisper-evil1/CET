#!/usr/bin/env node
/**
 * 把 data/papers/*.json 里的选词填空统一改成官方形态的 A–O 十五词词库（落盘）。
 *
 * 规则全在 scripts/lib/wordbank.mjs：正文允许按「每空四选一」写，
 * 这里只负责把改造结果写回文件；导入器也会在内存里做同样的改造，
 * 两处走同一个函数，不会出现「文件是四选一、库是词库」的不一致。
 *
 * 用法：
 *   node scripts/normalize-wordbank.mjs         # 全部卷落盘
 *   node scripts/normalize-wordbank.mjs --dry   # 只看会改什么
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeBankedCloze } from "./lib/wordbank.mjs";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "papers");
const DRY = process.argv.includes("--dry");

let touched = 0;
const skipped = [];

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const full = path.join(DIR, file);
  const json = JSON.parse(fs.readFileSync(full, "utf8"));
  const reading = (json.sections ?? []).find((s) => s.type === "reading");
  const banked = reading?.passages?.[0];
  if (!banked) {
    skipped.push([file, "缺阅读篇目"]);
    continue;
  }
  const result = normalizeBankedCloze(banked);
  if (!result.ok) {
    skipped.push([file, result.reason]);
    continue;
  }
  if (!result.changed) {
    skipped.push([file, result.reason]);
    continue;
  }
  touched += 1;
  console.log(`${file}: 词库 ${result.bank.length} 词`);
  if (!DRY) fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

console.log(`\n改造 ${touched} 套${DRY ? "（试运行，未落盘）" : ""}；跳过 ${skipped.length} 套`);
for (const [file, why] of skipped) console.log(`  ${file}: ${why}`);
