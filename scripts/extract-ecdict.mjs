/**
 * 从 ecdict CSV 提取 cet4/cet6/zk/gk 标签的词，生成精简离线词库 JSON。
 * 输出：data/offline-dict.json —— 只保留 word/phonetic/definitions，体积小、加载快。
 */
import fs from "node:fs";
import { createInterface } from "node:readline";

const CSV = "node_modules/ecdict/assets/ecdict.csv";
const OUT = "data/offline-dict.json";

/** 把 ecdict 的 translation 字段解析成 {pos, zh} 数组 */
function parseTranslation(translation) {
  if (!translation) return [];
  // translation 格式如："n. 罩；风帽\nv. 覆盖\n[网络] 胡德"
  const lines = translation.split(/\\n|\n/).map((l) => l.trim()).filter(Boolean);
  const defs = [];
  for (const line of lines) {
    // 跳过 [网络] 行
    if (line.startsWith("[网络]") || line.startsWith("[例句]") || line.startsWith("[词组]")) continue;
    // 匹配 "n. xxx" / "v. xxx" / "adj. xxx" / "suf. xxx" 等
    const match = line.match(/^((?:n|v|adj|adv|prep|pron|conj|art|num|abbr|suf|pref|vt|vi|aux|int|det)\.)\s*(.*)/);
    if (match) {
      const pos = match[1];
      const zh = match[2].trim();
      if (zh) defs.push({ pos, zh });
    } else if (defs.length > 0) {
      // 续行：追加到上一条
      defs[defs.length - 1].zh += "；" + line;
    } else {
      // 没有词性前缀的行，归为 "" 词性
      defs.push({ pos: "", zh: line });
    }
  }
  return defs.slice(0, 6); // 最多 6 条义项
}

const rl = createInterface({
  input: fs.createReadStream(CSV, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

const dict = {};
let header = null;
let count = 0;
const WANTED_TAGS = new Set(["cet4", "cet6", "zk", "gk", "ky", "toefl", "ielts", "gre"]);

rl.on("line", (line) => {
  if (!header) {
    header = line.split(",");
    return;
  }
  // 简单 CSV 解析（ecdict 的字段里不含逗号在引号内的情况较多，用正则处理）
  // 实际上 ecdict CSV 不带引号包裹，但 translation 里有逗号，需要小心
  // 更稳的做法：按列数切分
  const cols = parseCsvLine(line, header.length);
  if (cols.length < header.length) return;

  const row = {};
  for (let i = 0; i < header.length; i++) {
    row[header[i]] = cols[i] ?? "";
  }

  const tag = row.tag ?? "";
  const tags = tag.split(/\s+/);
  const hasWanted = tags.some((t) => WANTED_TAGS.has(t));
  if (!hasWanted) return;

  const word = (row.word ?? "").trim().toLowerCase();
  if (!word || !/^[a-z][a-z'-]*$/.test(word)) return;

  const phonetic = (row.phonetic ?? "").trim() || null;
  const definitions = parseTranslation(row.translation);
  if (definitions.length === 0) return;

  dict[word] = { phonetic, definitions, tags: tags.filter((t) => WANTED_TAGS.has(t)) };
  count++;
});

function parseCsvLine(line, expectedCols) {
  // ecdict CSV 不用引号包裹，逗号就是分隔符
  // 但 translation 字段里可能有逗号（中文释义里的）
  // 实际上 ecdict 的 CSV 是标准格式，字段间用逗号分隔，含逗号的字段会用双引号包裹
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

rl.on("close", () => {
  const json = JSON.stringify(dict);
  fs.writeFileSync(OUT, json, "utf8");
  const sizeMB = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`提取完成：${count} 个词，文件 ${sizeMB} MB → ${OUT}`);
  // 打印几个样本
  const samples = ["research", "researcher", "notebook", "obvious", "widely", "transcript"];
  for (const w of samples) {
    if (dict[w]) console.log(`  ${w}: ${JSON.stringify(dict[w]).slice(0, 120)}`);
  }
});
