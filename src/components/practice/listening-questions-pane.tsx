"use client";

import { useEffect, useRef } from "react";
import type { AnswerResult, PracticeQuestion } from "@/lib/types";
import type { AnswerEntry } from "@/stores/practice";
import { AnalysisPanel } from "./analysis-panel";
import { ChoiceList, StarButton } from "./reading-pane";

type Props = {
  /** 这一段材料的标题，如 News Report One */
  title: string | null;
  /** 这一段是第几段（从 1 开始）／共几段，用于「下一段」 */
  index: number;
  total: number;
  questions: PracticeQuestion[];
  answers: Record<string, AnswerEntry>;
  /** 当前聚焦的题：问 AI / 笔记 按它走 */
  activeId: string;
  favorites: Record<string, boolean>;
  analysisOpen: Record<string, boolean>;
  cache: Record<string, AnswerResult>;
  submitting: boolean;
  onActivate: (questionId: string) => void;
  onSelect: (questionId: string, choice: string | null) => void;
  onSubmitAll: () => void;
  onNextPassage: () => void;
  onToggleAnalysis: (questionId: string) => void;
  onToggleFavorite: (questionId: string) => void;
  onOpenAI: (questionId: string) => void;
  onOpenComments: (questionId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
};

/**
 * 听力答题区：**一段材料的所有题目在同一页**。
 *
 * 为什么不再逐题翻页：
 *   听力音频是按「一段材料」放的，一段对应 2~4 道题。以前一题一页，
 *   点「下一题」只是换个页面，但人的注意力会被这个动作打断 ——
 *   尤其在音频还在放的时候，翻页那两秒就漏掉了。真实考试也是
 *   一段材料配几道题一起作答，所以这里一次把本段题目全列出来，
 *   音频继续放，用户从上往下答完再交卷。
 *
 * 判分沿用阅读的「整段提交」：一段就是一个答题单元，
 * 逐题提交反而会把「这一段听懂了没有」拆碎。
 */
export function ListeningQuestionsPane({
  title,
  index,
  total,
  questions,
  answers,
  activeId,
  favorites,
  analysisOpen,
  cache,
  submitting,
  onActivate,
  onSelect,
  onSubmitAll,
  onNextPassage,
  onToggleAnalysis,
  onToggleFavorite,
  onOpenAI,
  onOpenComments,
  scrollRef,
  onScroll,
}: Props) {
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const entries = questions.map((q) => answers[q.id]);
  const answeredCount = entries.filter((entry) => Boolean(entry?.choice)).length;
  const gradedCount = entries.filter((entry) => entry?.submitted).length;
  const correctCount = entries.filter((entry) => {
    if (!entry?.submitted) return false;
    return entry.result ? entry.result.isCorrect : entry.isCorrect === true;
  }).length;
  const graded = gradedCount > 0;

  /* 聚焦题（键盘 / 深链进来）滚到可视区，已可见就不动 */
  useEffect(() => {
    if (!activeId) return;
    const pane = scrollRef.current;
    const row = rowRefs.current[activeId];
    if (!pane || !row) return;
    const paneRect = pane.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top >= paneRect.top && rowRect.bottom <= paneRect.bottom) return;
    row.scrollIntoView({ block: "nearest" });
  }, [activeId, scrollRef]);

  const goNextEmpty = () => {
    const empty = questions.find((q) => !answers[q.id]?.choice);
    if (empty) onActivate(empty.id);
  };

  const firstNumber = questions[0]?.number;
  const lastNumber = questions.at(-1)?.number;

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 md:px-6">
        <span className="text-[11px] tracking-[0.2em] text-ink-mute uppercase">Listening</span>
        <span className="min-w-0 truncate font-serif text-[13px] text-ink">{title ?? "听力"}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-ink-mute">
          已答 {answeredCount}/{questions.length}
        </span>
        {graded && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] ${
              gradedCount === questions.length && correctCount === questions.length
                ? "bg-correct-soft text-correct"
                : "bg-paper-deep text-ink-soft"
            }`}
          >
            答对 {correctCount} 题
          </span>
        )}
        <span className="ml-auto hidden shrink-0 font-mono text-[11px] text-ink-mute lg:block">
          {firstNumber}–{lastNumber} · 第 {index + 1}/{total} 段
        </span>
      </div>

      {/* 说明：本段题目都在这一页，音频不会被打断 */}
      <p className="shrink-0 border-b border-line-soft bg-paper-deep/45 px-4 py-2 text-[11.5px] leading-[1.6] text-ink-mute md:px-6">
        这一段共 {questions.length} 道题，全部在这一页作答。音频在左边播，往上往下看不影响播放；
        都选完了点「交本段」。
      </p>

      <div ref={scrollRef} onScroll={onScroll} className="scroll-pane min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y divide-line-soft">
          {questions.map((question) => {
            const entry = answers[question.id] ?? { choice: null, submitted: false, result: null };
            const result = entry.result ?? cache[question.id] ?? null;
            const isCorrect = result?.isCorrect ?? entry.isCorrect;
            const isActive = activeId === question.id;
            const open = Boolean(analysisOpen[question.id]);

            return (
              <li
                key={question.id}
                ref={(node) => {
                  rowRefs.current[question.id] = node;
                }}
                id={`q-${question.id}`}
                className={`scroll-mt-2 px-4 py-4 transition-colors md:px-6 ${
                  isActive ? "bg-paper-deep/35" : ""
                }`}
                onClick={() => onActivate(question.id)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-accent">{question.number}</span>
                  <p className="min-w-0 flex-1 font-serif text-[14.5px] leading-[1.65] text-ink">
                    {question.stem}
                  </p>
                  {entry.submitted && (
                    <span
                      className={`shrink-0 font-mono text-[11px] ${isCorrect ? "text-correct" : "text-wrong"}`}
                    >
                      {isCorrect ? "✓" : "✕"}
                    </span>
                  )}
                  <StarButton
                    active={Boolean(favorites[question.id])}
                    onClick={() => onToggleFavorite(question.id)}
                  />
                </div>

                <div className="mt-2.5">
                  <ChoiceList
                    options={question.options}
                    selected={entry.choice}
                    answerKey={entry.submitted ? (result?.answer ?? null) : null}
                    onSelect={(key) => onSelect(question.id, key)}
                  />
                </div>

                {entry.submitted && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                    <span className={isCorrect ? "text-correct" : "text-wrong"}>
                      {isCorrect ? "答对" : "答错"}
                    </span>
                    {result?.answer && (
                      <span className="text-ink-mute">
                        正确答案 <span className="font-mono text-ink">{result.answer}</span>
                        {entry.choice && !isCorrect && (
                          <>
                            {" · "}你的选择 <span className="font-mono line-through">{entry.choice}</span>
                          </>
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onToggleAnalysis(question.id)}
                      className="ml-auto text-ink-mute underline-offset-2 hover:text-ink hover:underline"
                    >
                      {open ? "收起解析" : "看解析"}
                    </button>
                  </div>
                )}

                {!entry.submitted && isActive && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => onToggleAnalysis(question.id)}
                      className="text-[11.5px] text-ink-mute underline-offset-2 hover:text-ink hover:underline"
                    >
                      {open ? "收起解析" : "直接看解析"}
                    </button>
                  </div>
                )}

                {open && (
                  <div>
                    {result ? (
                      <AnalysisPanel result={result} onJumpPara={() => {}} answerLabel={result.answer ?? undefined} />
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-line-soft" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      {/*
                        与阅读面板同因：按钮在题目卡片 <li> 内，<li> 绑了「点击激活此题」，
                        冒泡会把刚打开的抽屉再关掉。这里拦住，点击只作用于按钮自身。
                      */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenAI(question.id);
                        }}
                        className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-soft hover:border-accent hover:text-accent"
                      >
                        🤖 问 AI
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenComments(question.id);
                        }}
                        className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-soft hover:border-accent hover:text-accent"
                      >
                        💬 笔记
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="h-6" />
      </div>

      {/* 底部 */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 md:px-6">
        <button
          type="button"
          onClick={goNextEmpty}
          disabled={answeredCount === questions.length}
          className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          定位未答
        </button>
        <button
          type="button"
          onClick={onNextPassage}
          disabled={index >= total - 1}
          className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          下一段 →
        </button>
        <span className="ml-auto hidden font-mono text-[11px] text-ink-mute sm:block">
          {answeredCount}/{questions.length}
        </span>
        <button
          type="button"
          onClick={onSubmitAll}
          disabled={submitting || answeredCount === 0}
          className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85 disabled:opacity-35"
        >
          {submitting ? "判分中…" : graded ? "重新交本段" : "交本段"}
        </button>
      </div>
    </section>
  );
}
