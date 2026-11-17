import { prisma } from "./prisma";
import { listWordbooks, pageWordbook, takeWordbook, type WordbookEntry } from "./wordbook";
import { lookupWord, normalizeWord } from "./dict";
import type { Definition } from "./types";

/**
 * 词书：把「背哪些词」这件事从生词本里独立出来。
 *
 * 三种来源，对用户是同一排书架：
 *   reading   —— 刷阅读时点过查过的词（来自 VocabWord，source=lookup），自动同步，不用维护
 *   exam:*    —— 内置四六级高频词书（data/wordbooks.json），只读
 *   custom    —— 用户自己建的本子，可以建很多个，能加词、移词、改名、删掉
 *
 * 只有 custom 落库（WordBook / WordBookItem）。前两种是虚拟书：
 * 数据本来就已经存在，再复制一份进库只会让两边对不上。
 */

export type BookKind = "reading" | "exam" | "custom";

export const READING_BOOK_ID = "reading";
const EXAM_PREFIX = "exam:";

export type BookSummary = {
  id: string;
  name: string;
  kind: BookKind;
  count: number;
  isDefault: boolean;
  /** 内置词书的等级 / 分级说明 */
  level?: string;
  rule?: string;
};

/** 书里的一条词，背单词和词表都用这个形状 */
export type StudyWord = {
  word: string;
  phonetic: string | null;
  definitions: Definition[];
  rank: number | null;
  /** 阅读生词才有：当初是在哪句话里遇到的 */
  context?: string | null;
  /** custom 书里的条目 id，用于移词 */
  itemId?: string;
  /** 阅读生词才有：这条词在生词本里的 id（背词时写回记忆曲线用） */
  vocabId?: string;
};

export function parseBookId(raw: string): { kind: BookKind; key: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value === READING_BOOK_ID) return { kind: "reading", key: READING_BOOK_ID };
  if (value.startsWith(EXAM_PREFIX)) {
    const key = value.slice(EXAM_PREFIX.length);
    return key ? { kind: "exam", key } : null;
  }
  return { kind: "custom", key: value };
}

export const examBookId = (id: string) => `${EXAM_PREFIX}${id}`;

