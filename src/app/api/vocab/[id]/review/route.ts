import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { reviewSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

const MASTER_THRESHOLD = 3; // 认识 3 次自动移入已掌握

/**
 * POST /api/vocab/[id]/review —— 复习判定
 *   认识  → reviewCount + 1，correctStreak + 1；累计到 3 次即 status = mastered
 *   不认识 → reviewCount 不变，correctStreak 归零，继续留在学习队列
 */
export const POST = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const body = await parseBody(request, reviewSchema);

  const row = await prisma.vocabWord.findUnique({
    where: { id },
    select: { userId: true, reviewCount: true, correctStreak: true },
  });
  if (!row) return Errors.notFound("这个单词");
  if (row.userId !== meId) return Errors.forbidden();

  const nextCount = body.result === "known" ? row.reviewCount + 1 : row.reviewCount;
  const nextStreak = body.result === "known" ? row.correctStreak + 1 : 0;
  const nextStatus = nextCount >= MASTER_THRESHOLD ? "mastered" : "learning";

  const updated = await prisma.vocabWord.update({
    where: { id },
    data: {
      reviewCount: nextCount,
      correctStreak: nextStreak,
      status: nextStatus,
    },
    select: { id: true, reviewCount: true, correctStreak: true, status: true },
  });

  return ok({ ...updated, justMastered: body.result === "known" && nextCount === MASTER_THRESHOLD });
});
