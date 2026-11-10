"use client";

/**
 * 闯关三关共用的游戏化零件。
 *
 * 为什么抽出来：背单词和阅读原本各写了一套「第几题 / 倒计时 / 分数」，
 * 风格不一致，改一处忘一处。这里统一成一条 HUD + 一套结算语汇
 * （命值、连击、星级、关卡点阵），三个游戏看起来才像同一个游戏里的三关。
 *
 * 兼容性约束：只用 SVG 与 flex，不引 canvas、不引图表库，
 * 进度环用 stroke-dasharray（Chrome 80 / Safari 13 都认），不用 conic-gradient。
 */

export function Hearts({ left, total = 3 }: { left: number; total?: number }) {
  return (
    <span className="flex items-center gap-[3px]" aria-label={`剩余 ${left} 条命`}>
      {Array.from({ length: total }).map((_, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          className="h-[13px] w-[13px]"
          aria-hidden="true"
          fill={i < left ? "var(--game-heart, var(--color-accent))" : "none"}
          stroke={i < left ? "var(--game-heart, var(--color-accent))" : "var(--color-line)"}
          strokeWidth="2"
        >
          <path d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.65 12 20 12 20z" />
        </svg>
      ))}
    </span>
  );
}

export function ComboBadge({ combo }: { combo: number }) {
  if (combo < 2) return null;
  return (
    <span className="pop inline-flex items-center gap-1 rounded-full bg-tint-amber px-2 py-[3px] text-[11px] font-medium text-amber-ink">
      连击 ×{combo}
    </span>
  );
}

export function StarRow({ stars, size = 20 }: { stars: number; size?: number }) {
  const filled = Math.max(0, Math.min(3, stars));
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`${filled} 星`}>
      {[0, 1, 2].map((i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          style={{ width: size, height: size }}
          fill={i < filled ? "var(--color-accent)" : "none"}
          stroke={i < filled ? "var(--color-accent)" : "var(--color-line)"}
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.5l-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5z" />
        </svg>
      ))}
    </span>
  );
}

/** 每题倒计时环：秒数在圈里，颜色随剩余时间从墨色转朱砂 */
export function TimerRing({ left, total, seconds }: { left: number; total: number; seconds?: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const ratio = Math.max(0, Math.min(1, total > 0 ? left / total : 0));
  const low = left <= Math.max(3, Math.round(total * 0.25));
  return (
    <span className="relative inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={low ? "var(--color-accent)" : "var(--color-ink-soft)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <span className={`relative font-mono text-[11px] ${low ? "text-accent" : "text-ink-mute"}`}>
        {seconds ? `${left}s` : left}
      </span>
    </span>
  );
}

export type DotState = "done-right" | "done-wrong" | "current" | "todo";

/**
 * 关卡点阵：一眼看出这一关走到哪、前面错了哪些题。
 *
 * 点阵只靠颜色表意，读屏软件读不出来，所以额外挂一个
 * 「已完成 x / y 题」的 aria-label —— 这是它唯一的文本等价物。
 */
export function LevelDots({ states }: { states: DotState[] }) {
  const done = states.filter((s) => s === "done-right" || s === "done-wrong").length;
  return (
    <span
      className="flex items-center gap-[5px]"
      role="img"
      aria-label={`已完成 ${done} / ${states.length} 题`}
    >
      {states.map((s, i) => (
        <span
          key={i}
          className={`h-[6px] w-[6px] rounded-full ${
            s === "done-right"
              ? "bg-correct"
              : s === "done-wrong"
                ? "bg-accent"
                : s === "current"
                  ? "bg-ink"
                  : "bg-line"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * 顶部 HUD：左边命值 + 连击，中间进度，右边计时环。
 * 三个游戏都套这一条，位置和顺序固定 —— 换游戏不用重新找眼睛的落点。
 */
export function GameHud({
  hearts,
  maxHearts = 3,
  combo,
  score,
  dots,
  timer,
}: {
  hearts: number;
  maxHearts?: number;
  combo: number;
  score?: number;
  dots: DotState[];
  timer?: { left: number; total: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface/70 px-4 py-2.5 sm:px-6">
      <Hearts left={hearts} total={maxHearts} />
      <ComboBadge combo={combo} />
      {typeof score === "number" && (
        <span className="font-mono text-[11.5px] text-ink-mute">{score} 分</span>
      )}
      <span className="ml-auto flex items-center gap-3">
        <LevelDots states={dots} />
        {timer && <TimerRing left={timer.left} total={timer.total} />}
      </span>
    </div>
  );
}
