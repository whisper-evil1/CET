"use client";

import { useMemo, useState } from "react";
import { del, delJson, patchJson } from "@/lib/api-client";
import type { VocabItem } from "@/lib/types";

type Props = {
  tab: "learning" | "mastered";
  onTabChange: (tab: "learning" | "mastered") => void;
  words: VocabItem[];
  isLoading: boolean;
  error: unknown;
  onMutate: () => void;
  onStartFlash: () => void;
  onStartAudio: () => void;
};

/** 词表视图：释义直接可见、搜索、发音、快速移除 */
export function WordListView({
  tab,
  onTabChange,
  words,
  isLoading,
  error,
  onMutate,
  onStartFlash,
  onStartAudio,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return words;
    const q = query.trim().toLowerCase();
    return words.filter(
      (w) =>
        w.word.toLowerCase().includes(q) ||
        w.definitions.some((d) => d.zh.toLowerCase().includes(q)),
    );
  }, [words, query]);

  const speak = (word: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const removeWord = async (word: string) => {
    if (!window.confirm(`从生词本移除 "${word}"？`)) return;
    await delJson("/api/vocab", { word });
    void onMutate();
  };

  const resetWord = async (id: string) => {
    await patchJson(`/api/vocab/${id}`, { action: "reset" });
    void onMutate();
  };

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-28">
      {/* 标题 + Tab */}
      <div className="flex items-baseline justify-between border-b border-line py-6">
        <h1 className="font-serif text-[26px] text-ink">生词本</h1>
        <div className="flex gap-1">
          {(
            [
              { key: "learning" as const, label: `学习中 ${tab === "learning" ? words.length : ""}` },
              { key: "mastered" as const, label: `已掌握 ${tab === "mastered" ? words.length : ""}` },
            ]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onTabChange(item.key)}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                tab === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 搜索框 */}
      {words.length > 0 && (
        <div className="mt-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索单词或释义…"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
          />
        </div>
      )}

      {/* 加载/错误/空 */}
      {isLoading && <p className="py-16 text-center text-[13px] text-ink-mute">加载中…</p>}
      {error != null && (
        <p className="py-12 text-center text-[13px] text-wrong">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {!isLoading && error == null && words.length === 0 && (
        <div className="py-20 text-center">
          <p className="text-[13.5px] text-ink-soft">
            {tab === "learning" ? "生词本还是空的" : "还没有已掌握的单词"}
          </p>
          <p className="mt-2 text-[12.5px] text-ink-mute">
            {tab === "learning"
              ? "刷题时点任意单词，选「加入生词本」，这里就会出现"
              : "认识满 3 次的词会自动移到这里"}
          </p>
        </div>
      )}

      {/* 词表 */}
      {!isLoading && error == null && filtered.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft border-t border-line">
          {filtered.map((word) => (
            <li key={word.id} className="flex items-start gap-3 py-3.5">
              {/* 发音 */}
              <button
                type="button"
                onClick={() => speak(word.word)}
                aria-label={`朗读 ${word.word}`}
                className="mt-0.5 h-8 w-8 shrink-0 rounded-full border border-line text-[13px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
              >
                🔊
              </button>

              {/* 单词 + 释义（全部直接可见） */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-serif text-[17px] text-ink">{word.word}</span>
                  {word.phonetic && (
                    <span className="font-mono text-[11.5px] text-ink-mute">{word.phonetic}</span>
                  )}
                  {tab === "learning" && (
                    <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-mute">
                      {word.reviewCount}/3
                    </span>
                  )}
                </div>
                {word.definitions.length > 0 ? (
                  <p className="mt-1 text-[13px] leading-[1.6] text-ink-soft">
                    {word.definitions.map((d) => `${d.pos} ${d.zh}`).join("；")}
                  </p>
                ) : (
                  <p className="mt-1 text-[12.5px] italic text-ink-mute">释义待补</p>
                )}
                {word.example && (
                  <p className="mt-1.5 font-serif text-[12px] leading-[1.6] text-ink-mute">
                    {word.example}
                  </p>
                )}
              </div>

              {/* 操作 */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => void removeWord(word.word)}
                  className="text-[11.5px] text-ink-mute transition-colors hover:text-wrong"
                  aria-label={`移除 ${word.word}`}
                >
                  ✕
                </button>
                {tab === "mastered" && (
                  <button
                    type="button"
                    onClick={() => void resetWord(word.id)}
                    className="text-[11.5px] text-ink-soft underline-offset-2 hover:text-accent hover:underline"
                  >
                    移回
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 底部固定操作栏 */}
      {!isLoading && error == null && tab === "learning" && words.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[760px] gap-3 px-5 py-3">
            <button
              type="button"
              onClick={onStartFlash}
              className="flex-1 rounded-[10px] bg-ink py-3 text-[14px] font-medium text-paper transition-opacity hover:opacity-90"
            >
              🎴 开始刷词
            </button>
            <button
              type="button"
              onClick={onStartAudio}
              className="flex-1 rounded-[10px] border border-line py-3 text-[14px] font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              🎧 随身听
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
