import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { periodKey, type PeriodType } from "@/lib/period";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * GET /api/leaderboard?level=CET4&period=week
 * level: CET4 | CET6
 * period: week | month
 * 返回：榜单前 50 + 我的排名（未上榜则 null）
 */
export const GET = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const url = new URL(request.url);
  const level = url.searchParams.get("level") ?? "CET4";
  const period = (url.searchParams.get("period") ?? "week") as PeriodType;

  if (level !== "CET4" && level !== "CET6") return Errors.badRequest("level 必须是 CET4 或 CET6");
  if (period !== "week" && period !== "month") return Errors.badRequest("period 必须是 week 或 month");

  const key = periodKey(period, new Date());

  const rows = await prisma.userStats.findMany({
    where: { level, periodType: period, periodKey: key },
    orderBy: { totalScore: "desc" },
    take: 50,
    include: { user: { select: { name: true, email: true } } },
  });

  const list: LeaderboardEntry[] = rows.map((r, i) => ({
    userId: r.userId,
    userName: r.user.name ?? r.user.email ?? "匿名",
    avatar: null,
    totalScore: r.totalScore,
    checkinDays: r.checkinDays,
    accuracy: r.accuracy,
    newVocab: r.newVocab,
    questionCount: r.questionCount,
    rank: i + 1,
  }));

  const myRow = await prisma.userStats.findUnique({
    where: {
      userId_level_periodType_periodKey: {
        userId: meId,
        level,
        periodType: period,
        periodKey: key,
      },
    },
  });

  let me: (LeaderboardEntry & { rank: number | null }) | null = null;
  if (myRow) {
    const ahead = await prisma.userStats.count({
      where: {
        level,
        periodType: period,
        periodKey: key,
        totalScore: { gt: myRow.totalScore },
      },
    });
    me = {
      userId: myRow.userId,
      userName: "我",
      avatar: null,
      totalScore: myRow.totalScore,
      checkinDays: myRow.checkinDays,
      accuracy: myRow.accuracy,
      newVocab: myRow.newVocab,
      questionCount: myRow.questionCount,
      rank: ahead + 1,
    };
  }

  return ok({ list, me });
});
