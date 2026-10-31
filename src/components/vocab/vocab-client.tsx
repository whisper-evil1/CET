"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { del, patchJson, postJson, swrFetcher } from "@/lib/api-client";
import type { VocabItem } from "@/lib/types";

type ReviewResponse = { id: string; reviewCount: number; status: string; justMastered: boolean };

/** 生词复习：卡片翻面 + 认识/不认识 + 认识三次自动移入已掌握 */
export function VocabClient() {
  const [tab, setTab] = useState<"learning" | "mastered">("learning");
  const { data, isLoading, error, mutate } = useSWR<VocabItem[]>(
    `/api/vocab?status=${tab}`,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const words = useMemo(() => data ?? [], [data]);

  // 一轮复习：队列 = 学习中的词随机打乱，开始时快照，避免中途列表变化打断节奏
  const [queue, setQueue] = useState<VocabItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ known: 0, unknown: 0, mastered: 0 });
  const [busy, setBusy] = useState(false);

  const startRound = useCallback(() => {
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    setQueue(shuffled);
    setIndex(0);
    setRevealed(false);
    setStats({ known: 0, unknown: 0, mastered: 0 });
  }, [words]);

  // 首次加载完成后自动开局
  useEffect(() => {
    if (tab === "learning" && data && queue === null) startRound();
  }, [tab, data, queue, startRound]);

  const current = queue?.[index];
  const finished = queue !== null && index >= queue.length;

  const judge = async (result: "known" | "unknown") => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const response = await postJson<ReviewResponse>(`/api/vocab/${current.id}/review`, { result });
      setStats((prev) => ({
        known: prev.known + (result === "known" ? 1 : 0),
        unknown: prev.unknown + (result === "unknown" ? 1 : 0),
        mastered: prev.mastered + (response.justMastered ? 1 : 0),
      }));
      setIndex((prev) => prev + 1);
      setRevealed(false);
    } finally {
      setBusy(false);
    }
  };

  const resetWord = async (id: string) => {
    await patchJson(`/api/vocab/${id}`, { action: "reset" });
    await mutate();
  };

  const removeWord = async (id: string) => {
    if (!window.confirm("从生词本移除这个单词？")) return;
    await del(`/api/vocab/${id}`);
    await mutate();
    setQueue(null);
  };

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-24">
      <div className="flex items-baseline justify-between border-b border-line py-6">
        <h1 className="font-serif text-[26px] text-ink">生词本</h1>
        <div className="flex gap-1">
          {(
            [
              { key: "learning", label: `学习中 ${tab === "learning" ? words.length : ""}` },
              { key: "mastered", label: `已掌握 ${tab === "mastered" ? words.length : ""}` },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
                setQueue(null);
              }}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                tab === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="py-16 text-center text-[13px] text-ink-mute">加载中…</p>}
      {error && (
        <p className="py-12 text-center text-[13px] text-wrong">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {/* 学习中：卡片复习 */}
      {!isLoading && !error && tab === "learning" && (
        <>
          {words.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-[13.5px] text-ink-soft">生词本还是空的</p>
              <p className="mt-2 text-[12.5px] text-ink-mute">
                刷题时点任意单词，选「加入生词本」，这里就会出现
              </p>
            </div>
          )}

          {words.length > 0 && queue && !finished && current && (
            <div>
              <div className="mt-6 flex items-center justify-between text-[11.5px] text-ink-mute">
                <span className="font-mono">
                  {index + 1} / {queue.length}
                </span>
                <span>
                  本轮：认识 {stats.known} · 不认识 {stats.unknown} · 掌握 {stats.mastered}
                </span>
              </div>

              <div className="mt-2 h-[3px] w-full bg-line-soft">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${(index / queue.length) * 100}%` }}
                />
              </div>

              {/* 卡片 */}
              <button
                type="button"
                onClick={() => setRevealed((prev) => !prev)}
                className="mt-8 min-h-[260px] w-full rounded-[14px] border border-line bg-surface px-8 py-10 text-left transition-shadow hover:shadow-[0_16px_40px_-28px_rgba(60,45,20,0.35)]"
              >
                <p className="text-center font-serif text-[34px] leading-tight tracking-tight text-ink">
                  {current.word}
                </p>
                {current.phonetic && (
                  <p className="mt-2 text-center font-mono text-[12px] text-ink-mute">
                    {current.phonetic}
                  </p>
                )}

                {revealed ? (
                  <div className="mt-7 space-y-2 border-t border-line-soft pt-5">
                    {current.definitions.length > 0 ? (
                      current.definitions.map((definition, i) => (
                        <p key={i} className="flex gap-2 text-[13.5px] leading-[1.7]">
                          {definition.pos && (
                            <span className="shrink-0 font-mono text-[11px] text-accent">
                              {definition.pos}
                            </span>
                          )}
                          <span className="text-ink-soft">{definition.zh}</span>
                        </p>
                      ))
                    ) : (
                      <p className="text-[12.5px] italic text-ink-mute">释义待补</p>
                    )}
                    {current.example && (
                      <p className="mt-3 font-serif text-[12.5px] leading-[1.7] text-ink-mute">
                        {current.example}
                      </p>
                    )}
                    <p className="pt-1 text-[11px] text-ink-mute">
                      已认识 {current.reviewCount}/3 次 · 点卡片可翻回
                    </p>
                  </div>
                ) : current.definitions.length > 0 ? (
                  <p className="mt-10 text-center text-[12px] text-ink-mute">点击卡片查看释义</p>
                ) : (
                  <p className="mt-10 text-center text-[12px] text-ink-mute">点击卡片查看详情</p>
                )}
              </button>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  disabled={!revealed || busy}
                  onClick={() => judge("unknown")}
                  className="flex-1 rounded-[10px] border border-line py-3 text-[13px] text-ink-soft transition-colors hover:border-wrong hover:text-wrong disabled:opacity-35"
                >
                  😵 不认识
                </button>
                <button
                  type="button"
                  disabled={!revealed || busy}
                  onClick={() => judge("known")}
                  className="flex-1 rounded-[10px] bg-correct py-3 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
                >
                  😊 认识
                </button>
              </div>
              {!revealed && (
                <p className="mt-2 text-center text-[11px] text-ink-mute">
                  先翻面看释义，再判断认不认识
                </p>
              )}

              <div className="mt-8 border-t border-line-soft pt-4">
                <p className="mb-2 text-[11px] tracking-[0.16em] text-ink-mute">本轮队列</p>
                <div className="flex flex-wrap gap-1.5">
                  {words.slice(0, 40).map((word) => (
                    <span
                      key={word.id}
                      className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-mute"
                    >
                      {word.word}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {words.length > 0 && queue && finished && (
            <div className="py-16 text-center">
              <p className="font-serif text-[24px] text-ink">这一轮结束了</p>
              <p className="mt-3 text-[13px] text-ink-soft">
                认识 {stats.known} 个 · 不认识 {stats.unknown} 个 · 本次新掌握 {stats.mastered} 个
              </p>
              <p className="mt-1 text-[12px] text-ink-mute">
                认识满 3 次的词已经自动移到「已掌握」，不再出现在复习队列里
              </p>
              <div className="mt-8 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setQueue(null);
                    setIndex(0);
                    setRevealed(false);
                    setStats({ known: 0, unknown: 0, mastered: 0 });
                    void mutate();
                  }}
                  className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper"
                >
                  再来一轮
                </button>
                <button
                  type="button"
                  onClick={() => setTab("mastered")}
                  className="rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft"
                >
                  看看已掌握
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 已掌握 */}
      {!isLoading && !error && tab === "mastered" && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {words.length === 0 && (
            <li className="py-20 text-center text-[13px] text-ink-mute">
              还没有已掌握的单词，认识满 3 次就会出现在这里
            </li>
          )}
          {words.map((word) => (
            <li key={word.id} className="flex items-start gap-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-serif text-[17px] text-ink">{word.word}</p>
                <p className="mt-1 text-[12.5px] text-ink-soft">
                  {word.definitions.length > 0
                    ? word.definitions.map((d) => d.zh).join("；")
                    : "释义待补"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-[11.5px]">
                <span className="font-mono text-ink-mute">{word.reviewCount}/3</span>
                <button
                  type="button"
                  onClick={() => void resetWord(word.id)}
                  className="text-ink-soft underline-offset-2 hover:text-accent hover:underline"
                >
                  移回生词本
                </button>
                <button
                  type="button"
                  onClick={() => void removeWord(word.id)}
                  className="text-ink-mute hover:text-wrong"
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
