import type { Definition } from "./types";

/**
 * 外部词表解析：把用户粘进来 / 传上来的任意文本，转成 [{ word, definitions }]。
 *
 * 支持的写法（全都实际测过，见 scripts/test-vocab-import.mjs）：
 *   abandon
 *   abandon\t放弃
 *   abandon, 放弃
 *   abandon 放弃
 *   abandon n. 放弃；抛弃
 *   give up 放弃
 *   1. abandon - 放弃          （带序号 / 项目符号）
 *   abandon | vt. 放弃, 抛弃   （竖线分隔）
 *
 * 设计原则：宁可少解析，不要解析错。解析不出干净单词的行直接进 rejected，
 * 让用户看到「哪几行我读不懂」，而不是悄悄丢词或把整句当单词入库。
 */

export type ParsedEntry = {
  word: string;
  definitions: Definition[];
};

export type ParseResult = {
  entries: ParsedEntry[];
  rejected: string[];
  /** 原文行数（不含空行与注释） */
  total: number;
};

/** 一次最多收多少词，防止有人粘一本书进来把接口打挂 */
export const MAX_WORDS = 800;

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const WORD_ONLY = /^[A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z][A-Za-z'’-]*){0,3}$/;
const POS_PREFIX = /^(n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|aux|abbr|det)\.\s*/i;

/** 清掉序号、项目符号、引号等噪音 */
function stripNoise(line: string): string {
  let text = line.replace(/^\uFEFF/, "").trim();
  // 1. / 12) / (3) / - / * / • / ·
  text = text.replace(/^(?:\(?\d{1,4}[).、]\s*|[-*•·—]\s+)/, "");
  return text.trim();
}

/** 单词清洗：只保留字母、连字符、撇号，去掉句末标点 */
export function cleanWord(raw: string): string {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^a-z]+/, "")
    .replace(/[^a-z'’-]+$/, "")
    .replace(/[’]/g, "'");
  return text.slice(0, 48);
}

function validWord(word: string): boolean {
  return WORD_ONLY.test(word) && word.length >= 2 && word.length <= 40;
}

/** 把一行释义拆成 { pos, zh } 数组，最多 6 条 */
function parseDefinitions(raw: string): Definition[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  const out: Definition[] = [];
  for (const part of parts) {
    const match = POS_PREFIX.exec(part);
    if (match) {
      const zh = part.slice(match[0].length).trim();
      if (zh) out.push({ pos: match[1].toLowerCase() + ".", zh });
    } else {
      out.push({ pos: "", zh: part });
    }
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * 词与释义之间的分隔符。
 * 注意不能把「；」「;」放进来——它们是**义项之间**的分隔符，
 * 一旦当成词/释义分隔，「abandon n. 放弃；抛弃」会被切成词="abandon n. 放弃"。
 */
const SEPARATORS = ["\t", ",", "，", "|", "：", ":", " - ", " — ", "–"];

/** 尾部的词性标记，切词时要从单词里剥出来还给释义 */
const TRAILING_POS = /\s+((?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|int|aux|abbr|det)\.)\s*$/i;

/**
 * 按**最早出现**的分隔符切成「词」和「释义」。
 *
 * 早先按数组顺序找第一个命中的分隔符，结果是「abandon | vt. 放弃, 抛弃」被
 * 出现在更后面的英文逗号切开，单词变成 "abandon | vt. 放弃"，整行被拒。
 * 分隔符之间没有优先级，只有位置先后，所以这里取最靠前的那个。
 */
function splitLine(line: string): { word: string; rest: string } {
  let bestAt = -1;
  let bestSep = "";
  for (const sep of SEPARATORS) {
    const at = line.indexOf(sep);
    if (at > 0 && (bestAt < 0 || at < bestAt)) {
      bestAt = at;
      bestSep = sep;
    }
  }
  if (bestAt > 0) {
    return { word: line.slice(0, bestAt), rest: line.slice(bestAt + bestSep.length) };
  }

  // 没有显式分隔符：找第一个汉字，前面是单词，后面是释义
  const cjk = line.search(CJK);
  if (cjk > 0) {
    const before = line.slice(0, cjk);
    const after = line.slice(cjk);
    const posMatch = TRAILING_POS.exec(before);
    if (posMatch) {
      return {
        word: before.slice(0, before.length - posMatch[0].length),
        rest: `${posMatch[1]} ${after}`,
      };
    }
    return { word: before, rest: after };
  }
  return { word: line, rest: "" };
}

export function parseWordText(input: string): ParseResult {
  const entries: ParsedEntry[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  let total = 0;

  const lines = input.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    total += 1;
    if (entries.length >= MAX_WORDS) {
      rejected.push(`（超过 ${MAX_WORDS} 词上限，其余已忽略）`);
      break;
    }

    const cleaned = stripNoise(line);
    if (!cleaned) continue;

    const split = splitLine(cleaned);
    const rawHead = split.word.trim().toLowerCase();
    const word = cleanWord(split.word);

    // CSV 表头：只认「word,definition / 单词,释义」这种明确的表头行。
    // 不能只判断词头等于 word，否则用户真要导入 word 这个词时会被当成表头吃掉。
    if (
      (rawHead === "word" || rawHead === "单词") &&
      /^(definition|translation|meaning|释义|中文|词性)/i.test(split.rest.trim())
    ) {
      continue;
    }

    if (!validWord(word)) {
      if (rejected.length < 10) rejected.push(line);
      continue;
    }
    if (seen.has(word)) continue;
    seen.add(word);

    entries.push({ word, definitions: parseDefinitions(split.rest) });
  }

  return { entries, rejected, total };
}
