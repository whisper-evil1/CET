import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { reviewSchema } from "@/lib/validators";
import { computePriority, scheduleReview, type SrsGrade } from "@/lib/vocab-srs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/vocab/[id]/review —— 复习判定 + 间隔重复调度
 *
 * 入参沿用旧口径 { result: "known" | "unknown" }，内部映射到调度等级：
 *   known   → good（答对，间隔推进）
 *   unknown → again（答错，10 分钟后再来一遍 + ease 下调）
 * 也接受显式 grade（again/hard/good/easy），留给后续「模糊 / 简单」按钮。
 *
 * 返回值带上 dueAt / intervalDays / nextLabel，前端能直接告诉用户「3 天后再见」。
 */
export const POST = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const body = await parseBody(request, reviewSchema);

  const row = await prisma.vocabWord.findUnique({ where: { id } });
  if (!row) return Errors.notFound("这个单词");
  if (row.userId !== meId) return Errors.forbidden();

  const grade: SrsGrade = body.grade ?? (body.result === "known" ? "good" : "again");

  const next = scheduleReview(
    {
      reviewCount: row.reviewCount,
      correctStreak: row.correctStreak,
      lapses: row.lapses,
      intervalDays: row.intervalDays,
      ease: row.ease,
      status: row.status,
      dueAt: row.dueAt,
    },
    grade,
  );

  // 优先级快照：只服务「按优先级粗排」，真实排序在读的时候现算
  const priority = computePriority({
    word: row.word,
    examRank: row.examRank,
    examTags: row.examTags,
    source: row.source,
    hasContext: Boolean(row.sourceContext),
    status: next.status,
    reviewCount: next.reviewCount,
    correctStreak: next.correctStreak,
    lapses: next.lapses,
    intervalDays: next.intervalDays,
    dueAt: next.dueAt,
  }).score;

  const updated = await prisma.vocabWord.update({
    where: { id },
    data: {
      reviewCount: next.reviewCount,
      correctStreak: next.correctStreak,
      lapses: next.lapses,
      intervalDays: next.intervalDays,
      ease: next.ease,
      status: next.status,
      dueAt: next.dueAt,
      priority,
    },
    select: {
      id: true,
      reviewCount: true,
      correctStreak: true,
      lapses: true,
      intervalDays: true,
      ease: true,
      status: true,
      dueAt: true,
    },
  });

  // 分析面板的流水：写失败不能连累复习本身（老库没这张表时也只是少一条统计）
  await prisma.vocabReview
    .create({
      data: {
        userId: meId,
        wordId: id,
        grade,
        isCorrect: grade === "good" || grade === "easy",
        intervalDays: next.intervalDays,
        reviewCount: next.reviewCount,
      },
    })
    .catch(() => null);

  return ok({
    ...updated,
    dueAt: updated.dueAt ? updated.dueAt.toISOString() : null,
    priority,
    nextLabel: next.nextLabel,
    justMastered: next.justMastered,
  });
});
