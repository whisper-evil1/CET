import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { listWordbooks, wordsOfBook } from "@/lib/wordbook";
import type { WordbookMeta } from "@/lib/types";

/**
 * GET /api/vocab/wordbooks —— 内置四六级词书列表 + 每人已导入进度
 *
 * 词书数据来自 data/wordbooks.json（ECDICT 词频字段生成），不随页面打包，
 * 所以首屏体积不变，只是多一次约 100 KB 的接口响应（浏览器可缓存）。
 *
 * 「已导入」按词成员判定：用户词表里有多少词属于这本书。
 * 早先按 VocabWord.wordbookId 分组统计，但一个词常同时属于「高频」与「必备核心」，
 * 而字段只有一个，先导入哪本就把词算给哪本，另一本永远显示 0/N。
 */
export const GET = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const books = listWordbooks();
  if (books.length === 0) return ok([]);

  const mine = await prisma.vocabWord.findMany({
    where: { userId: meId },
    select: { word: true },
  });
  const mineSet = new Set(mine.map((row) => row.word.trim().toLowerCase()));

  const data: WordbookMeta[] = books.map((book) => ({
    ...book,
    imported: wordsOfBook(book.id).filter((word) => mineSet.has(word)).length,
  }));

  return ok(data);
});
