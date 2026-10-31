"use client";

import type { AnswerEntry } from "@/stores/practice";
import type { AnswerResult, PracticeQuestion } from "@/lib/types";
import { AnalysisPanel } from "./analysis-panel";
import { OptionList } from "./option-list";

type Props = {
  question: PracticeQuestion;
  index: number;
  total: number;
  entry: AnswerEntry;
  favorited: boolean;
  submitting: boolean;
  analysisOpen: boolean;
  analysis: AnswerResult | null;
  onSelect: (key: string) => void;
  onSubmit: () => void;
  onToggleAnalysis: () => void;
  onToggleFavorite: () => void;
  onPrev: () => void;
  onNext: () => void;
  onJumpPara: (label: string) => void;
  onOpenAI: () => void;
  onOpenComments: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

/**
 * 右栏：答题区。
 * 头部（进度 + 收藏）与底部（切题 / 问 AI / 留言）固定，中间题目区独立滚动，
 * 这样长解析也不会把底部操作挤走。
 */
export function QuestionPane({
  question,
  index,
  total,
  entry,
  favorited,
  submitting,
  analysisOpen,
  analysis,
  onSelect,
  onSubmit,
  onToggleAnalysis,
  onToggleFavorite,
  onPrev,
  onNext,
  onJumpPara,
  onOpenAI,
  onOpenComments,
  scrollRef,
  onScroll,
}: Props) {
  const submitted = entry.submitted;
  const result = analysis ?? entry.result;
  // 之前答过的题在回填时没有解析内容，只有 isCorrect，这里要一起兼容
  const isCorrect = result?.isCorrect ?? entry.isCorrect ?? false;
  const canSubmit = Boolean(entry.choice) && !submitting;
  const isLast = index >= total - 1;

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        <span className="text-[11px] tracking-[0.2em] text-ink-mute uppercase">Question</span>
        <span className="font-mono text-[12px] text-ink">
          第 {index + 1} / {total} 题
        </span>
        {question.type && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-mute">
            {question.type}
          </span>
        )}

        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorited}
          aria-label={favorited ? "取消收藏这道题" : "收藏这道题"}
          title={favorited ? "取消收藏" : "收藏这道题"}
          className={`ml-auto grid h-8 w-8 place-items-center rounded-full text-[15px] transition-colors ${
            favorited
              ? "text-accent"
              : "text-ink-mute hover:bg-paper-deep hover:text-ink"
          }`}
        >
          {favorited ? "★" : "☆"}
        </button>
      </div>

      {/* 题目滚动区 */}
      <div ref={scrollRef} onScroll={onScroll} className="scroll-pane min-h-0 flex-1 px-6 py-6">
        <div className="mx-auto max-w-[48ch]">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-accent">{question.number}</span>
            <h2 className="font-serif text-[17px] leading-[1.6] text-ink">{question.stem}</h2>
          </div>

          <div className="mt-5">
            <OptionList
              options={question.options}
              selected={entry.choice}
              answerKey={submitted ? (result?.answer ?? null) : null}
              onSelect={onSelect}
            />
          </div>

          {/* 提交 / 判题结果 */}
          <div className="mt-5 flex items-center gap-3">
            {!submitted ? (
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85 disabled:opacity-35"
              >
                {submitting ? "提交中…" : "提交答案"}
                <kbd className="ml-2 hidden font-mono text-[10px] opacity-60 sm:inline">Enter</kbd>
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <span
                  className={`rounded-full px-3 py-1 text-[12.5px] ${
                    isCorrect ? "bg-correct-soft text-correct" : "bg-wrong-soft text-wrong"
                  }`}
                >
                  {isCorrect ? "✓ 答对了" : "✕ 答错了"}
                </span>
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitting || !entry.choice}
                  className="text-[12.5px] text-ink-mute underline-offset-2 hover:text-ink hover:underline disabled:opacity-40"
                >
                  改选后重新提交
                </button>
              </div>
            )}
          </div>

          {/* 解析（默认折叠） */}
          <div className="mt-4">
            <button
              type="button"
              onClick={onToggleAnalysis}
              className="flex w-full items-center gap-2 rounded-[6px] border border-line px-3.5 py-2.5 text-left transition-colors hover:border-ink-mute/60 hover:bg-paper-deep/40"
            >
              <span className="text-[13px] text-ink">📖 答案与解析</span>
              <span className="text-[11px] text-ink-mute">
                {analysisOpen ? "收起" : "展开后可看错项分析"}
              </span>
              <span className="ml-auto text-[11px] text-ink-mute">
                {analysisOpen ? "▲" : "▼"}
              </span>
            </button>

            {analysisOpen &&
              (result ? (
                <AnalysisPanel result={result} onJumpPara={onJumpPara} />
              ) : (
                <div className="mt-3 space-y-2 px-1">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-line-soft" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
                </div>
              ))}
          </div>

          {/* 工具入口 */}
          <div className="mt-6 flex flex-wrap gap-2 border-t border-line-soft pt-5">
            <button
              type="button"
              onClick={onOpenAI}
              className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              🤖 问 AI
            </button>
            <button
              type="button"
              onClick={onOpenComments}
              className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              💬 笔记与讨论
            </button>
            <span className="ml-auto self-center text-[11px] text-ink-mute">
              ← → 切题 · 1-4 选项 · Space 解析
            </span>
          </div>
        </div>
      </div>

      {/* 底部切题 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-t border-line px-6">
        <button
          type="button"
          onClick={onPrev}
          disabled={index === 0}
          className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          ← 上一题
        </button>

        <div className="mx-auto flex items-center gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-accent" : "w-1.5 bg-line"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={onNext}
          disabled={isLast}
          className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          下一题 →
        </button>
      </div>
    </section>
  );
}
