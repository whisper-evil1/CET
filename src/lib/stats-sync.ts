import { prisma } from "./prisma";
import { startOfDay, periodRange, periodKey, addDays, type PeriodType } from "./period";
import { computeScore } from "./scoring";

const LEVELS = ["CET4", "CET6"] as const;
const PERIOD_TYPES: PeriodType[] = ["week", "month"];

/**
 * 重算某用户在当前周/月、CET4/CET6 的统计与积分，并写入 UserStats。
 * 数据量小（单用户 × 2 level × 2 period = 4 行），每次全量重算比增量加减更可靠。
 * 在答案提交后调用，try/catch 包裹，失败不影响答题流程。
 */
export async function syncUserStats(userId: string) {
  const now = new Date();
  await syncTodayCheckin(userId);

  for (const level of LEVELS) {
    for (const periodType of PERIOD_TYPES) {
      const { start, end } = periodRange(periodType, now);
      const key = periodKey(periodType, now);

      const [questionCount, correctCount, newVocab, checkinDays] = await Promise.all([
        prisma.answer.count({
          where: {
            userId,
            createdAt: { gte: start, lte: end },
            question: { passage: { paper: { level } } },
          },
        }),
        prisma.answer.count({
          where: {
            userId,
            isCorrect: true,
            createdAt: { gte: start, lte: end },
            question: { passage: { paper: { level } } },
          },
        }),
        prisma.vocabWord.count({
          where: { userId, createdAt: { gte: start, lte: end } },
        }),
        prisma.checkin.count({
          where: { userId, level, date: { gte: start, lte: end } },
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
          userId_level_periodType_periodKey: { userId, level, periodType, periodKey: key },
        },
        create: {
          userId,
          level,
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
async function syncTodayCheckin(userId: string) {
  const start = startOfDay(new Date());
  const end = addDays(start, 1);
  end.setMilliseconds(end.getMilliseconds() - 1);

  for (const level of LEVELS) {
    const count = await prisma.answer.count({
      where: {
        userId,
        createdAt: { gte: start, lte: end },
        question: { passage: { paper: { level } } },
      },
    });

    if (count >= 5) {
      await prisma.checkin.upsert({
        where: { userId_date_level: { userId, date: start, level } },
        create: { userId, date: start, level, questionCount: count },
        update: { questionCount: count },
      });
    } else {
      await prisma.checkin.deleteMany({ where: { userId, date: start, level } });
    }
  }
}

