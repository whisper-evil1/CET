import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import type { LearningStats } from "@/lib/types";

/** GET /api/me/stats —— 首页与个人中心的概览数据 */
export const GET = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const [vocabTotal, vocabLearning, vocabMastered, favoriteCount, answers, user] =
    await Promise.all([
      prisma.vocabWord.count({ where: { userId: meId } }),
      prisma.vocabWord.count({ where: { userId: meId, status: "learning" } }),
      prisma.vocabWord.count({ where: { userId: meId, status: "mastered" } }),
      prisma.favorite.count({ where: { userId: meId } }),
      prisma.answer.findMany({ where: { userId: meId }, select: { isCorrect: true } }),
      prisma.user.findUnique({ where: { id: meId }, select: { email: true, name: true, avatar: true, createdAt: true } }),
    ]);

  const answeredCount = answers.length;
  const correctCount = answers.filter((a) => a.isCorrect).length;

  const data: LearningStats & { user: { email: string; name: string | null; avatar: string | null; joinedAt: string } } = {
    vocabTotal,
    vocabLearning,
    vocabMastered,
    favoriteCount,
    answeredCount,
    correctCount,
    accuracy: answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0,
    user: {
      email: user?.email ?? "",
      name: user?.name ?? null,
      avatar: user?.avatar ?? null,
      joinedAt: user?.createdAt.toISOString() ?? new Date().toISOString(),
    },
  };

  return ok(data);
});
