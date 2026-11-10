/**
 * 单词优先级 + 间隔重复调度（纯函数，前后端共用，可直接单测）。
 *
 * 设计取舍说明（为什么不是纯 SM-2）：
 *   教科书式 SM-2 只回答「这个词下次什么时候出现」，不回答「今天这一轮先背哪个」。
 *   而备考场景里，时间有限、词表里有 1500 个词，真正的瓶颈是**排序**。
 *   所以这里拆成两层：
 *     1. computePriority —— 出题顺序：这个词此刻值不值得占用注意力；
 *     2. scheduleReview  —— 下次时间：按作答结果推 dueAt / interval / ease。
 *
 * 优先级因子全部来自可核验的数据，不拍脑袋：
 *   exam   考纲归属（cet4 > cet6 > 无标签）—— 决定「考不考」
 *   freq   COCA/BNC 词频排名 —— 决定「多常见」，数据来自 ecdict 的 frq/bnc 字段
 *   urgency 距上次复习过了多久、是否逾期 —— 决定「是不是快忘了」
 *   weakness 历史失误率与掌握度 —— 决定「这个人对这个词到底会不会」
 *   真题语境 来自阅读原文的单词，天然比词表词更值得记
 *
 * 语法底线：本文件会被打进浏览器包，禁用 ES2021+ 写法（无 .at / Object.hasOwn /
 * replaceAll / structuredClone / 正则后行断言），保证 Chrome 80 / Safari 13.1 能解析。
 */

export type SrsGrade = "again" | "hard" | "good" | "easy";

export type SrsState = {
  reviewCount: number;
  correctStreak: number;
  lapses: number;
  intervalDays: number;
  ease: number;
  status: string;
  dueAt: Date | string | null;
};

export type SrsResult = {
  reviewCount: number;
  correctStreak: number;
  lapses: number;
  intervalDays: number;
  ease: number;
  status: "learning" | "mastered";
  dueAt: Date;
  /** 认识满 3 次（沿用旧口径，已掌握提示用） */
  justMastered: boolean;
  /** 本次调度的人类可读间隔，如「3 天后」 */
  nextLabel: string;
};

export type PriorityInput = {
  word: string;
  /** COCA/BNC 综合词频排名，1 为最高频；null = 无数据 */
  examRank: number | null;
  /** 逗号分隔的考纲标签，如 "cet4,cet6" */
  examTags: string | null;
  source: string;
  hasContext: boolean;
  status: string;
  reviewCount: number;
  correctStreak: number;
  lapses: number;
  intervalDays: number;
  dueAt: Date | string | null;
  now?: number;
};

export type PriorityBreakdown = {
  score: number;
  exam: number;
  freq: number;
  urgency: number;
  weakness: number;
  context: number;
  /** 一句话说明为什么排在这里，直接给 UI 用 */
  reason: string;
};

/** 认识 3 次进「已掌握」——沿用旧口径，不改变老用户的词表分组 */
export const MASTER_THRESHOLD = 3;

const DAY_MS = 86400000;
const MINUTE_MS = 60000;

/** 逾期多少天算「完全紧迫」 */
const URGENCY_CAP_DAYS = 7;
/** 词频归一化的分母：排名 20000 之后视为极低频 */
const FREQ_POOL = 20000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** 词频排名 → 0..1 的常见度（排名越小越高）。用对数压缩，避免前 100 名吃掉全部差异 */
export function freqScore(rank: number | null): number {
  if (rank == null || rank <= 0) return 0.5; // 无词频数据，给中性值，不奖励也不惩罚
  const clamped = Math.min(rank, FREQ_POOL);
  return clamp(1 - Math.log10(clamped) / Math.log10(FREQ_POOL), 0, 1);
}

/** 考纲权重：四级词最该背，六级次之，无标签的词按个人收藏对待 */
export function examWeight(tags: string | null): number {
  const list = (tags ?? "").toLowerCase();
  const has4 = list.indexOf("cet4") >= 0;
  const has6 = list.indexOf("cet6") >= 0;
  if (has4 && has6) return 1;
  if (has4) return 0.95;
  if (has6) return 0.85;
  if (list.indexOf("ky") >= 0 || list.indexOf("gk") >= 0) return 0.7;
  return 0.55;
}

