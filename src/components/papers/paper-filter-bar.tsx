"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Props = {
  /** 可选的年份（升序），来自数据库，避免写死 */
  years: number[];
  total: number;
  shown: number;
};

/**
 * 试卷库筛选条：年份 + 关键词 + 只看完整卷。
 * 状态全部落在 URL 上（?level=&year=&q=&full=1），这样筛选结果能直接分享、
 * 刷新和后退都不会丢；服务端读参数过滤，首屏就有结果，不闪。
 */
export function PaperFilterBar({ years, total, shown }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");

  const activeYear = params.get("year");
  const onlyFull = params.get("full") === "1";

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `/?${qs}#papers` : "/#papers", { scroll: false }));
  };

  // 输入 350ms 后再改 URL，避免每敲一个字母就请求一次
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (keyword === current) return;
    const timer = window.setTimeout(() => push({ q: keyword.trim() || null }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[12px] transition-colors ${
      active ? "bg-ink text-paper" : "border border-line text-ink-soft hover:border-accent hover:text-accent"
    }`;

  return (
    <div className="mb-4 rounded-[10px] border border-line bg-paper-deep/40 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] tracking-[0.1em] text-ink-mute">年份</span>
          <button type="button" onClick={() => push({ year: null })} className={chip(!activeYear)}>
            全部
          </button>
          {years.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => push({ year: activeYear === String(year) ? null : String(year) })}
              className={chip(activeYear === String(year))}
            >
              {year}
            </button>
          ))}
        </div>

        <label className="ml-auto flex min-w-[190px] flex-1 items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 sm:max-w-[280px]">
          <span className="text-[12px] text-ink-mute">搜</span>
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="年份 / 月份 / 四级 / 六级"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-mute/70"
            aria-label="搜索试卷"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="text-[12px] text-ink-mute hover:text-ink"
              aria-label="清空搜索"
            >
              ✕
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => push({ full: onlyFull ? null : "1" })}
          className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
            onlyFull ? "bg-accent text-white" : "border border-line text-ink-soft hover:border-accent"
          }`}
          aria-pressed={onlyFull}
        >
          只看完整卷
        </button>
      </div>

      <p className="mt-2 text-[11px] text-ink-mute">
        {pending ? "筛选中…" : `共 ${total} 套 · 当前 ${shown} 套`}
        {onlyFull && " · 完整卷 = 写作 + 听力 25 题 + 阅读 30 题 + 翻译"}
      </p>
    </div>
  );
}
