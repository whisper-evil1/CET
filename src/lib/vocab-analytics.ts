import { prisma } from "./prisma";

/**
 * 单词学习分析的数据装配。
 *
 * 原则：每一格数字都能追到一条数据库记录，不编造、不用假数据占位。
 *   - 快照类（掌握度、到期待复习、词频覆盖、易忘词）来自 VocabWord 现有字段，登录即有；
 *   - 趋势类（每日复习量、间隔正确率、连续天数）来自 VocabReview 流水，
 *     历史复习没流水，所以这类图会明确显示「从今天开始记录」，而不是画一条假曲线。
 */

export type TrendPoint = { key: string; label: string; total: number; correct: number };
export type ForecastPoint = { key: string; label: string; count: number };
export type RetentionBucket = { label: string; total: number; correct: number };
export type CoverageRow = { label: string; hint: string; total: number; reviewed: number };
export type HardWord = { id: string; word: string; lapses: number; reviewCount: number; status: string };

export type VocabAnalytics = {
  totals: {
    total: number;
    mastered: number;
    learning: number;
    fresh: number;
    dueToday: number;
    reviewedToday: number;
    streakDays: number;
    accuracy7d: number | null;
    logsTotal: number;
  };
  trend: TrendPoint[];
  forecast: ForecastPoint[];
  retention: RetentionBucket[];
  coverage: CoverageRow[];
  hardest: HardWord[];
  bySource: { source: string; label: string; count: number }[];
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${m}-${day}`;
}

const SOURCE_LABEL: Record<string, string> = {
  lookup: "刷题点词",
  wordbook: "词书导入",
  import: "外部导入",
};

/** 保持曲线的间隔桶：SM-2 的间隔基本落在这几档上 */
const RETENTION_BUCKETS: { min: number; max: number; label: string }[] = [
  { min: 0, max: 0, label: "首次" },
  { min: 1, max: 2, label: "1–2 天" },
  { min: 3, max: 7, label: "3–7 天" },
  { min: 8, max: 21, label: "8–21 天" },
  { min: 22, max: Number.MAX_SAFE_INTEGER, label: "22 天+" },
];

export async function loadVocabAnalytics(userId: string): Promise<VocabAnalytics> {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const since14 = new Date(today.getTime() - 13 * DAY);

  const [words, logs] = await Promise.all([
    prisma.vocabWord.findMany({
      where: { userId },
      select: {
        id: true,
        word: true,
        status: true,
        reviewCount: true,
        correctStreak: true,
        lapses: true,
        intervalDays: true,
        dueAt: true,
        examTags: true,
        examRank: true,
        source: true,
      },
    }),
    prisma.vocabReview.findMany({
      where: { userId, createdAt: { gte: since14 } },
      select: { createdAt: true, isCorrect: true, intervalDays: true, reviewCount: true },
      orderBy: { createdAt: "asc" },
      take: 20000,
    }),
  ]);

  /* ---------- 快照 ---------- */
  let mastered = 0;
  let fresh = 0;
  let dueToday = 0;
  const coverage = [
    { label: "CET4 前 1000 高频", hint: "rank ≤ 1000", total: 0, reviewed: 0 },
    { label: "CET4 前 2000", hint: "1000 < rank ≤ 2000", total: 0, reviewed: 0 },
    { label: "CET6 / 大纲词", hint: "rank > 2000 或仅 CET6 标签", total: 0, reviewed: 0 },
    { label: "词书外（点词/导入）", hint: "无词频位次", total: 0, reviewed: 0 },
  ];
  const bySourceMap = new Map<string, number>();

  for (const w of words) {
    if (w.status === "mastered") mastered++;
    if (w.reviewCount === 0) fresh++;
    if (w.status !== "mastered" && (!w.dueAt || w.dueAt <= now)) dueToday++;

    bySourceMap.set(w.source, (bySourceMap.get(w.source) ?? 0) + 1);

    const tag = w.examTags ?? "";
    let idx = 3;
    if (w.examRank != null) {
      if (w.examRank <= 1000) idx = 0;
      else if (w.examRank <= 2000) idx = 1;
      else idx = 2;
    } else if (/cet6/i.test(tag)) {
      idx = 2;
    }
    coverage[idx].total++;
    if (w.reviewCount > 0) coverage[idx].reviewed++;
  }

  /* ---------- 趋势（近 14 天，按天补零） ---------- */
  const trendMap = new Map<string, { total: number; correct: number }>();
  for (let i = 0; i < 14; i++) {
    trendMap.set(dayKey(new Date(since14.getTime() + i * DAY)), { total: 0, correct: 0 });
  }
  let reviewedToday = 0;
  let accuracy7dCorrect = 0;
  let accuracy7dTotal = 0;
  const activeDays = new Set<string>();
  const retentionMap = new Map<string, { total: number; correct: number }>();
  for (const b of RETENTION_BUCKETS) retentionMap.set(b.label, { total: 0, correct: 0 });

  const since7 = new Date(today.getTime() - 6 * DAY);
  for (const log of logs) {
    const key = dayKey(log.createdAt);
    const bucket = trendMap.get(key);
    if (bucket) {
      bucket.total++;
      if (log.isCorrect) bucket.correct++;
    }
    activeDays.add(startOfDay(log.createdAt).toISOString());
    if (log.createdAt >= today && log.createdAt < tomorrow) reviewedToday++;
    if (log.createdAt >= since7) {
      accuracy7dTotal++;
      if (log.isCorrect) accuracy7dCorrect++;
    }
    const rb = RETENTION_BUCKETS.find((b) => log.intervalDays >= b.min && log.intervalDays <= b.max);
    if (rb) {
      const cell = retentionMap.get(rb.label)!;
      cell.total++;
      if (log.isCorrect) cell.correct++;
    }
  }

  const trend: TrendPoint[] = [...trendMap.entries()].map(([key, v]) => ({
    key,
    label: key,
    total: v.total,
    correct: v.correct,
  }));

  /* ---------- 连续天数：从今天往回数，断一天就停 ---------- */
  let streakDays = 0;
  for (let i = 0; i < 400; i++) {
    const key = startOfDay(new Date(today.getTime() - i * DAY)).toISOString();
    // 今天还没学不算断签，从昨天开始数
    if (activeDays.has(key)) streakDays++;
    else if (i === 0) continue;
    else break;
  }

  /* ---------- 未来 7 天到期预测 ---------- */
  const forecast: ForecastPoint[] = [];
  for (let i = 0; i < 7; i++) {
    const from = new Date(today.getTime() + i * DAY);
    const to = new Date(from.getTime() + DAY);
    let count = 0;
    for (const w of words) {
      if (w.status === "mastered") continue;
      const due = w.dueAt ? w.dueAt.getTime() : 0;
      if (i === 0) {
        // 第 0 天含「已逾期」和「无到期时间」两类
        if (!w.dueAt || due < to.getTime()) count++;
      } else if (due >= from.getTime() && due < to.getTime()) {
        count++;
      }
    }
    forecast.push({
      key: `d${i}`,
      label: i === 0 ? "今天" : `+${i}`,
      count,
    });
  }

  const hardest: HardWord[] = words
    .filter((w) => w.lapses > 0 || w.reviewCount >= 3)
    .sort((a, b) => b.lapses - a.lapses || b.reviewCount - a.reviewCount)
    .slice(0, 6)
    .map((w) => ({ id: w.id, word: w.word, lapses: w.lapses, reviewCount: w.reviewCount, status: w.status }));

  return {
    totals: {
      total: words.length,
      mastered,
      learning: words.length - mastered,
      fresh,
      dueToday,
      reviewedToday,
      streakDays,
      accuracy7d: accuracy7dTotal ? Math.round((accuracy7dCorrect / accuracy7dTotal) * 100) : null,
      logsTotal: logs.length,
    },
    trend,
    forecast,
    retention: RETENTION_BUCKETS.map((b) => {
      const cell = retentionMap.get(b.label)!;
      return { label: b.label, total: cell.total, correct: cell.correct };
    }),
    coverage,
    hardest,
    bySource: [...bySourceMap.entries()]
      .map(([source, count]) => ({ source, label: SOURCE_LABEL[source] ?? source, count }))
      .sort((a, b) => b.count - a.count),
  };
}
