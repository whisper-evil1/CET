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

/** 从段落文本里截取包含该单词的句子，作为生词的语境 */
export function sentenceAround(text: string, word: string): string {
  const lower = text.toLowerCase();
  const target = word.toLowerCase();
  const at = lower.indexOf(target);
  if (at === -1) return text.slice(0, 160);

  let start = at;
  while (start > 0 && !/[.!?]/.test(text[start - 1] ?? "")) start -= 1;
  let end = at + target.length;
  while (end < text.length && !/[.!?]/.test(text[end] ?? "")) end += 1;

  return text.slice(start, Math.min(end + 1, text.length)).trim();
}
