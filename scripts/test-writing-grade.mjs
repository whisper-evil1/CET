#!/usr/bin/env node
/**
 * 写作 / 翻译批改算法的断言测试（纯函数，不打服务）。
 *
 * 目的：证明「没配 AI Key 时给出的批改是依据学生真实作答算出来的」，
 * 而不是之前那种通用示例。逐条验证：
 *   1. 有 15 分制分数与档位说明
 *   2. 引用学生自己的句子（而不是空泛套话）
 *   3. 中文标点、数字漏译、模板套话、缺连接词能被具体检出
 *   4. 翻译题不会再出现阅读技巧（这是原缺陷的核心）
 *   5. 写作题按 CET4/CET6 用不同字数线
 *   6. 输出是合法 Markdown，且不含「演示模式 / AI_API_KEY / .env」
 *
 * 用法：node scripts/test-writing-grade.mjs
 */
import { buildLocalReview, buildGradePrompt } from "../.build/wg/writing-grade.js";

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? `  ⟶  ${detail}` : ""}`);
};

/* ---------- 样本 1：翻译，故意埋可检出的错误 ---------- */
const translation = {
  type: "translation",
  stem: `请将下面一段话译成英文。\n\n中国的茶文化有 2000 多年的历史。唐代（Tang Dynasty）时，茶已经成为日常饮品。如今，中国茶叶出口到 120 多个国家。`,
  reference:
    "Chinese tea culture has a history of more than 2,000 years. As early as the Tang Dynasty, tea had become a daily drink. Today, Chinese tea is exported to more than 120 countries.",
  // 埋点：中文标点、数字 2000/120 漏译、Tang Dynasty 未用、句子碎、缺连接词
  answer:
    "Chinese tea culture is very old， it has a long history. Tea is popular. People drink tea every day. Tea is good.",
  level: "CET4",
};

const t = buildLocalReview(translation);
console.log("=== 翻译样本输出（前 900 字）===");
console.log(t.slice(0, 900));
console.log("=== 输出结束 ===\n");

check("含 15 分制分数", /##\s*批改结果：[\d.]+\s*\/\s*15/.test(t), t.match(/##\s*批改结果：[^\n]+/)?.[0]);
check("含总评", t.includes("**总评**"));
check("检出中文标点", t.includes("混入了中文标点"));
check("检出数字漏译", t.includes("数字没译到") && t.includes("2000") && t.includes("120"));
check("检出给定术语未使用", t.includes("给定术语没用上") && t.includes("Tang Dynasty"));
check("检出句子太碎", t.includes("句子太碎"));
check("检出缺连接词", t.includes("缺连接词"));
check("引用了学生原句（引号内是作答内容）", /「[^」]*history[^」]*」|「[^」]*Tea[^」]*」/.test(t));
check("翻译题不含阅读技巧", !t.includes("回原文") && !t.includes("选项") && !t.includes("排除"));
check("不含演示模式字样", !/演示模式|AI_API_KEY|\.env/.test(t));

/* ---------- 样本 2：写作，质量较好 ---------- */
const writing = {
  type: "writing",
  stem: "Write an essay on the importance of reading. You should write at least 120 words.",
  reference: null,
  answer: `Reading is important. However, many students read only for exams.
Moreover, they seldom read for pleasure.