/** 记忆紧迫度：未学过 = 1；逾期越多越高；刚背过则接近 0 */
export function urgencyScore(
  dueAt: Date | string | null,
  intervalDays: number,
  reviewCount: number,
  now: number,
): number {
  if (reviewCount <= 0) return 1;
  const due = toTime(dueAt);
  if (due == null) return 1;
  const overdueDays = (now - due) / DAY_MS;
  if (overdueDays <= 0) {
    // 还没到期：按「离到期还有多久 / 当前间隔」衰减，避免刚背完的词立刻重排到最前
    const span = Math.max(intervalDays, 1);
    return clamp(1 + overdueDays / span, 0, 1) * 0.15;
  }
  return clamp(0.35 + overdueDays / URGENCY_CAP_DAYS, 0, 1);
}

/** 薄弱度：失误多、掌握次数少 → 高 */
export function weaknessScore(
  reviewCount: number,
  correctStreak: number,
  lapses: number,
  status: string,
): number {
  const attempts = reviewCount + lapses;
  const lapseRate = attempts > 0 ? lapses / attempts : 0.5;
  const streakFactor = 1 - clamp(correctStreak / MASTER_THRESHOLD, 0, 1);
  const masteredPenalty = status === "mastered" ? 0.35 : 1;
  return clamp((0.6 * lapseRate + 0.4 * streakFactor) * masteredPenalty, 0, 1);
}

/**
 * 优先级 0..100。四项加权，再叠加真题语境加成。
 * 权重是刻意选的：考纲(0.30) 与词频(0.28) 决定「该不该背」，
 * 紧迫(0.27) 与薄弱(0.15) 决定「此刻该不该背」。
 */
export function computePriority(input: PriorityInput): PriorityBreakdown {
  const now = input.now ?? Date.now();
  const exam = examWeight(input.examTags);
  const freq = freqScore(input.examRank);
  const urgency = urgencyScore(input.dueAt, input.intervalDays, input.reviewCount, now);
  const weakness = weaknessScore(input.reviewCount, input.correctStreak, input.lapses, input.status);
  const context = input.hasContext ? 1 : 0;

  const raw = 0.3 * exam + 0.28 * freq + 0.27 * urgency + 0.15 * weakness;
  const masteredScale = input.status === "mastered" ? 0.45 : 1;
  const score = clamp(raw * 100 * masteredScale + context * 3, 0, 100);

  return {
    score: Math.round(score * 10) / 10,
    exam,
    freq,
    urgency,
    weakness,
    context,
    reason: buildReason(input, { exam, freq, urgency, weakness, context }),
  };
}

function buildReason(
  input: PriorityInput,
  parts: { exam: number; freq: number; urgency: number; weakness: number; context: number },
): string {
  const bits: string[] = [];

  const tags = (input.examTags ?? "").toLowerCase();
  if (tags.indexOf("cet4") >= 0) bits.push("四级考纲词");
  else if (tags.indexOf("cet6") >= 0) bits.push("六级考纲词");

  if (input.examRank != null && input.examRank > 0) {
    bits.push(`词频第 ${input.examRank} 位`);
  }

  if (input.reviewCount <= 0) {
    bits.push("新词");
  } else if (parts.urgency >= 0.85) {
    bits.push("已到复习期");
  } else if (parts.urgency <= 0.2) {
    bits.push("刚背过");
  }

  if (input.lapses >= 2) bits.push(`错过 ${input.lapses} 次`);
  if (input.hasContext) bits.push("真题语境");

  return bits.join(" · ");
}

/**
 * 调度：给定当前状态与作答结果，算出下一次该在什么时候出现。
 *
 * 间隔序列是刻意排的「1 → 2 → 4 → 7 → 15 → 30 天」：
 * 前几天密集打底，之后指数拉开，符合遗忘曲线在前段陡、后段缓的形状。
 * ease 每答对一次缓慢上调、答错一次立刻下调，用作后续间隔的乘子。
 */
export function scheduleReview(state: SrsState, grade: SrsGrade, now = Date.now()): SrsResult {
  const prevEase = clamp(state.ease > 0 ? state.ease : 2.5, 1.3, 3.2);
  const prevInterval = Math.max(0, state.intervalDays || 0);

  let ease = prevEase;
  let interval = prevInterval;
  let lapses = state.lapses || 0;
  let nextCount = state.reviewCount || 0;
  let nextStreak = state.correctStreak || 0;
  let dueAt: number;

  if (grade === "again") {
    // 答错：立刻降难度、记一次失误，10 分钟后再来一遍（当轮就能重刷到）
    ease = Math.max(1.3, prevEase - 0.2);
    lapses += 1;
    nextStreak = 0;
    interval = 0;
    dueAt = now + 10 * MINUTE_MS;
  } else {
    nextCount += 1;

    if (grade === "hard") {
      ease = Math.max(1.3, prevEase - 0.15);
      nextStreak = 0;
      interval = Math.max(1, Math.round(prevInterval * 1.2));
    } else if (grade === "easy") {
      ease = Math.min(3.2, prevEase + 0.15);
      nextStreak += 1;
      interval = prevInterval <= 0 ? 2 : Math.round(prevInterval * prevEase * 1.3);
    } else {
      nextStreak += 1;
      interval = nextInterval(prevInterval, prevEase);
    }

    interval = clamp(interval, 1, 365);
    dueAt = now + interval * DAY_MS;
  }

  const status: "learning" | "mastered" =
    nextCount >= MASTER_THRESHOLD && interval >= 1 ? "mastered" : "learning";

  return {
    reviewCount: nextCount,
    correctStreak: nextStreak,
    lapses,
    intervalDays: interval,
    ease: Math.round(ease * 100) / 100,
    status,
    dueAt: new Date(dueAt),
    justMastered: status === "mastered" && state.status !== "mastered" && grade !== "again",
    nextLabel: describeInterval(dueAt - now),
  };
}

