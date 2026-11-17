/**
 * 学习数据的图形组件。
 *
 * 为什么不用图表库：项目要兼容到 Chrome 80 / Safari 13，且全站零图片、零第三方 JS，
 * 引一个 60KB 的图表库只为画几个柱子和环并不划算。这里用 SVG + flex 手写，
 * 好处是服务端直出、无 JS 也能看、手机上不会因为 canvas 缩放糊掉。
 */

import type { CoverageRow, ForecastPoint, RetentionBucket, TrendPoint } from "@/lib/vocab-analytics";

/* ---------------- 掌握度环形 ---------------- */

export function MasteryDonut({
  mastered,
  learning,
  fresh,
}: {
  mastered: number;
  learning: number;
  fresh: number;
}) {
  // 三段必须先算好再求和：fresh 是 learning 的子集，直接相加会把总数算大，
  // 环上每一段的占比随之缩水（上一版就是这样少了将近一半）。
  const segs = [
    { value: mastered, color: "var(--color-correct)", label: "已掌握" },
    { value: Math.max(learning - fresh, 0), color: "var(--color-accent)", label: "学习中" },
    { value: fresh, color: "var(--color-line)", label: "未开始" },
  ];
  const total = Math.max(
    segs.reduce((sum, s) => sum + s.value, 0),
    1,
  );
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const pct = Math.round((mastered / total) * 100);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[136px] w-[136px] shrink-0">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth="12" />
          {segs.map((s) => {
            const len = (s.value / total) * c;
            const dash = `${len} ${c - len}`;
            const offset = -acc;
            acc += len;
            if (s.value <= 0) return null;
            return (
              <circle
                key={s.label}
                cx="64"
                cy="64"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="12"
                strokeDasharray={dash}
                strokeDashoffset={offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-[26px] leading-none text-ink">{pct}%</span>
          <span className="mt-1 text-[10.5px] text-ink-mute">已掌握</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2 text-[12.5px]">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-ink-soft">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 font-mono text-[12px] text-ink-mute">{Math.max(s.value, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- 近 14 天复习量（正确/错误堆叠柱） ---------------- */

export function ReviewTrend({ trend }: { trend: TrendPoint[] }) {
  const max = Math.max(...trend.map((t) => t.total), 1);
  const hasData = trend.some((t) => t.total > 0);
  // 柱高用固定像素而不是百分比：百分比要一路有确定高度的祖先才算得出来，
  // 一旦某一层是 auto 就会塌成 0 —— 上一版就是「图在、柱子没了」。
  const CHART_H = 104;

  return (
    <div className="w-full">
      <div className="flex items-end gap-[3px]" style={{ height: CHART_H }}>
        {trend.map((t, i) => {
          const h = t.total ? Math.max(Math.round((t.total / max) * CHART_H), 4) : 2;
          const correctH = t.total ? Math.max(Math.round((t.correct / t.total) * h), t.total === t.correct ? h : 0) : 0;
          // 标签太密会挤成一团：14 天只显示首 / 中 / 末
          const showLabel = i === 0 || i === trend.length - 1 || i === 6;
          return (
            <div key={t.key} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: CHART_H }}>
              <div className="w-full overflow-hidden rounded-t-[3px]" style={{ height: h }}>
                {t.total > 0 ? (
                  <>
                    <div style={{ height: h - correctH, background: "var(--color-accent-soft)" }} />
                    <div style={{ height: correctH, background: "var(--color-correct)" }} />
                  </>
                ) : (
                  <div style={{ height: h, background: "var(--color-line-soft)" }} />
                )}
              </div>
              <span className="mt-1 h-3 text-[9px] leading-3 text-ink-mute">{showLabel ? t.label : "\u00a0"}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-mute">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: "var(--color-correct)" }} />
          记得住
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm" style={{ background: "var(--color-accent-soft)" }} />
          忘了
        </span>
        <span className="ml-auto font-mono">峰值 {max} 次/天</span>
      </div>
      {!hasData && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-mute">
          这份数据从今天开始记录：做过一关词、或复习过一次生词，柱子就会长出来。
        </p>
      )}
    </div>
  );
}

/* ---------------- 未来 7 天到期预测 ---------------- */

export function ForecastBars({ forecast }: { forecast: ForecastPoint[] }) {
  const max = Math.max(...forecast.map((f) => f.count), 1);
  const CHART_H = 96;
  return (
    <div className="flex w-full items-end gap-2" style={{ height: CHART_H + 20 }}>
      {forecast.map((f) => {
        const h = f.count ? Math.max(Math.round((f.count / max) * CHART_H), 4) : 2;
        return (
          <div key={f.key} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: CHART_H + 20 }}>
            <span className="mb-1 font-mono text-[10px] leading-3 text-ink-mute">{f.count || "\u00a0"}</span>
            <div
              className="w-full rounded-t-[3px]"
              style={{
                height: h,
                background: f.count ? "var(--color-accent)" : "var(--color-line-soft)",
                opacity: f.count ? 0.82 : 1,
              }}
            />
            <span className="mt-1 h-3 text-[10px] leading-3 text-ink-mute">{f.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- 记忆保持（按间隔分组的正确率） ---------------- */

export function RetentionBars({ retention }: { retention: RetentionBucket[] }) {
  const empty = retention.every((b) => b.total === 0);
  return (
    <div className="w-full">
    <ul className="space-y-2.5">
      {retention.map((b) => {
        const pct = b.total ? Math.round((b.correct / b.total) * 100) : null;
        return (
          <li key={b.label} className="flex items-center gap-3">
            <span className="w-[54px] shrink-0 text-[11.5px] text-ink-mute">{b.label}</span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
              <span
                className="block h-full rounded-full"
                style={{
                  // 0% 也要留一丝可见宽度，否则「有过复习但全错」看起来像没数据
                  width: pct == null ? "0%" : pct === 0 ? "3px" : `${pct}%`,
                  background: pct == null ? "transparent" : pct >= 80 ? "var(--color-correct)" : pct >= 55 ? "var(--color-amber-ink)" : "var(--color-accent)",
                }}
              />
            </span>
            <span className="w-[64px] shrink-0 text-right font-mono text-[11.5px] text-ink-soft">
              {pct == null ? "—" : `${pct}%`}
              <span className="ml-1 text-[10px] text-ink-mute">{b.total ? `/${b.total}` : ""}</span>
            </span>
          </li>
        );
      })}
    </ul>
      {empty && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-mute">
          还没有跨间隔的复习记录。等同一个词在 1 天、2 天、7 天后各复习一次，这里就能看出它到底记没记住。
        </p>
      )}
    </div>
  );
}

/* ---------------- 词频 / 考纲覆盖 ---------------- */

export function CoverageBars({ coverage }: { coverage: CoverageRow[] }) {
  return (
    <ul className="space-y-3">
      {coverage.map((row) => {
        const pct = row.total ? Math.round((row.reviewed / row.total) * 100) : 0;
        return (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12.5px] text-ink-soft">{row.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-ink-mute">
                {row.reviewed}/{row.total}
              </span>
            </div>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line-soft">
              <span
                className="block h-full rounded-full"
                style={{ width: `${pct}%`, background: "var(--color-jade-ink)" }}
              />
            </span>
            <span className="mt-1 block text-[10.5px] text-ink-mute">{row.hint}</span>
          </li>
        );
      })}
    </ul>
  );
}
