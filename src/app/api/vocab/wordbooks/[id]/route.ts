import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { pageWordbook } from "@/lib/wordbook";
import type { WordbookEntry } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/vocab/wordbooks/[id]?offset=0&limit=50 —— 分页浏览词书
 *
 * 分页而不是一次性返回 1500 条：手机上滚 1500 条会卡，
 * 而且用户真正会看的通常是按词频排在最前的那几百个。
 */
export const GET = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const offset = Number(params.get("offset")) || 0;
  const limit = Number(params.get("limit")) || 50;

  const page = pageWordbook(id, offset, limit);
  if (!page) return Errors.notFound("这个词书");

  const words = page.entries.map((entry) => entry.word);
  const owned = await prisma.vocabWord.findMany({
    where: { userId: meId, word: { in: words } },
    select: { word: true },
  });
  const ownedSet = new Set(owned.map((row) => row.word));

  const entries: WordbookEntry[] = page.entries.map((entry) => ({
    ...entry,
    imported: ownedSet.has(entry.word),
  }));

  return ok({
    book: page.book,
    entries,
    hasMore: page.hasMore,
    offset,
    limit,
  });
});