/** 学习阶段的固定间隔序列，超出后按 ease 指数增长 */
export function nextInterval(prevInterval: number, ease: number): number {
  if (prevInterval <= 0) return 1;
  if (prevInterval < 2) return 2;
  if (prevInterval < 4) return 4;
  if (prevInterval < 7) return 7;
  if (prevInterval < 15) return 15;
  if (prevInterval < 30) return 30;
  return clamp(Math.round(prevInterval * clamp(ease, 1.3, 3.2)), 30, 365);
}

/** 毫秒差 → 「10 分钟后」「3 天后」「今天」 */
export function describeInterval(deltaMs: number): string {
  if (deltaMs <= 0) return "今天";
  const days = deltaMs / DAY_MS;
  if (days < 1) {
    const minutes = Math.max(1, Math.round(deltaMs / MINUTE_MS));
    if (minutes < 60) return `${minutes} 分钟后`;
    return `${Math.round(minutes / 60)} 小时后`;
  }
  return `${Math.round(days)} 天后`;
}

/** 到期状态，列表里直接展示 */
export function describeDue(
  dueAt: Date | string | null,
  reviewCount: number,
  now = Date.now(),
): { label: string; overdue: boolean } {
  if (reviewCount <= 0) return { label: "新词", overdue: false };
  const due = toTime(dueAt);
  if (due == null) return { label: "待复习", overdue: true };
  const delta = due - now;
  if (delta <= 0) {
    const overdueDays = Math.floor(-delta / DAY_MS);
    if (overdueDays <= 0) return { label: "今天该复习", overdue: true };
    return { label: `逾期 ${overdueDays} 天`, overdue: true };
  }
  return { label: describeInterval(delta), overdue: false };
}

/** 稳定的伪随机抖动：同一个词每次算出的值一样，避免刷新后顺序乱跳 */
function stableJitter(word: string): number {
  let hash = 2166136261;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // 取低 8 位映射到 0..1
  return ((hash >>> 0) % 256) / 256;
}

export type QueueOptions = {
  limit?: number;
  /** 是否把已掌握但已到复习期的词也排进来（默认否，保持「已掌握不再打扰」的旧体验） */
  includeMastered?: boolean;
  now?: number;
};

export type QueuedWord = {
  word: string;
  score: number;
  reason: string;
  dueLabel: string;
  overdue: boolean;
};

/**
 * 今日队列排序：分数降序，同分用词形抖动打散。
 *
 * 抖动只做**同分时的次序**，不参与算分——否则页面上会出现
 * 「前一行的分数比后一行低」这种一眼就看得出的错序。
 * 抖动值由单词本身算出，所以同一天内反复进页面顺序不变。
 */
export function rankQueue<T extends PriorityInput>(items: T[], options: QueueOptions = {}) {
  const now = options.now ?? Date.now();
  const limit = options.limit && options.limit > 0 ? options.limit : items.length;
  const includeMastered = options.includeMastered === true;

  const scored = items
    .filter((item) => includeMastered || item.status !== "mastered")
    .filter((item) => {
      // 未到期的词不进队列；未学过的词必进
      if (item.reviewCount <= 0) return true;
      const due = toTime(item.dueAt);
      return due == null || due <= now;
    })
    .map((item) => {
      const breakdown = computePriority({ ...item, now });
      const due = describeDue(item.dueAt, item.reviewCount, now);
      return {
        item,
        score: breakdown.score,
        jitter: stableJitter(item.word),
        reason: breakdown.reason,
        dueLabel: due.label,
        overdue: due.overdue,
      };
    });

  scored.sort(
    (a, b) => b.score - a.score || b.jitter - a.jitter || (a.item.word < b.item.word ? -1 : 1),
  );

  return scored.slice(0, limit);
}
