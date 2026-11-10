import fs from "node:fs";
import path from "node:path";
import { lookupOffline } from "./offline-dict";
import type { Definition } from "./types";

/**
 * 四六级高频词书加载层。
 *
 * 数据来源：data/wordbooks.json，由 scripts/build-wordbooks.mjs 从 ECDICT 生成。
 * 每本书只存 [word, rank, collins, oxford]，释义统一从 data/offline-dict.json 取，
 * 同一份数据源，不会出现「词书里的释义和查词得到的不一样」。
 *
 * 懒加载 + 内存缓存：首次数万条一次性读完约 30ms，之后零成本。
 */

type RawEntry = { w: string; r: number; c: number; o: number };

type RawBook = {
  id: string;
  name: string;
  level: string;
  rule: string;
  count: number;
  entries: RawEntry[];
};

type RawFile = {
  version: number;
  source: string;
  builtAt: string;
  books: RawBook[];
};

export type WordbookMeta = {
  id: string;
  name: string;
  level: string;
  rule: string;
  count: number;
};

export type WordbookEntry = {
  word: string;
  /** COCA/BNC 综合词频排名 */
  rank: number;
  /** 柯林斯星级 0-5 */
  collins: number;
  oxford: boolean;
  phonetic: string | null;
  definitions: Definition[];
};

let cache: RawFile | null = null;
let loaded = false;

function readFile(): RawFile {
  if (loaded && cache) return cache;
  const candidates = [
    path.join(process.cwd(), "data", "wordbooks.json"),
    path.join(process.cwd(), "..", "data", "wordbooks.json"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      cache = JSON.parse(raw) as RawFile;
      loaded = true;
      const total = cache.books.reduce((sum, book) => sum + book.entries.length, 0);
      console.log(`[wordbook] loaded ${cache.books.length} books / ${total} words from ${candidate}`);
      return cache;
    } catch {
      // 继续尝试下一个路径
    }
  }
  console.warn("[wordbook] data/wordbooks.json not found, wordbooks disabled");
  cache = { version: 1, source: "", builtAt: "", books: [] };
  loaded = true;
  return cache;
}

export function listWordbooks(): WordbookMeta[] {
  return readFile().books.map((book) => ({
    id: book.id,
    name: book.name,
    level: book.level,
    rule: book.rule,
    count: book.entries.length,
  }));
}

export function hasWordbook(): boolean {
  return readFile().books.length > 0;
}

function findBook(id: string): RawBook | null {
  const file = readFile();
  for (const book of file.books) {
    if (book.id === id) return book;
  }
  return null;
}

/** 用离线词库补全释义；查不到就留空，导入时照收，后续由 /api/vocab/refresh 补 */
function expand(entry: RawEntry): WordbookEntry {
  const dict = lookupOffline(entry.w);
  return {
    word: entry.w,
    rank: entry.r,
    collins: entry.c,
    oxford: entry.o === 1,
    phonetic: dict?.phonetic ?? null,
    definitions: dict?.definitions ?? [],
  };
}

/** 分页取词书内容（浏览用，一次最多 200 条） */
export function pageWordbook(
  id: string,
  offset: number,
  limit: number,
): { book: WordbookMeta; entries: WordbookEntry[]; hasMore: boolean } | null {
  const book = findBook(id);
  if (!book) return null;
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const slice = book.entries.slice(safeOffset, safeOffset + safeLimit);
  return {
    book: {
      id: book.id,
      name: book.name,
      level: book.level,
      rule: book.rule,
      count: book.entries.length,
    },
    entries: slice.map(expand),
    hasMore: safeOffset + safeLimit < book.entries.length,
  };
}

/**
 * 某本词书的全部词（小写）。
 *
 * 用途：「已导入 N / 总数」按**词成员**判定，而不是按 VocabWord.wordbookId 分组。
 * 一个词可能同时属于「高频」和「必备核心」，而 VocabWord 只有单个 wordbookId，
 * 按字段分组会把词只算给其中一本，另一本的进度永远停在 0（用户会以为没导入成功）。
 */
export function wordsOfBook(id: string): string[] {
  const book = findBook(id);
  return book ? book.entries.map((entry) => entry.w) : [];
}

/** 取词书前 n 条（导入用）。按词频排名升序，越靠前越高频 */
export function takeWordbook(id: string, count: number): WordbookEntry[] {
  const book = findBook(id);
  if (!book) return [];
  const safeCount = Math.min(3000, Math.max(1, Math.floor(count) || 50));
  return book.entries.slice(0, safeCount).map(expand);
}

/**
 * 单词 → 词书索引。导入 500 个词时若每词都线性扫 3800 条，是 190 万次比较；
 * 建一次 Map 后就是 O(1)。索引随词书文件一起懒加载。
 */
let index: Map<string, { bookId: string; rank: number }> | null = null;

function buildIndex(): Map<string, { bookId: string; rank: number }> {
  if (index) return index;
  const map = new Map<string, { bookId: string; rank: number }>();
  for (const book of readFile().books) {
    for (const entry of book.entries) {
      const existing = map.get(entry.w);
      // 同一个词可能同时出现在「高频」和「必备核心」里，保留排名更靠前的（数值更小）
      if (!existing || entry.r < existing.rank) {
        map.set(entry.w, { bookId: book.id, rank: entry.r });
      }
    }
  }
  index = map;
  return map;
}

/**
 * 查某个词属于哪本词书、词频排名多少。
 * 单词入库时用来打标签（决定后续优先级里的 exam / freq 两项）。
 */
export function findInWordbooks(word: string): { bookId: string; rank: number } | null {
  return buildIndex().get(word.trim().toLowerCase()) ?? null;
}

/** 批量查询：一次导入几百个词时避免重复建索引 */
export function rankOfWords(words: string[]): Map<string, number> {
  const map = buildIndex();
  const out = new Map<string, number>();
  for (const word of words) {
    const hit = map.get(word.trim().toLowerCase());
    if (hit) out.set(word, hit.rank);
  }
  return out;
}
