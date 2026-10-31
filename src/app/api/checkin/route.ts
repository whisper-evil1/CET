import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { startOfDay, startOfMonth, endOfMonth, addDays, dateKey } from "@/lib/period";

export type CheckinLevel = "CET4" | "CET6";

export type CheckinData = {
  /** 今天各 level 已答题数 */
  today: Record<CheckinLevel, number>;
  /** 今天是否已打卡（答题 ≥5） */
  checkedIn: Record<CheckinLevel, boolean>;
  /** 本月各 level 打卡天数 */
  monthByLevel: Record<CheckinLevel, number>;
  /** 本月总打卡天数（任一 level 打卡即计 1 天） */
  monthDays: number;
  /** 连续打卡天数（到今天为止） */
  streak: number;
  /** 本月日历：每天有哪些 level 打卡 */
  calendar: { date: string; levels: CheckinLevel[] }[];
};

const LEVELS: CheckinLevel[] = ["CET4", "CET6"];

/**
 * GET /api/checkin
 * 返回当前用户本月打卡日历、今日进度、连续天数。
 * 打卡由答题自动触发（≥5 题/天/级别），无需手动按钮。
 */
export const GET = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const now = new Date();
  const today = startOfDay(now);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  const rows = await prisma.checkin.findMany({
    where: { userId: meId, date: { gte: monthStart, lte: monthEnd } },
    orderBy: { date: "asc" },
  });

  // 本月每天 → levels
  const byDay = new Map<string, CheckinLevel[]>();
  const byLevelCount: Record<CheckinLevel, number> = { CET4: 0, CET6: 0 };
  for (const r of rows) {
    const k = dateKey(r.date);
    const arr = byDay.get(k) ?? [];
    arr.push(r.level as CheckinLevel);
    byDay.set(k, arr);
    byLevelCount[r.level as CheckinLevel] += 1;
  }

  // 日历：1 号到月底
  const calendar: CheckinData["calendar"] = [];
  let cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const k = dateKey(cursor);
    calendar.push({ date: k, levels: byDay.get(k) ?? [] });
    cursor = addDays(cursor, 1);
  }

  const monthDays = byDay.size;

  // 连续打卡天数：今天起往前数
  let streak = 0;
  const allDays = new Set<string>();
  for (const k of byDay.keys()) allDays.add(k);
  let cur = today;
  // 今天没打卡则 streak 从昨天开始算（不把今天算断，但习惯上今天没打卡就是 0）
  // 规则：以今天为基准，有今天则从今天数起；没今天则 streak=0
  if (allDays.has(dateKey(today))) {
    streak = 1;
    cur = addDays(cur, -1);
    while (allDays.has(dateKey(cur))) {
      streak += 1;
      cur = addDays(cur, -1);
    }
  }

  // 今天各 level 答题数
  const todayEnd = addDays(today, 1);
  todayEnd.setMilliseconds(todayEnd.getMilliseconds() - 1);
  const todayCounts: Record<CheckinLevel, number> = { CET4: 0, CET6: 0 };
  for (const level of LEVELS) {
    todayCounts[level] = await prisma.answer.count({
      where: {
        userId: meId,
        createdAt: { gte: today, lte: todayEnd },
        question: { passage: { paper: { level } } },
      },
    });
  }

  const data: CheckinData = {
    today: todayCounts,
    checkedIn: {
      CET4: todayCounts.CET4 >= 5,
      CET6: todayCounts.CET6 >= 5,
    },
    monthByLevel: byLevelCount,
    monthDays,
    streak,
    calendar,
  };

  return ok(data);
});