function parseDefinitions(raw: string): Definition[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Definition => Boolean(item) && typeof item === "object")
      .map((item) => ({ pos: String(item.pos ?? ""), zh: String(item.zh ?? "") }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 书架                                                                */
/* ------------------------------------------------------------------ */

/**
 * 保证这个用户有一本「默认词书」。
 *
 * 加词的时候总要有个默认落点，否则每次都要先逼用户建一本书 ——
 * 所以第一次用到词书功能时自动建一本，名字就叫「我的词书」。
 */
export async function ensureDefaultBook(userId: string): Promise<string> {
  const existing = await prisma.wordBook.findFirst({
    where: { userId, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;

  // 以前建过书但没有标记默认：把最早那本设为默认，不再新建
  const any = await prisma.wordBook.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (any) {
    await prisma.wordBook.update({ where: { id: any.id }, data: { isDefault: true } });
    return any.id;
  }

  const created = await prisma.wordBook.create({
    data: { userId, name: "我的词书", isDefault: true },
  });
  return created.id;
}

/** 阅读生词的数量：就是生词本里的全部词（和「生词本」页签同一份数据） */
async function readingCount(userId: string): Promise<number> {
  return prisma.vocabWord.count({ where: { userId } });
}

export async function listBooks(userId: string): Promise<BookSummary[]> {
  const [customs, reading, builtin] = await Promise.all([
    prisma.wordBook.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { items: true } } },
    }),
    readingCount(userId),
    Promise.resolve(listWordbooks()),
  ]);

  const books: BookSummary[] = [
    {
      id: READING_BOOK_ID,
      name: "阅读生词",
      kind: "reading",
      count: reading,
      isDefault: false,
      rule: "生词本里的全部词，自动同步",
    },
    ...builtin.map((book) => ({
      id: examBookId(book.id),
      name: book.name,
      kind: "exam" as const,
      count: book.count,
      isDefault: false,
      level: book.level,
      rule: book.rule,
    })),
    ...customs.map((book) => ({
      id: book.id,
      name: book.name,
      kind: "custom" as const,
      count: book._count.items,
      isDefault: book.isDefault,
    })),
  ];

  return books;
}

/* ------------------------------------------------------------------ */
/* 建 / 改 / 删                                                        */
/* ------------------------------------------------------------------ */

export class BookError extends Error {}

export async function createBook(userId: string, rawName: string): Promise<BookSummary> {
  const name = rawName.trim().slice(0, 24);
  if (!name) throw new BookError("词书名字不能为空");

  const dup = await prisma.wordBook.findFirst({ where: { userId, name } });
  if (dup) throw new BookError("已经有同名词书了，换个名字");

  const created = await prisma.wordBook.create({ data: { userId, name } });
  return { id: created.id, name: created.name, kind: "custom", count: 0, isDefault: created.isDefault };
}

/** 只有自建书能改名 / 设默认 / 删除；虚拟书直接拒绝，避免用户以为改坏了内置词书 */
async function requireCustomBook(userId: string, bookId: string) {
  const parsed = parseBookId(bookId);
  if (!parsed || parsed.kind !== "custom") {
    throw new BookError("内置词书和阅读生词是自动的，不用改名或删除");
  }
  const book = await prisma.wordBook.findFirst({ where: { id: parsed.key, userId } });
  if (!book) throw new BookError("词书不存在");
  return book;
}

export async function renameBook(userId: string, bookId: string, rawName: string) {
  const book = await requireCustomBook(userId, bookId);
  const name = rawName.trim().slice(0, 24);
  if (!name) throw new BookError("词书名字不能为空");
  const dup = await prisma.wordBook.findFirst({ where: { userId, name, NOT: { id: book.id } } });
  if (dup) throw new BookError("已经有同名词书了");
  return prisma.wordBook.update({ where: { id: book.id }, data: { name } });
}

export async function deleteBook(userId: string, bookId: string) {
  const book = await requireCustomBook(userId, bookId);
  await prisma.wordBook.delete({ where: { id: book.id } });
  // 删掉的如果是默认书，补一本，避免加词时没有落点
  if (book.isDefault) await ensureDefaultBook(userId);
  return { ok: true };
}

export async function setDefaultBook(userId: string, bookId: string) {
  const book = await requireCustomBook(userId, bookId);
  await prisma.wordBook.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
  await prisma.wordBook.update({ where: { id: book.id }, data: { isDefault: true } });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 词                                                                  */
/* ------------------------------------------------------------------ */

/**
 * 往自建词书里加词。
 *
 * 释义当场查一次存快照：词书要能离线背，不能每次打开都去请求词典。
 * 查不到释义也照样收 —— 用户想背的词，不该因为词典没收录就加不进去。
 */
export async function addWordsToBook(
  userId: string,
  bookId: string,
  rawWords: string[],
): Promise<{ added: number; duplicated: number; book: BookSummary }> {
  const book = await requireCustomBook(userId, bookId);
  const words = Array.from(
    new Set(rawWords.map((w) => normalizeWord(w)).filter((w) => w.length > 0 && w.length <= 48)),
  ).slice(0, 200);
  if (words.length === 0) throw new BookError("没有可加入的词");

  const existing = await prisma.wordBookItem.findMany({
    where: { bookId: book.id, word: { in: words } },
    select: { word: true },
  });
  const known = new Set(existing.map((row) => row.word));
  const fresh = words.filter((w) => !known.has(w));

  // 同一批里既要写库又要查释义，控制并发别把词典打爆
  let added = 0;
  for (const word of fresh) {
    const entry = await lookupWord(word).catch(() => null);
    const defs = entry?.definitions ?? [];
    try {
      await prisma.wordBookItem.create({
        data: {
          bookId: book.id,
          userId,
          word,
          phonetic: entry?.phonetic ?? null,
          definitions: JSON.stringify(defs),
          rank: null,
        },
      });
      added += 1;
    } catch {
      // 唯一约束撞了（并发加同一个词），跳过即可
    }
  }

  const count = await prisma.wordBookItem.count({ where: { bookId: book.id } });
  return {
    added,
    duplicated: words.length - added,
    book: { id: book.id, name: book.name, kind: "custom", count, isDefault: book.isDefault },
  };
}

export async function removeWordFromBook(userId: string, bookId: string, word: string) {
  const book = await requireCustomBook(userId, bookId);
  await prisma.wordBookItem.deleteMany({
    where: { bookId: book.id, userId, word: normalizeWord(word) },
  });
  return { ok: true };
}

/**
 * 一本书里的词，按「背的顺序」返回。
 *
 * reading：最近查过的优先（刚遇到的词最容易忘，也最有用）
 * exam：按词频排名升序，最该背的排前面
 * custom：按加入时间倒序，刚加的词先背
 */
export async function bookWords(
  userId: string,
  bookId: string,
  limit = 200,
): Promise<{ book: BookSummary | null; words: StudyWord[] }> {
  const parsed = parseBookId(bookId);
  if (!parsed) return { book: null, words: [] };
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit) || 200));

  if (parsed.kind === "reading") {
    // 阅读生词 = 生词本的全部词（不限 source），和「生词本」页签是同一份数据。
    const rows = await prisma.vocabWord.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
    });
    return {
      book: { id: READING_BOOK_ID, name: "阅读生词", kind: "reading", count: rows.length, isDefault: false },
      words: rows.map((row) => ({
        word: row.word,
        phonetic: row.phonetic,
        definitions: parseDefinitions(row.definitions),
        rank: row.examRank,
        context: row.sourceContext,
        vocabId: row.id,
      })),
    };
  }

  if (parsed.kind === "exam") {
    const page = pageWordbook(parsed.key, 0, Math.min(200, safeLimit));
    if (!page) return { book: null, words: [] };
    return {
      book: {
        id: examBookId(page.book.id),
        name: page.book.name,
        kind: "exam",
        count: page.book.count,
        isDefault: false,
        level: page.book.level,
        rule: page.book.rule,
      },
      words: page.entries.map(toStudyWord),
    };
  }

  const book = await prisma.wordBook.findFirst({ where: { id: parsed.key, userId } });
  if (!book) return { book: null, words: [] };
  const items = await prisma.wordBookItem.findMany({
    where: { bookId: book.id },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
  });
  return {
    book: { id: book.id, name: book.name, kind: "custom", count: items.length, isDefault: book.isDefault },
    words: items.map((item) => ({
      word: item.word,
      phonetic: item.phonetic,
      definitions: parseDefinitions(item.definitions),
      rank: item.rank,
      itemId: item.id,
    })),
  };
}

