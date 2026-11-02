/**
 * 文章分词：把段落切成「可点击单词」与「其他字符」两类 token。
 *
 * 性能要点：
 *   - 纯函数、无副作用，调用方用 useMemo 按段落文本缓存，滚动与切题都不会重算
 *   - 渲染时不做正则匹配，一次性拿到 token 数组直接 map
 *   - 点击事件用容器级委托（closest('[data-word]')），不给每个单词挂监听
 */

export type Token = {
  kind: "word" | "gap";
  text: string;
  /** 段落内唯一 key */
  key: string;
  /** 该 token 在段落文本中的起始字符偏移，用于精确取「用户点的那一处」的语境 */
  start: number;
};

const WORD_PATTERN = /([A-Za-z][A-Za-z'’-]*)|([^A-Za-z]+)/g;

export function tokenizeParagraph(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let match: RegExpExecArray | null;

  WORD_PATTERN.lastIndex = 0;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const value = match[0];
    tokens.push({
      kind: match[1] ? "word" : "gap",
      text: value,
      key: `t${index++}`,
      start: match.index,
    });
  }

  return tokens;
}

/** 把单词归一化成小写、去掉首尾标点，用于匹配生词本 */
export function normalizeForVocab(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z'-]+$/g, "")
    .replace(/['’]s$/, "");
}

/** 语境句最长保留字符数。超长句只留点击词附近的一段，避免撑爆弹窗和请求体 */
const MAX_CONTEXT = 240;

/** 以点击位置为中心裁剪长句，保证被点的词一定在结果里 */
function clipAroundWord(sentence: string, wordAt: number, wordLength: number): string {
  if (sentence.length <= MAX_CONTEXT) return sentence;
  const half = Math.floor((MAX_CONTEXT - wordLength) / 2);
  let from = Math.max(0, wordAt - half);
  const to = Math.min(sentence.length, from + MAX_CONTEXT);
  from = Math.max(0, to - MAX_CONTEXT);
  const head = from > 0 ? "…" : "";
  const tail = to < sentence.length ? "…" : "";
  return `${head}${sentence.slice(from, to).trim()}${tail}`;
}

/**
 * 从段落文本里截取包含该单词的句子，作为生词的语境。
 *
 * charOffset 是用户实际点中的那个词在段落里的偏移：同一个词在段落中出现多次时，
 * 用它才能拿到「点的这一处」而不是第一次出现的位置。
 */
export function sentenceAround(text: string, word: string, charOffset?: number): string {
  const lower = text.toLowerCase();
  const target = word.toLowerCase();

  let at = typeof charOffset === "number" && charOffset >= 0 ? charOffset : -1;
  // 偏移失效（分词与原文不一致）时退回全段搜索
  if (at < 0 || lower.slice(at, at + target.length) !== target) {
    at = lower.indexOf(target);
  }
  if (at === -1) return text.slice(0, MAX_CONTEXT);

  let start = at;
  while (start > 0 && !/[.!?]/.test(text[start - 1] ?? "")) start -= 1;
  let end = at + target.length;
  while (end < text.length && !/[.!?]/.test(text[end] ?? "")) end += 1;

  const sentence = text.slice(start, Math.min(end + 1, text.length)).trim();
  return clipAroundWord(sentence, at - start, target.length);
}
