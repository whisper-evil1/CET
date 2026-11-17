/**
 * 单词串联故事（数据层，前后端共用纯函数）。
 *
 * 目标形态（对照用户给的参考图）：
 *   英文小故事里按顺序嵌入生词本里的词，每个目标词第一次出现时写成
 *   **prestigious**（有声望的） —— 词加粗、紧跟全角括号的中文释义，
 *   看完故事就能联想词义，也方便直接听（释义单独成一段中文语音）。
 *
 * 规范化的故事字符串（canonical）格式：
 *   - 目标词出现处：`**word**（中文释义）`
 *   - 其余部分：纯英文文本
 * parseStory 把它切成 token，渲染、拼 TTS 都从 token 派生，口径一致。
 */

export type StoryWord = { word: string; zh: string };

export type StoryToken =
  | { type: "text"; text: string }
  | { type: "word"; word: string; zh: string };

/** TTS 合成片段：英文走英文语音，中文走中文语音 */
export type StoryRun = { text: string; lang: "en" | "zh" };

/**
 * 释义截短：词库释义经常是「铅, 铅条, 领导, 超前量, 领引, 榜样…」这种长串，
 * 直接塞进英文句子会读断、也记不住。只取前两个义项、控制在十余字，
 * 和参考图一样给一眼能想起词义的最短提示（全文释义在词表里还在）。
 */
export function shortGloss(zh: string, max = 10): string {
  const clean = zh
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\b(?:a|ad|adj|adv|n|v|vt|vi|prep|conj|pron|num|art|int|interj|aux|abbr)\.\s*/gi, "")
    .trim();
  if (!clean) return "";
  const parts = clean
    .split(/[,，;；/、]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const picked: string[] = [];
  for (const part of parts) {
    const next = [...picked, part].join("、");
    if (picked.length >= 2) break;
    if (picked.length > 0 && next.length > max) break;
    picked.push(part);
    if (next.length >= max) break;
  }
  const out = picked.length > 0 ? picked.join("、") : clean;
  return out.length > max + 4 ? `${out.slice(0, max)}…` : out;
}

const MARKED_RE = /\*\*([^*]+)\*\*（([^）]*)）/g;

/** 把规范化故事切成 token（纯文本 / 目标词） */
export function parseStory(story: string): StoryToken[] {
  const tokens: StoryToken[] = [];
  let last = 0;
  MARKED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKED_RE.exec(story)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "text", text: story.slice(last, match.index) });
    }
    tokens.push({ type: "word", word: match[1], zh: match[2] });
    last = match.index + match[0].length;
  }
  if (last < story.length) tokens.push({ type: "text", text: story.slice(last) });
  return tokens;
}

/** 拼 TTS 片段：withGloss=true 时词后跟中文释义（分开成中文片段），false 只读纯英文故事 */
export function storyToRuns(story: string, withGloss: boolean): StoryRun[] {
  const runs: StoryRun[] = [];
  for (const token of parseStory(story)) {
    if (token.type === "text") {
      const text = token.text;
      if (text.trim()) runs.push({ text, lang: "en" });
    } else {
      runs.push({ text: token.word, lang: "en" });
      if (withGloss && token.zh.trim()) runs.push({ text: token.zh, lang: "zh" });
    }
  }
  // 合并相邻同语言片段，减少合成次数
  const merged: StoryRun[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.lang === run.lang) {
      prev.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged.filter((run) => run.text.trim().length > 0);
}

/** 纯文本形态（校验 / 展示兜底用） */
export function storyToPlainText(story: string, withGloss: boolean): string {
  return storyToRuns(story, withGloss)
    .map((run) => run.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- AI 提示词 ---------------- */

export function buildStoryPrompt(words: StoryWord[]): string {
  const list = words.map((item, i) => `${i + 1}. ${item.word}`).join(" ");
  return [
    "把下面这些英语单词按给定顺序编成一段通顺的英文小故事，帮助中国大学生（四六级水平）背单词。",
    "规则：",
    "1. 每个单词都必须用上，严格按给出的顺序出现，每个词只用一次；",
    "2. 每个目标单词出现时用两个英文星号包起来，例如：**prestigious**；",
    "3. 除星号标记外只输出英文故事正文——不要中文、不要解释、不要标题、不要编号、不要代码块；",
    "4. 故事要通顺自然，读完能让人联想到每个词的大意；总长度控制在 200 个英文单词以内。",
    `单词：${list}`,
  ].join("\n");
}

/* ---------------- 模型输出校验 ---------------- */

/**
 * 校验模型输出：**标记**的词必须恰好等于给定词序列（顺序一致）。
 * 容忍大小写与简单词形变化（模型把 believe 写成 believed 也算过）。
 */
export function validateMarked(marked: string, words: StoryWord[]): boolean {
  MARKED_RE.lastIndex = 0;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = MARKED_RE.exec(marked)) !== null) found.push(match[1].trim());
  // 模型可能只打星号不带释义，用另一个正则兜底取 **...**
  if (found.length === 0) {
    const loose = /\*\*([^*]+)\*\*/g;
    let m: RegExpExecArray | null;
    while ((m = loose.exec(marked)) !== null) found.push(m[1].trim());
  }
  if (found.length !== words.length) return false;
  return found.every((token, i) => {
    const got = token.toLowerCase();
    const want = words[i].word.trim().toLowerCase();
    return got === want || got.startsWith(want);
  });
}

/** 把 `**word**`（或 `**word**（模型自加的释义）`）替换为 `**word**（我们词库里的释义）` */
export function injectGlosses(marked: string, words: StoryWord[]): string {
  let i = 0;
  const out = marked.replace(/\*\*([^*]+)\*\*(?:（[^）]*）)?/g, (_all, raw: string) => {
    const item = words[Math.min(i, words.length - 1)];
    i += 1;
    return `**${raw.trim()}**（${item.zh}）`;
  });
  // 顺手去掉模型偶尔带的代码块围栏和多余空行
  return out
    .replace(/```[a-z]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------------- 离线兜底串联 ---------------- */

/**
 * 兜底句架：每一句都用「the word X」来引用单词，
 * 不管这个词是名词、动词还是 however 这种副词，句子都读得通顺，
 * 不会出现 "Our story begins with however" 这种一眼假的病句。
 */
const OFFLINE_FRAMES: Array<(word: string) => string> = [
  (w) => `Our story begins with the word ${w}.`,
  (w) => `Before long, another word, ${w}, changed the mood at once.`,
  (w) => `Then everyone had to deal with the word ${w}, whether ready or not.`,
  (w) => `What saved the day, surprisingly, was the word ${w}.`,
  (w) => `Along the way the word ${w} came up more than once.`,
  (w) => `By the end, the word ${w} was the part nobody could forget.`,
  (w) => `Looking back, it all started from the word ${w}.`,
  (w) => `And so the word ${w} found its place in the tale.`,
];

/**
 * 离线兜底：AI 不可用时用固定句架把词串成故事骨架。
 * 语言朴素但格式与 AI 版完全一致（词按序出现、带释义标记），
 * 界面会如实标注「离线串联」，不当成 AI 成果。
 */
export function offlineStory(words: StoryWord[]): string {
  const sentences = words.map((item, i) => {
    const frame = OFFLINE_FRAMES[i % OFFLINE_FRAMES.length];
    return frame(`**${item.word}**（${item.zh}）`);
  });
  return sentences.join(" ");
}
