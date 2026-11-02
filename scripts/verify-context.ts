/**
 * 语境截取函数的回归验证：偏移精确性 + 长句裁剪。
 * 用法：npx tsx scripts/verify-context.ts
 */
import { sentenceAround, tokenizeParagraph } from "../src/lib/text-segments";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// 1) 同一个词出现多次，按点击偏移取对的那一处
const text = "The market fell. Then the market rallied hard. Finally the market closed flat.";
const hits = tokenizeParagraph(text).filter(
  (t) => t.kind === "word" && t.text.toLowerCase() === "market",
);
check("分词能定位 market 的 3 处偏移", hits.length === 3, `实际 ${hits.length}`);

const first = sentenceAround(text, "market", hits[0].start);
const third = sentenceAround(text, "market", hits[2].start);
check("第 1 处语境是开头的句子", first.includes("The market fell"), first);
check("第 3 处语境是结尾的句子", third.includes("closed flat"), third);
check("同词不同点击位置取到不同语境", first !== third);

// 2) 缺少偏移时退回第一次出现（向后兼容）
const noOffset = sentenceAround(text, "market");
check("不带偏移时仍能取到语境", noOffset.includes("The market fell"), noOffset);

// 3) 超长句裁剪：保留目标词、长度受控
const long =
  "Consumers who understand what a twenty-minute promise costs in risk and in waste can ask for something better, ".repeat(
    6,
  ) + "and the answer will not come from a slogan but from a schedule.";
const clipped = sentenceAround(long, "schedule", long.indexOf("schedule"));
check("长句被裁剪", clipped.length < long.length, `原 ${long.length} → 裁 ${clipped.length}`);
check("裁剪后仍在 242 以内", clipped.length <= 242, `${clipped.length}`);
check("裁剪后保留目标词", clipped.toLowerCase().includes("schedule"));
check("裁剪处有省略号", clipped.startsWith("…") || clipped.endsWith("…"));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
