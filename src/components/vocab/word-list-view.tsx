"use client";

import { useMemo, useState } from "react";
import { delJson, patchJson } from "@/lib/api-client";
import type { VocabItem, VocabQueue } from "@/lib/types";

type Props = {
  tab: "learning" | "mastered";
  sort: "recent" | "priority";
  onSortChange: (sort: "recent" | "priority") => void;
  onTabChange: (tab: "learning" | "mastered") => void;
  words: VocabItem[];
  queue: VocabQueue | undefined;
  isLoading: boolean;
  error: unknown;
  onMutate: () => void;
  onStartFlash: () => void;
  onStartAudio: () => void;
  /** 进「背单词」验证模式（连对 3 次过关），跟刷词、随身听并列，不是游戏厅里的一关 */
  onStartReview: () => void;
  /** 进「单词串故事」：把生词串成一篇英文小故事，目标词加粗并附中文释义 */
  onStartStory: () => void;
};

/** 优先级分档上色：80 以上最该背，60-80 次之，其余灰 */
function priorityTone(score: number): string {
  if (score >= 80) return "border-accent/45 text-accent";
  if (score >= 60) return "border-line text-ink-soft";
  return "border-line-soft text-ink-mute";
}

/**
 * 词表视图：释义直接可见、搜索、发音、快速移除。
 * v2.1 起每行带优先级与到期状态——这两个数就是「先背哪个」的依据，
 * 不用点进去才知道为什么它排在这儿。
 */