In my opinion, reading broadens our horizons and improves our thinking. Therefore, schools should encourage students to read more.
For example, a library corner in every classroom can make a difference. Although it takes time, the benefit is lasting.`,
  level: "CET4",
};

const w = buildLocalReview(writing);
console.log("=== 写作样本输出（前 700 字）===");
console.log(w.slice(0, 700));
console.log("=== 输出结束 ===\n");

check("写作：有分数", /##\s*批改结果：[\d.]+\s*\/\s*15/.test(w), w.match(/##\s*批改结果：[^\n]+/)?.[0]);
check(
  "写作：55 词（要求 120）分数被压到 9 分以下，不虚高",
  Number(w.match(/##\s*批改结果：([\d.]+)/)?.[1] ?? 99) <= 9,
  w.match(/##\s*批改结果：[^\n]+/)?.[0],
);
check("写作：字数偏少被检出", w.includes("字数偏少") || w.includes("字数严重不足"));
check("写作：识别出分段", w.includes("分段清楚"));
check("写作：识别出连接词", w.includes("有衔接意识") && w.includes("however"));
check("写作：没有翻译专属项", !w.includes("参考译文的实词") && !w.includes("数字没译到"));

/* ---------- 样本 2b：两类误报回归 ---------- */
// 误报一：题干里的英文指令带「30 minutes」，不能算作原文信息
const dirStem = `For this part, you are allowed 30 minutes to translate the following passage into English.

中国的茶文化有 2000 多年的历史。如今，中国茶叶出口到 120 多个国家。`;
const dirAnswer =
  "Chinese tea culture has a history of more than 2000 years. Today, Chinese tea is exported to more than 120 countries.";
const dirReview = buildLocalReview({
  type: "translation",
  stem: dirStem,
  reference: null,
  answer: dirAnswer,
  level: "CET4",
});
check(
  "不把题干英文指令里的 30 分钟当成漏译数字（数字已译全时不该报）",
  !dirReview.includes("数字没译到"),
  dirReview.includes("数字没译到") ? dirReview.match(/数字没译到[^\n]*/)?.[0] ?? "" : "未误报",
);

// 误报二：数字写成英文单词也算译到
const wordNum = buildLocalReview({
  type: "translation",
  stem: "中国的茶文化有 2000 多年的历史。",
  reference: null,
  answer: "Chinese tea culture has a history of more than two thousand years.",
  level: "CET4",
});
check(
  "把 2000 写成 two thousand 不判漏译",
  !wordNum.includes("数字没译到"),
  wordNum.includes("数字没译到") ? wordNum.match(/数字没译到[^\n]*/)?.[0] ?? "" : "未误报",
);

/* ---------- 样本 3：空内容不崩 ---------- */
let noCrash = true;
try {
  buildLocalReview({ type: "writing", stem: "x", reference: null, answer: "   ", level: null });
} catch {
  noCrash = false;
}
check("空作答不抛异常", noCrash);

/* ---------- 样本 4：CET6 与 CET4 字数线不同 ---------- */
const six = buildLocalReview({
  type: "writing",
  stem: "s",
  reference: null,
  answer: Array.from({ length: 125 }, (_, i) => `word${i}`).join(" ") + ".",
  level: "CET6",
});
const four = buildLocalReview({
  type: "writing",
  stem: "s",
  reference: null,
  answer: Array.from({ length: 125 }, (_, i) => `word${i}`).join(" ") + ".",
  level: "CET4",
});
check("CET6 按 150 词判不足", six.includes("150"), six.match(/字数[^\n]*/)?.[0]?.slice(0, 60));
check("CET4 按 120 词判达标", four.includes("120"), four.match(/字数[^\n]*/)?.[0]?.slice(0, 60));

/* ---------- 样本 5：提示词是阅卷口径，不是阅读口径 ---------- */
const pT = buildGradePrompt(translation);
const pW = buildGradePrompt(writing);
check("翻译提示词要求 15 分制", pT.includes("15 分制"));
check("翻译提示词要求逐句对照", pT.includes("逐句对照"));
check("翻译提示词不含阅读技巧", !pT.includes("回原文"));
check("写作提示词含四维度", pW.includes("内容切题") && pW.includes("句式多样"));
check("写作提示词点名模板套话", pW.includes("every coin has two sides"));

/* ---------- Markdown 结构自检 ---------- */
const unclosed = (t.match(/\*\*/g) ?? []).length % 2 !== 0;
check("Markdown 星号成对（不会出现畸形加粗）", !unclosed);

const failed = results.filter((r) => !r.ok);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：\n" + failed.map((f) => "  - " + f.name).join("\n"));
  process.exit(1);
}
