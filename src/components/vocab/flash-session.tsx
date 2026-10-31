"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { postJson } from "@/lib/api-client";
import type { VocabItem } from "@/lib/types";

type Props = {
  words: VocabItem[];
  onExit: () => void;
};

type ReviewResponse = {
  id: string;
  reviewCount: number;
  status: string;
  justMastered: boolean;
};

type Flash = "none" | "known" | "unknown";

/**
 * 刷词模式：
 * - 卡片正面直接显示单词+音标+释义+例句（全部可见，不用翻面）
 * - 认识/不认识按钮常驻可点，一进来就能点
 * - 认识→闪绿色 + reviewCount+1 + 0.3s 后切下一个；3 次移入已掌握
 * - 不认识→闪红色 + 词进队尾重刷
 * - 可选"隐藏释义"开关（默认关闭）
 */
export function FlashSession({ words, onExit }: Props) {
  const [queue, setQueue] = useState<VocabItem[]>([]);
  const [index, setIndex] = useState(0);
  const [flash, setFlash] = useState<Flash>("none");
  const [busy, setBusy] = useState(false);
  const [hideDefs, setHideDefs] = useState(false);
  const [stats, setStats] = useState({ known: 0, unknown: 0, mastered: 0 });

  // 初始化队列（随机打乱）
  useEffect(() => {
    setQueue([...words].sort(() => Math.random() - 0.5));
    setIndex(0);
  }, [words]);

  const current = queue[index];
  const finished = index >= queue.length;

  const speak = useCallback((word: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, []);

  // 进入新词时自动朗读
  useEffect(() => {
    if (current) speak(current.word);
  }, [current, speak]);

  const judge = async (result: "known" | "unknown") => {
    if (!current || busy || flash !== "none") return;
    setBusy(true);
    setFlash(result);

    try {
      if (result === "known") {
        const res = await postJson<ReviewResponse>(`/api/vocab/${current.id}/review`, { result });
        setStats((prev) => ({
          known: prev.known + 1,
          unknown: prev.unknown,
          mastered: prev.mastered + (res.justMastered ? 1 : 0),
        }));
        // 0.3s 后切下一个
        setTimeout(() => {
          setIndex((prev) => prev + 1);
          setFlash("none");
        }, 300);
      } else {
        setStats((prev) => ({ ...prev, unknown: prev.unknown + 1 }));
        // 不认识：词进队尾重刷
        setQueue((prev) => [...prev, current]);
        setTimeout(() => {
          setIndex((prev) => prev + 1);
          setFlash("none");
        }, 300);
      }
    } finally {
      setBusy(false);
    }
  };

  const cardBg =
    flash === "known"
      ? "bg-correct-soft border-correct"
      : flash === "unknown"
        ? "bg-wrong-soft border-wrong"
        : "bg-surface border-line";

  return (
    <div className="mx-auto flex min-h-[calc(100vh-60px)] max-w-[640px] flex-col px-5 pb-8">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-line py-4">
        <button
          type="button"
          onClick={onExit}
          className="text-[13px] text-ink-mute transition-colors hover:text-ink"
        >
          ← 返回词表
        </button>
        <span className="font-mono text-[12px] text-ink-mute">
          {Math.min(index + 1, queue.length || 1)} / {queue.length}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-mute">
          <input
            type="checkbox"
            checked={hideDefs}
            onChange={(e) => setHideDefs(e.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          隐藏释义
        </label>
      </div>

      {/* 进度条 */}
      <div className="mt-3 h-[3px] w-full bg-line-soft">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${queue.length > 0 ? (index / queue.length) * 100 : 0}%` }}
        />
      </div>

      {/* 统计 */}
      <div className="mt-2 text-[11.5px] text-ink-mute">
        认识 {stats.known} · 不认识 {stats.unknown} · 本次掌握 {stats.mastered}
      </div>

      {/* 卡片区 */}
      {words.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[13.5px] text-ink-soft">生词本是空的，先去刷题加几个词吧</p>
        </div>
      ) : finished ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="font-serif text-[24px] text-ink">这一轮结束了</p>
          <p className="text-[13px] text-ink-soft">
            认识 {stats.known} · 不认识 {stats.unknown} · 本次掌握 {stats.mastered}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setQueue([...words].sort(() => Math.random() - 0.5));
                setIndex(0);
                setFlash("none");
                setStats({ known: 0, unknown: 0, mastered: 0 });
              }}
              className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper"
            >
              再来一轮
            </button>
            <button
              type="button"
              onClick={onExit}
              className="rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft"
            >
              返回词表
            </button>
          </div>
        </div>
      ) : current ? (
        <>
          <div className="flex flex-1 flex-col justify-center">
            <button
              type="button"
              onClick={() => speak(current.word)}
              className={`rounded-[14px] border px-8 py-10 text-center transition-colors ${cardBg}`}
            >
              <p className="font-serif text-[34px] leading-tight tracking-tight text-ink">
                {current.word}
              </p>
              {current.phonetic && (
                <p className="mt-2 font-mono text-[12px] text-ink-mute">{current.phonetic}</p>
              )}

              {!hideDefs && (
                <div className="mt-6 border-t border-line-soft pt-5">
                  {current.definitions.length > 0 ? (
                    <ul className="space-y-1.5">
                      {current.definitions.map((d, i) => (
                        <li key={i} className="flex gap-2 text-[13.5px] leading-[1.7]">
                          {d.pos && (
                            <span className="shrink-0 font-mono text-[11px] text-accent">{d.pos}</span>
                          )}
                          <span className="text-ink-soft">{d.zh}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] italic text-ink-mute">释义待补</p>
                  )}
                  {current.example && (
                    <p className="mt-3 font-serif text-[12.5px] leading-[1.7] text-ink-mute">
                      {current.example}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-ink-mute">
                    已认识 {current.reviewCount}/3 次
                  </p>
                </div>
              )}
            </button>
          </div>

          {/* 认识/不认识 —— 常驻可点 */}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              disabled={busy || flash !== "none"}
              onClick={() => judge("unknown")}
              className="flex-1 rounded-[10px] border border-line py-3 text-[14px] text-ink-soft transition-colors hover:border-wrong hover:text-wrong disabled:opacity-35"
            >
              😵 不认识
            </button>
            <button
              type="button"
              disabled={busy || flash !== "none"}
              onClick={() => judge("known")}
              className="flex-1 rounded-[10px] bg-correct py-3 text-[14px] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
            >
              😊 认识
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