export function WordListView({
  tab,
  sort,
  onSortChange,
  onTabChange,
  words,
  queue,
  isLoading,
  error,
  onMutate,
  onStartFlash,
  onStartAudio,
  onStartReview,
  onStartStory,
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

  const dueBadge =
    queue && queue.dueCount > 0
      ? `今日待复习 ${queue.dueCount} 个 · 其中新词 ${queue.newCount} 个`
      : "";

  return (
    <div>
      {/* 学习中 / 已掌握 + 排序 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
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
              className={`rounded-full px-4 py-2 text-[13.5px] transition-colors ${
                tab === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 text-[12.5px]">
          {(
            [
              { key: "recent" as const, label: "最近添加" },
              { key: "priority" as const, label: "优先级" },
            ]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onSortChange(item.key)}
              className={`rounded-full px-3 py-1.5 transition-colors ${
                sort === item.key
                  ? "bg-paper-deep text-ink"
                  : "text-ink-mute hover:text-ink-soft"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {dueBadge && words.length > 0 && (
        <p className="mt-2.5 text-[12.5px] text-ink-mute">{dueBadge}</p>
      )}

      {/*
        背单词入口长在生词本里，而不是游戏厅里多一关：
        它考的就是这份生词本，指标（连对次数、到期时间）也直接写回这里，
        放在列表顶部用户一眼就能看到，不用先跳去游戏厅再找。
      */}
      {tab === "learning" && words.length > 0 && (
        <button
          type="button"
          onClick={onStartReview}
          className="group mt-3 flex w-full items-center gap-3 rounded-[12px] border border-line bg-paper-deep/50 px-4 py-3 text-left transition-colors hover:border-accent"
        >
          <span aria-hidden="true" className="text-[19px]">🧠</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-ink">
              背单词 · 连对 3 次才算过
            </span>
            <span className="mt-1 block text-[13px] leading-relaxed text-ink-mute">
              先给词不给义，近义词当干扰；全部过关后再走一轮回顾
            </span>
          </span>
          <span className="shrink-0 text-[13.5px] text-accent">开始 →</span>
        </button>
      )}

      {/*
        单词串故事：独立入口，和「背单词」并列。
        之前藏在「随身听」的二级 tab 里太隐蔽，用户进随身听默认看到「单词连播」，
        根本发现不了「故事串联」；这里做成一眼可见的卡片直接进入。
      */}
      {tab === "learning" && words.length > 0 && (
        <button
          type="button"
          onClick={onStartStory}
          className="group mt-3 flex w-full items-center gap-3 rounded-[12px] border border-line bg-paper-deep/50 px-4 py-3 text-left transition-colors hover:border-accent"
        >
          <span aria-hidden="true" className="text-[19px]">📖</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-ink">
              单词串故事 · 边读边记
            </span>
            <span className="mt-1 block text-[13px] leading-relaxed text-ink-mute">
              随机挑 8 个生词串成一篇英文小故事，目标词加粗并附中文释义，还能熄屏连续听
            </span>
          </span>
          <span className="shrink-0 text-[13.5px] text-accent">开始 →</span>
        </button>
      )}

      {/* 搜索框 */}
      {words.length > 0 && (
        <div className="mt-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索单词或释义…"
            className="w-full rounded-[8px] border border-line bg-surface px-4 py-2.5 text-[14.5px] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
          />
        </div>
      )}

      {/* 加载/错误/空 */}
      {isLoading && <p className="py-16 text-center text-[14.5px] text-ink-mute">加载中…</p>}
      {error != null && (
        <p className="py-12 text-center text-[14.5px] text-wrong">
          {error instanceof Error ? error.message : "加载失败"}
        </p>
      )}

      {!isLoading && error == null && words.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-[15px] text-ink-soft">
            {tab === "learning" ? "生词本还是空的" : "还没有已掌握的单词"}
          </p>
          <p className="mt-2.5 max-w-[48ch] text-[13.5px] leading-[1.8] text-ink-mute">
            {tab === "learning"
              ? "上面「词书」里可以一键导入四六级高频词，「导入」里可以粘自己的词表，刷题时点单词也能加进来"
              : "认识满 3 次的词会自动移到这里"}
          </p>
        </div>
      )}

      {/* 词表 */}
      {!isLoading && error == null && filtered.length > 0 && (
        <ul className="mt-3 divide-y divide-line-soft border-t border-line">
          {filtered.map((word) => (
            <li key={word.id} data-vl-row="" className="flex items-start gap-3.5 py-[18px]">
              {/* 发音 */}
              <button
                type="button"
                onClick={() => speak(word.word)}
                aria-label={`朗读 ${word.word}`}
                className="mt-0.5 h-9 w-9 shrink-0 rounded-full border border-line text-[14px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
              >
                🔊
              </button>

              {/* 单词 + 释义（全部直接可见） */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span data-vl-word="" className="font-serif text-[20px] text-ink">{word.word}</span>
                  {word.phonetic && (
                    <span className="font-mono text-[13px] text-ink-mute">{word.phonetic}</span>
                  )}
                  <span
                    className={`rounded-full border px-2 py-[1px] font-mono text-[11px] ${priorityTone(word.priority)}`}
                    title={word.reason || "优先级"}
                  >
                    {Math.round(word.priority)}
                  </span>
                  <span
                    className={`text-[11.5px] ${word.overdue ? "text-wrong" : "text-ink-mute"}`}
                  >
                    {word.dueLabel}
                  </span>
                  {tab === "learning" && (
                    <span className="ml-auto shrink-0 font-mono text-[12px] text-ink-mute">
                      {word.reviewCount}/3
                    </span>
                  )}
                </div>
                {word.definitions.length > 0 ? (
                  <p data-vl-def="" className="mt-1.5 text-[15.5px] leading-[1.7] text-ink-soft">
                    {word.definitions.map((d) => `${d.pos} ${d.zh}`).join("；")}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[14px] italic text-ink-mute">释义待补</p>
                )}
                {word.example && (
                  <p className="mt-2 font-serif text-[13.5px] leading-[1.7] text-ink-mute">
                    {word.example}
                  </p>
                )}
                {word.reason && (
                  <p className="mt-1.5 text-[11.5px] text-ink-mute/80">{word.reason}</p>
                )}
              </div>

              {/* 操作 */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => void removeWord(word.word)}
                  className="text-[12.5px] text-ink-mute transition-colors hover:text-wrong"
                  aria-label={`移除 ${word.word}`}
                >
                  ✕
                </button>
                {tab === "mastered" && (
                  <button
                    type="button"
                    onClick={() => void resetWord(word.id)}
                    className="text-[12.5px] text-ink-soft underline-offset-2 hover:text-accent hover:underline"
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
          <div className="mx-auto flex max-w-[1180px] gap-2.5 px-5 py-3.5">
            <button
              type="button"
              onClick={onStartFlash}
              className="min-h-[46px] flex-1 rounded-[10px] bg-ink py-3 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90"
            >
              🎴 刷词
            </button>
            <button
              type="button"
              onClick={onStartReview}
              className="min-h-[46px] flex-1 rounded-[10px] border border-accent/55 bg-accent/[0.06] py-3 text-[13.5px] font-medium text-accent transition-colors hover:bg-accent/10"
            >
              🧠 背单词
            </button>
            <button
              type="button"
              onClick={onStartAudio}
              className="min-h-[46px] flex-1 rounded-[10px] border border-line py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              🎧 随身听
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