function toStudyWord(entry: WordbookEntry): StudyWord {
  return {
    word: entry.word,
    phonetic: entry.phonetic,
    definitions: entry.definitions,
    rank: entry.rank,
  };
}

/**
 * 把内置词书的一批词复制进自建词书。
 *
 * 这是「把四级高频词加到我自己的本子」那条路：内置书只读，
 * 想背就得有一份自己的副本（用户可能在副本里删词、加词）。
 */
export async function importExamWordsToBook(
  userId: string,
  examId: string,
  bookId: string,
  count: number,
): Promise<{ added: number; duplicated: number }> {
  const book = await requireCustomBook(userId, bookId);
  const entries = takeWordbook(examId, count);
  if (entries.length === 0) throw new BookError("这本词书没有内容");

  const existing = await prisma.wordBookItem.findMany({
    where: { bookId: book.id },
    select: { word: true },
  });
  const known = new Set(existing.map((row) => row.word));
  const fresh = entries.filter((entry) => !known.has(entry.word));

  let added = 0;
  for (const entry of fresh) {
    try {
      await prisma.wordBookItem.create({
        data: {
          bookId: book.id,
          userId,
          word: entry.word,
          phonetic: entry.phonetic,
          definitions: JSON.stringify(entry.definitions),
          rank: entry.rank,
        },
      });
      added += 1;
    } catch {
      /* 并发撞唯一约束，跳过 */
    }
  }
  return { added, duplicated: entries.length - added };
}
