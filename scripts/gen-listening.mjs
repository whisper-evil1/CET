#!/usr/bin/env node
/**
 * 听力正文生成器：把 scripts/listening-bank.mjs 的材料按官方结构拼进 data/papers/*.json。
 *
 * 为什么单独一步而不是直接写库：
 *   `data/papers/*.json` 是正文的唯一事实来源，import-papers.mjs 从它建库。
 *   如果只写库，下次部署重跑导入就会把听力清掉。
 *
 * 结构（CET4/CET6 听力均为 1–25）：
 *   Section A 短篇新闻 3 段（3+2+2 = 7 题，1–7）
 *   Section B 长对话   2 段（4+4 = 8 题，8–15）
 *   Section C 听力篇章 3 段（4+3+3 = 10 题，16–25）
 *
 * 注意：这是**仿真稿**生成器，只在真题原文抓不到时才用；真题走 lazynote-listening.mjs。
 * 幂等：已经带听力的卷直接跳过；--force 才重写。
 * 用法：
 *   node scripts/gen-listening.mjs            # 只补缺听力的卷
 *   node scripts/gen-listening.mjs --dry      # 只报告，不写文件
 */
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./papers-catalog.mjs";
import { NEWS, CONVERSATIONS, PASSAGES, BLUEPRINT } from "./listening-bank.mjs";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "papers");
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

/** 语音合成按每分钟约 150 词的正常语速估算，给进度条与"这段大约多长"一个参考值 */
const WORD_PER_SEC = 2.5;

const byQ = (list, n) => list.filter((x) => x.questions.length === n);

/** 段落里的一句话 → transcript 行（带起止秒数，前端逐句高亮用） */
function toTranscript(lines) {
  let cursor = 0;
  return lines.map((text, index) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    const dur = Math.max(1.6, words / WORD_PER_SEC);
    const row = {
      id: index + 1,
      start: Number(cursor.toFixed(2)),
      end: Number((cursor + dur).toFixed(2)),
      text,
    };
    cursor += dur;
    return row;
  });
}

/**
 * 按卷序号轮换取材料，保证相邻两套听到的不是同一批；
 * 新闻按 3+2+2 取（需要两段 2 题的），篇章按 4+3+3 取（需要两段 3 题的）。
 */
function pickMaterial(index) {
  const news3 = byQ(NEWS, 3);
  const news2 = byQ(NEWS, 2);
  const pass4 = byQ(PASSAGES, 4);
  const pass3 = byQ(PASSAGES, 3);
  if (!news3.length || news2.length < 2 || !pass4.length || pass3.length < 2) {
    throw new Error("听力题库不足：新闻需 3 题×1、2 题×2；篇章需 4 题×1、3 题×2");
  }
  const news = [
    news3[index % news3.length],
    news2[(index + 1) % news2.length],
    news2[(index + 2) % news2.length],
  ];
  const conversations = [
    CONVERSATIONS[index % CONVERSATIONS.length],
    CONVERSATIONS[(index + 1) % CONVERSATIONS.length],
  ];
  const passages = [
    pass4[index % pass4.length],
    pass3[index % pass3.length],
    pass3[(index + 1) % pass3.length],
  ];
  return { news, conversations, passages };
}

const catalog = buildCatalog();
fs.mkdirSync(DIR, { recursive: true });

let filled = 0;
let skipped = 0;
const missing = [];

for (const [index, entry] of catalog.entries()) {
  const file = path.join(DIR, `${entry.id}.json`);
  if (!fs.existsSync(file)) {
    missing.push(entry.id);
    continue;
  }
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const sections = Array.isArray(json.sections) ? json.sections : [];
  const listening = sections.find((s) => s.type === "listening");
  const already = (listening?.passages ?? []).reduce((a, p) => a + (p.questions?.length ?? 0), 0);

  if (already === 25 && !FORCE) {
    skipped += 1;
    continue;
  }

  const { news, conversations, passages } = pickMaterial(index);
  let number = 1;
  const buildPassage = (item, count, kind) => {
    /*
     * 这里只铺「仿真稿」。真题原文走 scripts/lazynote-listening.mjs：
     * 扩写仿真稿曾被判定为冒充真题，已经删掉，不要再往这里加扩写。
     */
    const lines = item.lines;
    const transcript = toTranscript(lines);
    const questions = item.questions.slice(0, count).map((q) => ({
      number: number++,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      analysis: q.analysis,
      type: kind === "news" ? "新闻细节" : kind === "conversation" ? "对话理解" : "篇章理解",
    }));
    return {
      title: item.title,
      kind,
      transcript,
      audioDuration: Math.round(transcript[transcript.length - 1]?.end ?? 0),
      questions,
    };
  };

  const passagesOut = [
    ...news.map((item, i) => buildPassage(item, BLUEPRINT.news.pattern[i], "news")),
    ...conversations.map((item) => buildPassage(item, BLUEPRINT.conversations.perItem, "conversation")),
    ...passages.map((item, i) => buildPassage(item, BLUEPRINT.passages.pattern[i], "passage")),
  ];

  const total = passagesOut.reduce((a, p) => a + p.questions.length, 0);
  if (total !== 25) throw new Error(`${entry.id} 生成 ${total} 题，应为 25`);

  const sectionOut = {
    type: "listening",
    title: "Section II Listening Comprehension",
    note: "仿真听力材料：音频由页面实时朗读（语音合成），不是官方录音。",
    passages: passagesOut,
  };

  if (listening) Object.assign(listening, sectionOut);
  else {
    // 插在写作之后，保持官方顺序
    const at = sections.findIndex((s) => s.type === "reading");
    sections.splice(at >= 0 ? at : sections.length, 0, sectionOut);
  }
  json.sections = sections;

  if (!DRY) fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  filled += 1;
}

console.log(
  `${DRY ? "[dry] " : ""}补听力 ${filled} 套 / 已有跳过 ${skipped} 套；缺正文文件 ${missing.length} 套` +
    (missing.length ? `（${missing.slice(0, 4).join(", ")}…）` : ""),
);
