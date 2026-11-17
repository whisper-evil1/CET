/**
 * 语法底线扫描：用 acorn 逐个 chunk 试解析，找出每个文件最低需要哪个 ecmaVersion。
 * ecmaVersion ↔ 浏览器版本对照（语法层面）：
 *   2015 → Chrome 49 / Safari 10 / Firefox 45
 *   2016 → Chrome 52 / Safari 10
 *   2017 → Chrome 58 / Safari 11
 *   2018 → Chrome 62 / Safari 11.1
 *   2019 → Chrome 66 / Safari 12
 *   2020 → Chrome 80 / Safari 13.1  （?. 和 ??）
 *   2021 → Chrome 85 / Safari 14    （??= ||= &&=）
 *   2022 → Chrome 94 / Safari 16.4  （class static block、#private）
 * 用法：node scripts/syntax-floor.mjs [目录]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("next/dist/compiled/acorn");

const dir = process.argv[2] || ".next/static/chunks";
const versions = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) files.push(p);
  }
};
walk(dir);

const minVersion = (code) => {
  for (const v of versions) {
    try {
      acorn.parse(code, { ecmaVersion: v, sourceType: "script", allowHashBang: true });
      return v;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      // 换 module 再试一次（部分 chunk 用 import.meta）
      try {
        acorn.parse(code, { ecmaVersion: v, sourceType: "module", allowHashBang: true });
        return v;
      } catch (e2) {
        if (!(e2 instanceof SyntaxError)) throw e2;
      }
    }
  }
  return null;
};

const rows = [];
for (const f of files) {
  const code = readFileSync(f, "utf8");
  const v = minVersion(code);
  rows.push({ file: f.replace(/\\/g, "/").split("/").pop(), v, kb: Math.round(code.length / 1024) });
}
rows.sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
for (const r of rows) console.log(`${String(r.v ?? "?").padEnd(5)} ${String(r.kb + "KB").padEnd(7)} ${r.file}`);
const worst = Math.max(...rows.map((r) => r.v ?? 0));
const label = { 2019: "Chrome 66 / Safari 12", 2020: "Chrome 80 / Safari 13.1", 2021: "Chrome 85 / Safari 14", 2022: "Chrome 94 / Safari 16.4" };
console.log(`\n最严的一档：ES${worst} → ${label[worst] ?? "更新"}`);
