/**
 * 词形匹配的纯函数（服务端挖真题语料 / 前端高亮例句共用一份规则）。
 *
 * 为什么要自己做词形变体：卡片上是「frequently」，真题原句里可能是
 * 「frequent / frequented」，只按原形 LIKE 会漏掉大半真题命中。
 * 这里生成一组常见屈折变体，再用一个带可选词尾的正则去句子里认——
 * 两边（找句、高亮）必须用同一套规则，否则会出现「统计说有、例句没高亮」。
 */

/** 正则特殊字符转义 */
export function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 一个词的常见屈折/派生变体（含原形），用于语料检索。
 * 只处理规则变化（-s/-ed/-ing/-ly/-ies/-ied）；不规则变化（go→went）不覆盖。
 */
export function variantsOf(raw: string): string[] {
  const w = raw.toLowerCase().replace(/[’]/g, "'").trim();
  if (!w) return [];
  const set = new Set<string>([w]);
  const add = (s: string) => {
    if (s.length >= 2) set.add(s);
  };

  if (w.endsWith("ly") && w.length > 4) add(w.slice(0, -2));
  if (w.endsWith("ies") && w.length > 4) add(w.slice(0, -3) + "y");
  if (w.endsWith("ied") && w.length > 4) add(w.slice(0, -3) + "y");
  if (w.endsWith("ing") && w.length > 5) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + "e");
  }
  if (w.endsWith("ed") && w.length > 4) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  }
  if (w.endsWith("es") && w.length > 3) add(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) add(w.slice(0, -1));
  if (w.endsWith("e") && w.length > 3) add(w.slice(0, -1));

  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * 在句子里认词（高亮用）的正则：任一变体 + 可选常见词尾。
 * 变体按长度降序排列，保证「frequently」先于「frequent」被匹配。
 */
export function matchRegexOf(raw: string): RegExp | null {
  const variants = variantsOf(raw);
  if (variants.length === 0) return null;
  const alts = variants.map(escapeRegExp).join("|");
  return new RegExp(`\\b(?:${alts})(?:s|es|ed|d|ing|ly)?\\b`, "gi");
}
