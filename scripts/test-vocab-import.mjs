#!/usr/bin/env node
/**
 * 外部词表解析器的断言测试。
 *
 * 关键口径：宁可少解析，不要解析错。解析不出干净单词的行要进 rejected，
 * 不能让整句话当成单词入库，也不能把用户的好词悄悄丢掉。
 *
 * 用法：先编译再跑
 *   npx tsc src/lib/vocab-import.ts --target es2020 --module es2020 --moduleResolution node --outDir .build/imp --skipLibCheck
 *   node scripts/test-vocab-import.mjs
 */
import { MAX_WORDS, cleanWord, parseWordText } from "../.build/imp/vocab-import.js";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? `  ⟶  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const parseOne = (line) => {
  const result = parseWordText(line);
  return { entry: result.entries[0] ?? null, rest: result };
};

console.log("\n【单行解析】");

let r = parseOne("abandon");
check("纯单词", r.entry && r.entry.word === "abandon" && r.entry.definitions.length === 0, JSON.stringify(r.entry));

r = parseOne("abandon\t放弃");
check("Tab 分隔", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].zh === "放弃", JSON.stringify(r.entry));

r = parseOne("abandon, 放弃");
check("英文逗号分隔", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].zh === "放弃", JSON.stringify(r.entry));

r = parseOne("abandon，放弃");
check("中文逗号分隔", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].zh === "放弃", JSON.stringify(r.entry));

r = parseOne("abandon 放弃");
check("空格分隔（后半是中文）", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].zh === "放弃", JSON.stringify(r.entry));

r = parseOne("abandon n. 放弃；抛弃");
check("词性前缀被识别", r.entry && r.entry.definitions[0].pos === "n." && r.entry.definitions[1].zh === "抛弃", JSON.stringify(r.entry.definitions));

r = parseOne("abandon | vt. 放弃, 抛弃");
check("竖线分隔 + 词性", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].pos === "vt." , JSON.stringify(r.entry));

r = parseOne("1. abandon - 放弃");
check("序号与破折号", r.entry && r.entry.word === "abandon" && r.entry.definitions[0].zh === "放弃", JSON.stringify(r.entry));

r = parseOne("- ambiguous  adj. 模糊的");
check("项目符号 + 双空格", r.entry && r.entry.word === "ambiguous" && r.entry.definitions[0].pos === "adj.", JSON.stringify(r.entry));

r = parseOne("give up 放弃");
check("短语（两个词）保留", r.entry && r.entry.word === "give up", JSON.stringify(r.entry));

r = parseOne("take into account 把…考虑在内");
check("短语（三个词）保留", r.entry && r.entry.word === "take into account", JSON.stringify(r.entry));

r = parseOne("Abandon");
check("大写转小写", r.entry && r.entry.word === "abandon");

r = parseOne("abandon.");
check("尾部句号被清掉", r.entry && r.entry.word === "abandon", JSON.stringify(r.entry));

r = parseOne("well-known");
check("连字符保留", r.entry && r.entry.word === "well-known");

r = parseOne("don't");
check("撇号保留", r.entry && r.entry.word === "don't", JSON.stringify(r.entry));

check("cleanWord 去掉首尾噪音", cleanWord(" **Abandon**, ") === "abandon", cleanWord(" **Abandon**, "));

console.log("\n【整段解析】");

const sample = [
  "# 我的词表",
  "abandon\t放弃",
  "",
  "ambiguous  adj. 模糊的",
  "// 注释行",
  "abandon, 重复词",
  "12345 ###",
  "research",
].join("\n");
const block = parseWordText(sample);
check("注释与空行不计入", block.total === 5, String(block.total));
check("重复词只保留一次", block.entries.filter((e) => e.word === "abandon").length === 1);
check("重复词保留第一次的释义", block.entries.find((e) => e.word === "abandon").definitions[0].zh === "放弃");
check("非法行进入 rejected", block.rejected.length === 1 && block.rejected[0].includes("12345"), JSON.stringify(block.rejected));
check("合法词全部保留", block.entries.length === 3, block.entries.map((e) => e.word).join(","));

const csv = ["word,definition", "abandon,放弃", "sustain,维持"].join("\n");
const csvResult = parseWordText(csv);
check("CSV 表头被跳过", csvResult.entries.length === 2 && csvResult.entries[0].word === "abandon", csvResult.entries.map((e) => e.word).join(","));

const crlf = "abandon\t放弃\r\nsustain\t维持\r\n";
check("Windows 换行兼容", parseWordText(crlf).entries.length === 2);

const bom = "\uFEFFabandon\t放弃";
check("BOM 兼容", parseWordText(bom).entries[0].word === "abandon");

console.log("\n【边界】");

const many = Array.from({ length: MAX_WORDS + 100 }, (_, i) => {
  // 纯字母词：cleanWord 会剥掉数字，用 base26 生成不重复的合法词形
  let suffix = "";
  let rest = i;
  do {
    suffix = String.fromCharCode(97 + (rest % 26)) + suffix;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return `w${suffix}`;
}).join("\n");
const manyResult = parseWordText(many);
check(`超过 ${MAX_WORDS} 词被截断`, manyResult.entries.length === MAX_WORDS, String(manyResult.entries.length));
check("截断时给出提示", manyResult.rejected.some((line) => line.includes("上限")), JSON.stringify(manyResult.rejected.slice(-1)));

check("空文本返回空", parseWordText("").entries.length === 0);
check("纯空白返回空", parseWordText("   \n\n  \t ").entries.length === 0);
check("单字符词被拒（长度 < 2）", parseWordText("a\t一个").entries.length === 0);
check("超长词被拒（> 40）", parseWordText(`${"x".repeat(45)}\t测试`).entries.length === 0);
check("五个词的句子被拒", parseWordText("this is a very long sentence here").entries.length === 0, JSON.stringify(parseWordText("this is a very long sentence here")));

const deepDefs = parseWordText("sustain n. 一；二；三；四；五；六；七；八");
check("释义最多 6 条", deepDefs.entries[0].definitions.length === 6, String(deepDefs.entries[0].definitions.length));

const asWord = parseWordText("word 单词本身");
check("真要把 word 当单词导入时不被当表头吃掉", asWord.entries.length === 1 && asWord.entries[0].word === "word", JSON.stringify(asWord.entries));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
