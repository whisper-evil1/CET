"use client";

import { useEffect, useMemo, useRef } from "react";
import type { AnswerResult, PracticeQuestion, QuestionOption } from "@/lib/types";
import type { ReadingTask } from "@/lib/reading-task";
import { makeAnswerLabeler } from "@/lib/reading-task";
import type { AnswerEntry } from "@/stores/practice";
import { AnalysisPanel } from "./analysis-panel";

type Props = {
  task: ReadingTask;
  questions: PracticeQuestion[];
  answers: Record<string, AnswerEntry>;
  /** 当前聚焦的题（问 AI / 笔记 / 收藏都按它走） */
  activeId: string;
  favorites: Record<string, boolean>;
  analysisOpen: Record<string, boolean>;
  /** 已加载的解析（含刚交卷返回的） */
  cache: Record<string, AnswerResult>;
  submitting: boolean;
  /** 选词填空：当前在填的空号 */
  activeBlank: number | null;
  onActivate: (questionId: string) => void;
  onSelect: (questionId: string, choice: string | null) => void;
  onPickBlank: (number: number | null) => void;
  onSubmitAll: () => void;
  onToggleAnalysis: (questionId: string) => void;
  onToggleFavorite: (questionId: string) => void;
  onOpenAI: (questionId: string) => void;
  onOpenComments: (questionId: string) => void;
  onJumpPara: (label: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
};

/**
 * 阅读答题区。
 *
 * 三种板块三种交互，不再把「选词填空 / 段落匹配」硬塞进四选一的壳子：
 *   banked   —— 上方是共享词库，下方是 26–35 的空号清单（点空号再点词，或直接点词顺填空位）
 *   matching —— 每题一句陈述，后面跟一排段落字母（A–H），同一段落可重复选
 *   choice   —— 标准四选一，整篇题目一次列在同一屏，交卷后统一判分
 *
 * 判分统一走「交卷」：选词填空的 10 个空本来就是一篇文章的十个位置，
 * 逐题提交既不合考试形态，也会让「哪个词还没用」这种全局状态对不上。
 */
export function ReadingPane({
  task,
  questions,
  answers,
  activeId,
  favorites,
  analysisOpen,
  cache,
  submitting,
  activeBlank,
  onActivate,
  onSelect,
  onPickBlank,
  onSubmitAll,
  onToggleAnalysis,
  onToggleFavorite,
  onOpenAI,
  onOpenComments,
  onJumpPara,
  scrollRef,
  onScroll,
}: Props) {
  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const blankNumberByQuestion = useMemo(() => {
    const map = new Map<string, number>();
    for (const slot of task.blanks) map.set(slot.questionId, slot.number);
    return map;
  }, [task.blanks]);

  const wordByKey = useMemo(
    () => new Map(task.wordBank.map((word) => [word.key, word.text])),
    [task.wordBank],
  );

  const labelFor = useMemo(
    () => makeAnswerLabeler(task.wordBank, task.letters),
    [task.wordBank, task.letters],
  );

  /* ---------- 汇总 ---------- */
  const entries = questions.map((q) => answers[q.id]);
  const answeredCount = entries.filter((entry) => Boolean(entry?.choice)).length;
  const gradedCount = entries.filter((entry) => entry?.submitted).length;
  const correctCount = entries.filter((entry) => {
    if (!entry?.submitted) return false;
    return entry.result ? entry.result.isCorrect : entry.isCorrect === true;
  }).length;

  const graded = gradedCount > 0;
  const allGraded = gradedCount === questions.length;

  /* 聚焦题滚动到可视区：键盘上下切题、深链 ?q= 都靠它。
     用「整行是否已完整可见」判断，已经看得见就不动 —— 否则点一下题目行
     （onClick 在同一事件里触发激活）会把列表滚一下，反而点丢选项。 */
  useEffect(() => {
    if (!activeId) return;
    const pane = scrollRef.current;
    const row = rowRefs.current[activeId];
    if (!pane || !row) return;
    const paneRect = pane.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const fullyVisible = rowRect.top >= paneRect.top && rowRect.bottom <= paneRect.bottom;
    if (fullyVisible) return;
    row.scrollIntoView({ block: "nearest" });
  }, [activeId, scrollRef]);

  // 依据句跳转时，右栏也跟着聚焦到对应题目之外不做处理：左栏自己会滚

  const goNextEmpty = () => {
    const empty = questions.find((q) => !answers[q.id]?.choice);
    if (empty) onActivate(empty.id);
  };

  const usedByKey = useMemo(() => {
    const map = new Map<string, { number: number; questionId: string }>();
    for (const slot of task.blanks) {
      const choice = answers[slot.questionId]?.choice;
      if (choice) map.set(choice, { number: slot.number, questionId: slot.questionId });
    }
    return map;
  }, [answers, task.blanks]);

  /** 把一个词填进目标空位；这个词已占别的空位时先腾出来（一词只用一次） */
  const placeWord = (wordKey: string) => {
    if (!task.blanks.length) return;
    const targetNumber =
      activeBlank ?? task.blanks.find((slot) => !answers[slot.questionId]?.choice)?.number ?? null;
    if (targetNumber === null) return;
    const target = task.blanks.find((slot) => slot.number === targetNumber);
    if (!target) return;

    const occupied = usedByKey.get(wordKey);
    if (occupied && occupied.questionId !== target.questionId) {
      onSelect(occupied.questionId, null);
    }
    onSelect(target.questionId, wordKey);

    const nextEmpty = task.blanks.find(
      (slot) => slot.number > targetNumber && !answers[slot.questionId]?.choice,
    );
    onPickBlank(nextEmpty ? nextEmpty.number : null);
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-surface">
      {/* 头部 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 md:px-6">
        <span className="text-[11px] tracking-[0.2em] text-ink-mute uppercase">Reading</span>
        <span className="font-serif text-[13px] text-ink">{task.board}</span>
        <span className="font-mono text-[11.5px] text-ink-mute">
          已答 {answeredCount}/{questions.length}
        </span>
        {graded && (
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${
              allGraded && correctCount === questions.length
                ? "bg-correct-soft text-correct"
                : "bg-paper-deep text-ink-soft"
            }`}
          >
            答对 {correctCount} 题
          </span>
        )}
        <span className="ml-auto hidden font-mono text-[11px] text-ink-mute lg:block">
          {questions[0]?.number}–{questions.at(-1)?.number}
        </span>
      </div>

      {/* 题型说明 */}
      <p className="shrink-0 border-b border-line-soft bg-paper-deep/45 px-4 py-2 text-[11.5px] leading-[1.6] text-ink-mute md:px-6">
        {task.instruction}
      </p>

      <div ref={scrollRef} onScroll={onScroll} className="scroll-pane min-h-0 flex-1 overflow-y-auto">
        {/* 词库（仅选词填空） */}
        {task.kind === "banked" && task.wordBank.length > 0 && (
          <div className="border-b border-line bg-paper px-4 py-4 md:sticky md:top-0 md:z-10 md:px-6 md:shadow-[0_1px_0_rgba(227,221,208,0.9)]">
            <div className="mb-2.5 flex items-baseline gap-2">
              <span className="text-[11px] tracking-[0.18em] text-ink-mute uppercase">Word Bank</span>
              <span className="text-[11.5px] text-ink-mute">
                已用 {usedByKey.size}/{task.blanks.length}
              </span>
              {activeBlank !== null && (
                <span className="ml-auto font-mono text-[11px] text-accent">
                  正在填 {activeBlank}
                </span>
              )}
            </div>

            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {task.wordBank.map((word) => {
                const used = usedByKey.get(word.key);
                const usedEntry = used ? answers[used.questionId] : undefined;
                const usedResult = used ? usedEntry?.result ?? cache[used!.questionId] : undefined;
                const usedCorrect = usedResult ? usedResult.isCorrect : usedEntry?.isCorrect;
                return (
                  <li key={word.key}>
                    <button
                      type="button"
                      onClick={() => placeWord(word.key)}
                      className={[
                        "flex w-full items-center gap-2 rounded-[6px] border px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        used
                          ? "border-dashed border-line bg-paper-deep/50 text-ink-mute"
                          : "border-line bg-surface text-ink hover:border-accent hover:text-accent",
                      ].join(" ")}
                    >
                      <span className="font-mono text-[10.5px] text-ink-mute">{word.key}</span>
                      <span className="min-w-0 flex-1 truncate">{word.text}</span>
                      {used && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 font-mono text-[10px] ${
                            usedCorrect === true
                              ? "bg-correct-soft text-correct"
                              : "bg-paper-deep text-ink-mute"
                          }`}
                        >
                          {used.number}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2.5 text-[11px] leading-[1.6] text-ink-mute">
              先点下面清单里的空号再点单词；直接点单词会自动填进下一个空。同一个词只会占一个空。
            </p>
          </div>
        )}

        {/* 题目清单 */}
        <ul className="divide-y divide-line-soft">
          {questions.map((question) => {
            const entry = answers[question.id] ?? { choice: null, submitted: false, result: null };
            const result = entry.result ?? cache[question.id] ?? null;
            const isCorrect = result?.isCorrect ?? entry.isCorrect;
            const isActive = activeId === question.id;
            const open = Boolean(analysisOpen[question.id]);
            const number = blankNumberByQuestion.get(question.id) ?? question.number;

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
                {/* 选词填空：一行解决（空号 + 已选词 + 状态 + 收藏），不需要再来一行题头 */}
                {task.kind === "banked" ? (
                  <div className="flex items-center gap-2">
                    <BankedControl
                      questionId={question.id}
                      number={number}
                      entry={entry}
                      result={result}
                      isActiveBlank={activeBlank === number}
                      wordByKey={wordByKey}
                      onPickBlank={() => onPickBlank(number)}
                      onClear={() => onSelect(question.id, null)}
                    />
                    {entry.submitted && (
                      <span
                        className={`font-mono text-[11px] ${
                          isCorrect ? "text-correct" : "text-wrong"
                        }`}
                      >
                        {isCorrect ? "✓" : "✕"}
                      </span>
                    )}
                    <StarButton
                      active={Boolean(favorites[question.id])}
                      onClick={() => onToggleFavorite(question.id)}
                      className="ml-auto"
                    />
                  </div>
                ) : (
                  <>
                    {/* 题头：题号 + 题干 + 判分标记 + 收藏 */}
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-accent">{number}</span>
                      <p className="min-w-0 flex-1 font-serif text-[14.5px] leading-[1.65] text-ink">
                        {question.stem}
                      </p>
                      {entry.submitted && (
                        <span
                          className={`shrink-0 font-mono text-[11px] ${
                            isCorrect ? "text-correct" : "text-wrong"
                          }`}
                        >
                          {isCorrect ? "✓" : "✕"}
                        </span>
                      )}
                      <StarButton
                        active={Boolean(favorites[question.id])}
                        onClick={() => onToggleFavorite(question.id)}
                      />
                    </div>

                    {/* 作答控件 */}
                    <div className="mt-2.5">
                      {task.kind === "matching" ? (
                        <LetterPicker
                          letters={task.letters}
                          selected={entry.choice}
                          answerKey={entry.submitted ? (result?.answer ?? null) : null}
                          onSelect={(letter) => onSelect(question.id, letter)}
                        />
                      ) : (
                        <ChoiceList
                          options={question.options}
                          selected={entry.choice}
                          answerKey={entry.submitted ? (result?.answer ?? null) : null}
                          onSelect={(key) => onSelect(question.id, key)}
                        />
                      )}
                    </div>
                  </>
                )}

                {/* 判分后：答案 + 解析 */}
                {entry.submitted && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
                    <span className={isCorrect ? "text-correct" : "text-wrong"}>
                      {isCorrect ? "答对" : "答错"}
                    </span>
                    {/* 回看历史作答时服务端只回了对错、没回答案，这时不硬凑一行空白 */}
                    {result?.answer && (
                      <span className="text-ink-mute">
                        正确答案{" "}
                        <span className="font-mono text-ink">{labelFor(result.answer)}</span>
                        {entry.choice && !isCorrect && (
                          <>
                            {" · "}你的选择{" "}
                            <span className="font-mono line-through">{labelFor(entry.choice)}</span>
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

                {/* 未交卷也能看解析（回看已作答的旧题） */}
                {!entry.submitted && isActive && (
                  <div className="mt-2 flex items-center gap-3">
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
                      <AnalysisPanel result={result} onJumpPara={onJumpPara} answerLabel={labelFor(result.answer)} />
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-line-soft" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      {/*
                        这两个按钮在题目卡片 <li> 内部，而 <li> 自己绑了「点击激活此题」。
                        不拦截冒泡的话：按钮先打开抽屉，事件再冒到 li → goTo() 会把 drawer
                        重置成 null，同一帧内抽屉开了又关，表现出来就是「点了没反应」。
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

      {/* 底部：定位 + 交卷 */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-t border-line bg-surface px-4 md:px-6">
        <button
          type="button"
          onClick={goNextEmpty}
          disabled={answeredCount === questions.length}
          className="rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep disabled:opacity-30"
        >
          定位未答
        </button>
        <span className="hidden font-mono text-[11px] text-ink-mute sm:block">
          ↑↓ 切题 · 1–{Math.max(4, task.letters.length)} 选项 · Space 解析
        </span>
        <button
          type="button"
          onClick={onSubmitAll}
          disabled={submitting || answeredCount === 0}
          className="ml-auto rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85 disabled:opacity-35"
        >
          {submitting ? "判分中…" : graded ? "重新交卷" : "交卷判分"}
          <kbd className="ml-2 hidden font-mono text-[10px] opacity-60 sm:inline">Enter</kbd>
        </button>
      </div>
    </section>
  );
}

/* ---------------- 选词填空：单个空位 ---------------- */

function BankedControl({
  questionId,
  number,
  entry,
  result,
  isActiveBlank,
  wordByKey,
  onPickBlank,
  onClear,
}: {
  questionId: string;
  number: number;
  entry: AnswerEntry;
  result: AnswerResult | null;
  isActiveBlank: boolean;
  wordByKey: Map<string, string>;
  onPickBlank: () => void;
  onClear: () => void;
}) {
  const chosen = entry.choice ? wordByKey.get(entry.choice) ?? entry.choice : null;
  const correct = result?.isCorrect ?? entry.isCorrect;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPickBlank}
        data-question={questionId}
        className={[
          "flex min-w-[9rem] items-center gap-2 rounded-[6px] border px-3 py-2 text-left text-[13px] transition-colors",
          entry.submitted
            ? correct === true
              ? "border-correct bg-correct-soft text-correct"
              : "border-wrong bg-wrong-soft text-wrong"
            : isActiveBlank
              ? "border-accent bg-accent-soft text-accent"
              : chosen
                ? "border-line bg-surface text-ink hover:border-accent"
                : "border-dashed border-line bg-surface text-ink-mute hover:border-accent hover:text-accent",
        ].join(" ")}
      >
        <span className="font-mono text-[10.5px] opacity-70">{number}</span>
        <span className={chosen ? "" : "opacity-60"}>{chosen ?? "点这里选词"}</span>
        {entry.choice && (
          <span className="ml-auto font-mono text-[10px] opacity-70">{entry.choice}</span>
        )}
      </button>

      {chosen && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11.5px] text-ink-mute underline-offset-2 hover:text-ink hover:underline"
        >
          清空
        </button>
      )}
    </div>
  );
}

/* ---------------- 段落匹配：段落字母选择器 ---------------- */

function LetterPicker({
  letters,
  selected,
  answerKey,
  onSelect,
}: {
  letters: string[];
  selected: string | null;
  answerKey: string | null;
  onSelect: (letter: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="匹配段落">
      {letters.map((letter) => {
        const isSelected = selected === letter;
        const isCorrect = answerKey !== null && letter === answerKey;
        const isWrong = answerKey !== null && isSelected && !isCorrect;
        return (
          <button
            key={letter}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(letter)}
            className={[
              "grid h-8 min-w-8 place-items-center rounded-[5px] border px-1 font-mono text-[12px] transition-colors",
              isCorrect
                ? "border-correct bg-correct text-white"
                : isWrong
                  ? "border-wrong bg-wrong text-white"
                  : isSelected
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-ink-soft hover:border-ink-mute hover:bg-paper-deep/60",
            ].join(" ")}
          >
            {letter}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- 仔细阅读：紧凑四选一 ---------------- */

export function ChoiceList({
  options,
  selected,
  answerKey,
  onSelect,
}: {
  options: QuestionOption[];
  selected: string | null;
  answerKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <ul className="space-y-1" role="radiogroup" aria-label="选项">
      {options.map((option) => {
        const isSelected = selected === option.key;
        const isCorrect = answerKey !== null && option.key === answerKey;
        const isWrong = answerKey !== null && isSelected && !isCorrect;
        return (
          <li key={option.key}>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(option.key)}
              className={[
                "flex w-full items-start gap-2.5 rounded-[6px] border px-2.5 py-1.5 text-left transition-colors",
                isCorrect
                  ? "border-correct bg-correct-soft"
                  : isWrong
                    ? "border-wrong bg-wrong-soft"
                    : isSelected
                      ? "border-accent bg-accent-soft/60"
                      : "border-line-soft bg-surface hover:border-line hover:bg-paper-deep/50",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-[2px] grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border font-mono text-[10.5px]",
                  isCorrect
                    ? "border-correct bg-correct text-white"
                    : isWrong
                      ? "border-wrong bg-wrong text-white"
                      : isSelected
                        ? "border-accent bg-accent text-white"
                        : "border-line text-ink-mute",
                ].join(" ")}
              >
                {option.key}
              </span>
              <span className="text-[13px] leading-[1.6] text-ink-soft">{option.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 每题右上角的收藏星：列表里出现十几次，抽出来省得每处都抄一遍样式 */
export function StarButton({
  active,
  onClick,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "取消收藏这道题" : "收藏这道题"}
      className={`shrink-0 text-[14px] leading-none transition-colors ${
        active ? "text-accent" : "text-ink-mute/60 hover:text-ink"
      } ${className}`}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
