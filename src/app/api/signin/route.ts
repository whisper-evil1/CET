import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { addDays, dateKey, startOfDay } from "@/lib/period";
import { SIGN_IN_EGGS, eggIndexForDay, type SignInEgg } from "@/lib/signin-eggs";

/**
 * 每日签到。
 *
 * 与 /api/checkin 的分工：那边是「做题 ≥5 道」的自动统计，供排行榜使用；
 * 这里是用户主动按下的签到，只服务进站弹窗、连续天数与每日彩蛋。
 * 两张表互不写入，排行榜口径不受影响。
 */

export const dynamic = "force-dynamic";

export type SignInWeek = {
  day: string;
  /** 周几，单字：一二三四五六日 */
  label: string;
  signed: boolean;
  isToday: boolean;
};

export type SignInState = {
  signedToday: boolean;
  /** 连续签到天数：今天签了从今天数，没签则保留到昨天为止的连续 */
  streak: number;
  totalDays: number;
  day: string;
  week: SignInWeek[];
  egg: SignInEgg & { index: number };
};

const WEEK_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

async function snapshot(userId: string): Promise<SignInState> {
  const today = startOfDay(new Date());
  const todayKey = dateKey(today);

  // 一次取最近 60 天足够算 streak 与近 7 天；总量单独 count，避免把全表拉进内存
  const rows = await prisma.signIn.findMany({
    where: { userId },
    orderBy: { day: "desc" },
    take: 60,
    select: { day: true, egg: true },
  });
  const days = new Set(rows.map((r) => r.day));
  const totalDays = await prisma.signIn.count({ where: { userId } });

  let cursor = days.has(todayKey) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  const week: SignInWeek[] = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6);
    const key = dateKey(d);
    return {
      day: key,
      label: WEEK_LABEL[d.getDay()] ?? "",
      signed: days.has(key),
      isToday: key === todayKey,
    };
  });

  const todayRow = rows.find((r) => r.day === todayKey);
  const index = todayRow ? todayRow.egg : eggIndexForDay(todayKey);
  const egg = SIGN_IN_EGGS[index] ?? SIGN_IN_EGGS[0];

  return {
    signedToday: days.has(todayKey),
    streak,
    totalDays,
    day: todayKey,
    week,
    egg: { index, ...egg },
  };
}

/** GET /api/signin —— 今日是否已签、连续天数、近 7 天、今日彩蛋 */
export const GET = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();
  return ok(await snapshot(userId));
});

/** POST /api/signin —— 签一次；重复调用不会重复记天数 */
export const POST = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const day = dateKey(new Date());
  let isNew = false;
  try {
    await prisma.signIn.create({ data: { userId, day, egg: eggIndexForDay(day) } });
    isNew = true;
  } catch {
    // @@unique([userId, day]) 命中：今天已经签过，按成功返回当前状态
  }

  const state = await snapshot(userId);
  return ok({ ...state, isNew }, isNew ? "签到成功" : "今天已经签过了");
});
