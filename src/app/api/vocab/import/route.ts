import { prisma } from "@/lib/prisma";
import { ApiError, Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { vocabImportSchema } from "@/lib/validators";
import { toJsonText } from "@/lib/db-mappers";
import { MAX_WORDS, cleanWord, parseWordText, type ParsedEntry } from "@/lib/vocab-import";
import { findInWordbooks, listWordbooks, takeWordbook } from "@/lib/wordbook";
import { lookupOffline } from "@/lib/offline-dict";
import type { Definition, ImportResult } from "@/lib/types";

/**
 * POST /api/vocab/import —— 外部词表 / 内置词书 → 个人生词库
 *
 * 三个入口：
 *   1. { text }                 粘贴或上传的文本，逐行解析
 *   2. { words: [{word, definitions?}] }   已经是结构化数组
 *   3. { wordbookId, count? }   从内置四六级词书批量取词
 *
 * 释义补全只走本地离线词库（1.5 万条，毫秒级）：
 * 导入是批量操作，几百个词挨个调 AI 会让一个请求跑几十秒且结果不可复现。
 * 词库里没有的词照样入库（释义留空），页面上的 /api/vocab/refresh 会继续补。
 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const limit = rateLimit(`vocab-import:${meId}`, { windowMs: 600000, max: 30 });
  if (!limit.allowed) {
    return Errors.tooMany(`导入太频繁了，${limit.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, vocabImportSchema);

  let entries: ParsedEntry[] = [];
  let rejected: string[] = [];
  let source = "import";
  let wordbookId: string | null = null;

  if (body.wordbookId) {
    const books = listWordbooks();
    const target = books.find((book) => book.id === body.wordbookId);
    if (!target) throw new ApiError(4004, "没有这个词书", 404);
    const count = body.count ?? 100;
    entries = takeWordbook(target.id, count).map((entry) => ({
      word: entry.word,
      definitions: entry.definitions,
    }));
    source = "wordbook";
    wordbookId = target.id;
  } else if (body.words && body.words.length > 0) {
    entries = body.words
      .map((item) => ({
        word: cleanWord(item.word),
        definitions: item.definitions ?? [],
      }))
      .filter((item) => item.word.length >= 2);
  } else if (body.text && body.text.trim()) {
    const parsed = parseWordText(body.text);
    entries = parsed.entries;
    rejected = parsed.rejected;
  } else {
    throw new ApiError(4000, "没有收到要导入的内容");
  }

  if (entries.length === 0) {
    throw new ApiError(4000, "没有解析出任何单词，检查一下每行是否有英文单词");
  }

  // 去重 + 上限
  const seen = new Set<string>();
  const unique: ParsedEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.word)) continue;
    seen.add(entry.word);
    unique.push(entry);
    if (unique.length >= MAX_WORDS) break;
  }

  // 补全缺释义的词：只用离线词库
  const rows = unique.map((entry) => {
    const offline = lookupOffline(entry.word);
    const definitions: Definition[] =
      entry.definitions.length > 0 ? entry.definitions : offline?.definitions ?? [];
    // 词频排名与词书归属：优先级算法靠这两项决定「先背哪个」，
    // 外部导入的词只要在词书里，也要把这两个值补上，否则它会被当成无考纲词排到最后。
    const inBook = findInWordbooks(entry.word);
    return {
      word: entry.word,
      phonetic: offline?.phonetic ?? null,
      definitions,
      examTags:
        offline && offline.tags && offline.tags.length > 0 ? offline.tags.join(",") : null,
      examRank: inBook ? inBook.rank : null,
      // 从词书导入时归属就是这本书；粘贴导入的词则归到它所属的最靠前那本，
      // 这样「已导入 N / 词书总数」的进度对两种来源都算得上。
      bookId: wordbookId ?? (inBook ? inBook.bookId : null),
    };
  });

  const words = rows.map((row) => row.word);
  const existing = await prisma.vocabWord.findMany({
    where: { userId: meId, word: { in: words } },
    select: {
      id: true,
      word: true,
      definitions: true,
      examTags: true,
      examRank: true,
      phonetic: true,
      wordbookId: true,
    },
  });
  const existingMap = new Map(existing.map((row) => [row.word, row]));

  const toCreate = rows.filter((row) => !existingMap.has(row.word));
  /**
   * 需要补的老记录：
   *   1. 释义为空的（之前查词没查到，这次词库里有）；
   *   2. 缺词频排名 / 考纲标签的（v2.1 之前入库的词都没有这两项，
   *      不补的话它们在优先级里永远吃默认值，排序就失真了）；
   *   3. 没有词书归属的（粘贴导入、查词入库的行 wordbookId 为空，
   *      再次从词书导入时补上；已有归属的不抢，避免把词从别的词书挪走）。
   * 只补空字段，不动复习进度。
   */
  const toFill = rows.filter((row) => {
    const current = existingMap.get(row.word);
    if (!current) return false;
    const definitionsEmpty = current.definitions === "[]" || current.definitions === "";
    const missingMeta =
      (row.examRank != null && current.examRank == null) ||
      (row.examTags != null && current.examTags == null);
    const missingBook = row.bookId != null && current.wordbookId == null;
    return definitionsEmpty || missingMeta || missingBook;
  });

  if (toCreate.length > 0) {
    await prisma.vocabWord.createMany({
      data: toCreate.map((row) => ({
        userId: meId,
        word: row.word,
        phonetic: row.phonetic,
        definitions: toJsonText(row.definitions),
        examTags: row.examTags,
        examRank: row.examRank,
        wordbookId: row.bookId ?? wordbookId,
        source,
        status: "learning",
      })),
    });
  }

  // 老数据只补空格子，绝不覆盖已有释义与进度
  let filled = 0;
  for (const row of toFill) {
    const current = existingMap.get(row.word);
    if (!current) continue;
    const patch: {
      definitions?: string;
      examRank?: number;
      examTags?: string;
      phonetic?: string;
      wordbookId?: string;
    } = {};
    const definitionsEmpty = current.definitions === "[]" || current.definitions === "";
    if (definitionsEmpty && row.definitions.length > 0) {
      patch.definitions = toJsonText(row.definitions);
    }
    if (current.examRank == null && row.examRank != null) patch.examRank = row.examRank;
    if (current.examTags == null && row.examTags != null) patch.examTags = row.examTags;
    if (row.phonetic && !current.phonetic) patch.phonetic = row.phonetic;
    // 只给「还没有归属」的词补词书，不把已在别的词书里的词挪走
    if (row.bookId && current.wordbookId == null) patch.wordbookId = row.bookId;
    if (Object.keys(patch).length === 0) continue;

    await prisma.vocabWord.update({ where: { id: current.id }, data: patch });
    filled += 1;
  }

  const unresolved = rows
    .filter((row) => row.definitions.length === 0)
    .map((row) => row.word)
    .slice(0, 20);

  const result: ImportResult = {
    total: unique.length,
    added: toCreate.length,
    updated: filled,
    skipped: unique.length - toCreate.length - filled,
    unresolved,
    rejected: rejected.slice(0, 10),
  };

  return ok(result);
});
