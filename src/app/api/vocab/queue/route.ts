import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { toVocabItem } from "@/lib/vocab-view";
import { rankQueue, type PriorityInput } from "@/lib/vocab-srs";
import type { VocabQueue } from "@/lib/types";

/**
 * GET /api/vocab/queue?limit=20&includeMastered=0
 *
 * 今日队列：把「现在最该背的词」按优先级排好序返回。
 * 排序逻辑全部在 src/lib/vocab-srs.ts 的 rankQueue 里（可单测、前后端一致）：
 *   1. 学习中的词参与排序，未到期的排除；已掌握默认不打扰；
 *   2. 分数 = 考纲 0.30 + 词频 0.28 + 紧迫 0.27 + 薄弱 0.15，真题语境 +3；
 *   3. 同分用词形哈希抖动打散，同一天内顺序稳定，不会每次刷新都变。
 */
export const GET = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const params = new URL(request.url).searchParams;
  const limitRaw = Number(params.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
  const includeMastered = params.get("includeMastered") === "1";

  const rows = await prisma.vocabWord.findMany({
    where: { userId: meId },
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const inputs: PriorityInput[] = rows.map((row) => ({
    word: row.word,
    examRank: row.examRank,
    examTags: row.examTags,
    source: row.source,
    hasContext: Boolean(row.sourceContext),
    status: row.status,
    reviewCount: row.reviewCount,
    correctStreak: row.correctStreak,
    lapses: row.lapses,
    intervalDays: row.intervalDays,
    dueAt: row.dueAt,
    now,
  }));

  const ranked = rankQueue(inputs, { limit, includeMastered, now });
  const byWord = new Map(rows.map((row) => [row.word, row]));

  const items = ranked
    .map((hit) => byWord.get(hit.item.word))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => toVocabItem(row, now));

  const learning = rows.filter((row) => row.status !== "mastered");
  const dueCount = learning.filter((row) => {
    if (row.reviewCount <= 0) return true;
    if (!row.dueAt) return true;
    return row.dueAt.getTime() <= now;
  }).length;

  const data: VocabQueue = {
    items,
    learningCount: learning.length,
    dueCount,
    newCount: learning.filter((row) => row.reviewCount <= 0).length,
    masteredCount: rows.length - learning.length,
  };

  return ok(data);
});
