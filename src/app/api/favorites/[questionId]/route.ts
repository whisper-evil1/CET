import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";

type Ctx = { params: Promise<{ questionId: string }> };

/** POST /api/favorites/[questionId] —— 切换收藏状态，返回最新状态 */
export const POST = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { questionId } = await ctx.params;

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true },
  });
  if (!question) return Errors.notFound("这道题");

  const existing = await prisma.favorite.findUnique({
    where: { userId_questionId: { userId: meId, questionId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.favorite.delete({ where: { id: existing.id } });
    return ok({ favorited: false });
  }

  await prisma.favorite.create({ data: { userId: meId, questionId } });
  return ok({ favorited: true });
});
