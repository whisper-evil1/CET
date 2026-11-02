import { prisma } from "./prisma";
import { startOfDay, periodRange, periodKey, addDays, type PeriodType } from "./period";
import { computeScore } from "./scoring";

const LEVELS = ["CET4", "CET6"] as const;
const PERIOD_TYPES: PeriodType[] = ["week", "month"];

/**
 * 重算某用户在「指定 level（缺省为全部）」当前周/月的统计与积分，并写入 UserStats。
 * 答题提交后传入该题所属 level，只重算受影响的那一半（从 4 行降到 2 行），
 * 减少一半的 count 查询与 upsert。
 *
 * 说明：没有做成逐答 delta 累加——那会牵扯「打卡/新增生词/首答正确率」的正确性，
 * 一旦算错很难回滚；在当前规模下按 level 收敛已足够，规模化后可再演进为增量。
 * 整个函数由答案路由 try/catch 包裹，失败不影响答题流程。
 */
export async function syncUserStats(userId: string, level?: string) {
  const now = new Date();
  const levels: readonly string[] = level ? [level] : LEVELS;

  await syncTodayCheckin(userId, levels);

  for (const lv of levels) {
    for (const periodType of PERIOD_TYPES) {
      const { start, end } = periodRange(periodType, now);
      const key = periodKey(periodType, now);

      const [questionCount, correctCount, newVocab, checkinDays] = await Promise.all([
        prisma.answer.count({
          where: {
            userId,
            createdAt: { gte: start, lte: end },
            question: { passage: { paper: { level: lv } } },
          },
        }),
        prisma.answer.count({
          where: {
            userId,
            isCorrect: true,
            createdAt: { gte: start, lte: end },
            question: { passage: { paper: { level: lv } } },
          },
        }),
        prisma.vocabWord.count({
          where: { userId, createdAt: { gte: start, lte: end } },
        }),
        prisma.checkin.count({
          where: { userId, level: lv, date: { gte: start, lte: end } },
        }),
      ]);

      const { totalScore, accuracy } = computeScore({
        questionCount,
        correctCount,
        checkinDays,
        newVocab,
      });

      await prisma.userStats.upsert({
        where: {
          userId_level_periodType_periodKey: { userId, level: lv, periodType, periodKey: key },
        },
        create: {
          userId,
          level: lv,
          periodType,
          periodKey: key,
          questionCount,
          correctCount,
          accuracy,
          newVocab,
          checkinDays,
          totalScore,
        },
        update: {
          questionCount,
          correctCount,
          accuracy,
          newVocab,
          checkinDays,
          totalScore,
        },
      });
    }
  }
}

/**
 * 同步当天的打卡记录：每个 level 当天答题 ≥5 题即视为打卡。
 * 不足 5 题会删除当天该 level 的打卡行，避免误打。
 */
async function syncTodayCheckin(userId: string, levels: readonly string[]) {
  const start = startOfDay(new Date());
  const end = addDays(start, 1);
  end.setMilliseconds(end.getMilliseconds() - 1);

  for (const lv of levels) {
    const count = await prisma.answer.count({
      where: {
        userId,
        createdAt: { gte: start, lte: end },
        question: { passage: { paper: { level: lv } } },
      },
    });

    if (count >= 5) {
      await prisma.checkin.upsert({
        where: { userId_date_level: { userId, date: start, level: lv } },
        create: { userId, date: start, level: lv, questionCount: count },
        update: { questionCount: count },
      });
    } else {
      await prisma.checkin.deleteMany({ where: { userId, date: start, level: lv } });
    }
  }
}
