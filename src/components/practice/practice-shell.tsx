"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, postJson } from "@/lib/api-client";
import type { AnswerResult, PracticePaper } from "@/lib/types";
import { usePracticeStore, type AnswerEntry, type FontSize, FONT_SIZES } from "@/stores/practice";
import { ArticlePane, type WordClickPayload } from "./article-pane";
import { QuestionPane } from "./question-pane";
import { WordCard } from "./word-card";
import { CommentDrawer } from "./comment-drawer";
import { AiDrawer } from "./ai-drawer";
import { ListeningPane } from "./listening-pane";
import { WritingTranslationPane } from "./writing-translation-pane";

const FONT_KEY = "cet:font-size";

type Props = {
  paper: PracticePaper;
  initialAnswers: Record<string, { choice: string; isCorrect: boolean; viewedAnalysis: boolean }>;
  initialFavorites: string[];
  initialVocab: Record<string, string>;
  /** 从收藏页直达某道题 */
  startQuestionId?: string;
};

/**
 * 刷题页外壳 —— 两栏独立滚动的实现都在这里：
 *   1. 左栏、右栏各是一个 overflow-y:auto 容器，各自管自己的 scrollTop
 *   2. 切题只操作右栏的 scrollTop（按 questionId 存档/还原），从不碰左栏
 *   3. 滚动左栏只更新左栏，不会引起右栏任何 reflow 或滚动
 *   4. 手机端切换 Tab 用 visibility 控制，两个容器始终留在 DOM 里，滚动位置天然保留
 */
export function PracticeShell({
  paper,
  initialAnswers,
  initialFavorites,
  initialVocab,
  startQuestionId,
}: Props) {
  const paperId = paper.id;

  // 当前选中的 Section：默认阅读，没有阅读时取第一个
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const activeSection =
    paper.sections.find((s) => s.id === activeSectionId) ??
    paper.sections.find((s) => s.type === "reading") ??
    paper.sections[0];
  const passages = activeSection?.passages ?? [];

  // 多篇文章切换（阅读 Section 可能有多篇 passage）
  const [activePassageIndex, setActivePassageIndex] = useState(0);
  const passage = passages[Math.min(activePassageIndex, passages.length - 1)];
  // 题目只取当前 passage 的，切文章时重置题目列表
  const questions = passage?.questions ?? [];
  const order = questions.map((q) => q.id);

  // 切 Section 时重置文章索引
  useEffect(() => {
    setActivePassageIndex(0);
  }, [activeSectionId]);

  /* ---------- store ---------- */
  const currentId = usePracticeStore((s) => s.currentId);
  const answers = usePracticeStore((s) => s.answers);
  const favorites = usePracticeStore((s) => s.favorites);
  const analysisOpen = usePracticeStore((s) => s.analysisOpen);
  const drawer = usePracticeStore((s) => s.drawer);
  const mobileTab = usePracticeStore((s) => s.mobileTab);
  const fontSize = usePracticeStore((s) => s.fontSize);

  const init = usePracticeStore((s) => s.init);
  const next = usePracticeStore((s) => s.next);
  const prev = usePracticeStore((s) => s.prev);
  const select = usePracticeStore((s) => s.select);
  const markSubmitted = usePracticeStore((s) => s.markSubmitted);
  const toggleFavoriteLocal = usePracticeStore((s) => s.toggleFavoriteLocal);
  const setAnalysisOpen = usePracticeStore((s) => s.setAnalysisOpen);
  const setDrawer = usePracticeStore((s) => s.setDrawer);
  const setMobileTab = usePracticeStore((s) => s.setMobileTab);
  const setFontSize = usePracticeStore((s) => s.setFontSize);
  const jumpToPara = usePracticeStore((s) => s.jumpToPara);
  const reset = usePracticeStore((s) => s.reset);

  /* ---------- 本地 UI 状态 ---------- */
  const [submitting, setSubmitting] = useState(false);
  const [wordPayload, setWordPayload] = useState<WordClickPayload | null>(null);
  const [analysisCache, setAnalysisCache] = useState<Record<string, AnswerResult>>({});
  const [notice, setNotice] = useState<string | null>(null);

  /* ---------- 滚动容器 ---------- */
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const rightScrollByQuestion = useRef<Record<string, number>>({});
  const lastQuestionId = useRef<string>("");

  /* 初始化 store（每套试卷一次） */
  useEffect(() => {
    const restored = Number(window.localStorage.getItem(FONT_KEY));
    const size = (FONT_SIZES as number[]).includes(restored) ? (restored as FontSize) : null;
    if (size) setFontSize(size);
  }, [setFontSize]);

  useEffect(() => {
    const nextAnswers: Record<string, AnswerEntry> = {};
    for (const id of order) {
      const saved = initialAnswers[id];
      nextAnswers[id] = saved
        ? { choice: saved.choice, submitted: true, result: null, isCorrect: saved.isCorrect }
        : { choice: null, submitted: false, result: null };
    }

    const favMap: Record<string, boolean> = {};
    for (const id of initialFavorites) favMap[id] = true;

    init({
      paperId,
      order,
      answers: nextAnswers,
      favorites: favMap,
      vocabWords: initialVocab,
      startId: startQuestionId,
    });

    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, activeSectionId, activePassageIndex]);

  /* 字号存 localStorage */
  useEffect(() => {
    window.localStorage.setItem(FONT_KEY, String(fontSize));
  }, [fontSize]);

  /**
   * 切题时：先给上一题存档右栏 scrollTop，再还原新题的位置。
   * 注意只操作 rightRef —— 左栏的滚动完全不受影响。
   */
  useLayoutEffect(() => {
    if (!currentId) return;
    const pane = rightRef.current;
    const previous = lastQuestionId.current;

    if (pane && previous && previous !== currentId) {
      rightScrollByQuestion.current[previous] = pane.scrollTop;
    }
    if (pane) {
      pane.scrollTop = rightScrollByQuestion.current[currentId] ?? 0;
    }
    lastQuestionId.current = currentId;
  }, [currentId]);

  /* 切题时关闭词卡，避免浮层还挂在上一题的坐标上 */
  useEffect(() => {
    setWordPayload(null);
  }, [currentId]);

  const currentQuestion = questions.find((q) => q.id === currentId) ?? questions[0];
  const currentIndex = currentId ? order.indexOf(currentId) : 0;
  const entry = (currentId && answers[currentId]) || { choice: null, submitted: false, result: null };
  const analysis = entry.result ?? (currentId ? analysisCache[currentId] ?? null : null);

  /* ---------- 提交答案 ---------- */
  const submit = useCallback(async () => {
    if (!currentId || submitting) return;
    const target = usePracticeStore.getState().answers[currentId];
    if (!target?.choice) return;

    setSubmitting(true);
    setNotice(null);
    try {
      const result = await postJson<AnswerResult>("/api/answers", {
        questionId: currentId,
        choice: target.choice,
      });
      markSubmitted(currentId, result);
      setAnalysisCache((prev) => ({ ...prev, [currentId]: result }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [currentId, submitting, markSubmitted]);

  /* ---------- 展开解析（懒加载解析内容） ---------- */
  const toggleAnalysis = useCallback(async () => {
    if (!currentId) return;
    const willOpen = !usePracticeStore.getState().analysisOpen[currentId];

    if (willOpen && !usePracticeStore.getState().answers[currentId]?.result && !analysisCache[currentId]) {
      try {
        const result = await apiFetch<AnswerResult>(`/api/questions/${currentId}/analysis`);
        setAnalysisCache((prev) => ({ ...prev, [currentId]: result }));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "解析加载失败");
        return;
      }
    }
    setAnalysisOpen(currentId, willOpen);
  }, [currentId, analysisCache, setAnalysisOpen]);

  /* ---------- 收藏 ---------- */
  const toggleFavorite = useCallback(async () => {
    if (!currentId) return;
    const nextValue = !usePracticeStore.getState().favorites[currentId];
    toggleFavoriteLocal(currentId, nextValue);
    try {
      const result = await postJson<{ favorited: boolean }>(`/api/favorites/${currentId}`, {});
      toggleFavoriteLocal(currentId, result.favorited);
    } catch (error) {
      toggleFavoriteLocal(currentId, !nextValue);
      setNotice(error instanceof Error ? error.message : "收藏失败");
    }
  }, [currentId, toggleFavoriteLocal]);

  /* ---------- 键盘快捷键 ---------- */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.key === "Escape") {
        if (wordPayload) setWordPayload(null);
        if (usePracticeStore.getState().drawer) setDrawer(null);
        return;
      }

      // 抽屉打开时只响应 Esc，避免与输入、阅读冲突
      if (usePracticeStore.getState().drawer) return;

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          prev();
          break;
        case "ArrowRight":
          event.preventDefault();
          next();
          break;
        case "Enter":
          event.preventDefault();
          void submit();
          break;
        case " ":
        case "Spacebar":
          event.preventDefault();
          void toggleAnalysis();
          break;
        case "1":
        case "2":
        case "3":
        case "4": {
          const index = Number(event.key) - 1;
          const option = currentQuestion?.options[index];
          if (option) select(currentQuestion!.id, option.key);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [wordPayload, setDrawer, prev, next, submit, toggleAnalysis, select, currentQuestion]);

  const quickPrompts = [
    entry.submitted && analysis ? `这题为什么选 ${analysis.answer}？` : "这题应该怎么定位答案？",
    "错误选项都错在哪？",
    "这一段是什么意思？",
    "帮我分析这篇文章结构",
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-paper px-4 md:px-6">
        <Link
          href="/"
          className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-mute transition-colors hover:text-ink"
          aria-label="返回试卷列表"
        >
          ← <span className="hidden sm:inline">试卷</span>
        </Link>
        <span className="h-4 w-px bg-line" />
        <div className="min-w-0">
          <p className="truncate font-serif text-[14px] text-ink">{paper.title}</p>
          <p className="truncate text-[11px] text-ink-mute">
            {passage?.title ?? "Reading"} · 共 {questions.length} 题
          </p>
        </div>

        {/* 手机端 Tab */}
        <div className="ml-auto flex gap-1 md:hidden">
          {(
            [
              { key: "article", label: "文章" },
              { key: "question", label: "题目" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMobileTab(tab.key)}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                mobileTab === tab.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="hidden font-mono text-[11px] text-ink-mute md:ml-auto md:block">
          {paper.level} · {activeSection.type === "reading" ? `${currentIndex + 1}/${questions.length}` : activeSection.title}
        </span>
      </header>

      {paper.sections.length > 1 && (
        <nav className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-paper px-3 md:px-6">
          {paper.sections.map((s) => {
            const labelMap: Record<string, string> = {
              writing: "写作",
              listening: "听力",
              reading: "阅读",
              translation: "翻译",
            };
            const active = s.id === activeSection.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSectionId(s.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] transition-colors ${
                  active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
                }`}
              >
                {labelMap[s.type] ?? s.title}
              </button>
            );
          })}
        </nav>
      )}

      {notice && (
        <div className="shrink-0 border-b border-line bg-wrong-soft px-6 py-2 text-[12px] text-wrong">
          {notice}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-3 underline underline-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {/* 多篇文章切换 Tab（阅读 Section 有多篇 passage 时显示） */}
      {passage && passages.length > 1 && activeSection.type === "reading" && (
        <nav className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-paper px-3 md:px-6">
          {passages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActivePassageIndex(i)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition-colors ${
                i === activePassageIndex ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              阅读 {i + 1}
            </button>
          ))}
        </nav>
      )}

      {/* 主体：阅读/听力走双栏（左内容右答题），写作/翻译走输入+AI批改 */}
      {passage && (activeSection.type === "reading" || activeSection.type === "listening") ? (
        <div className="relative flex min-h-0 flex-1 md:grid md:grid-cols-[55%_45%]">
        {/* 左栏：阅读显示原文，听力显示原文+音频播放 */}
        <div
          className={`absolute inset-0 min-h-0 md:relative md:inset-auto ${
            mobileTab === "article" ? "" : "invisible md:visible"
          }`}
        >
          {activeSection.type === "reading" ? (
            <ArticlePane
              title={passage?.title ?? null}
              paragraphs={passage?.paragraphs ?? []}
              passageId={passage?.id ?? ""}
              onWordClick={setWordPayload}
              scrollRef={leftRef}
              onScroll={() => {}}
            />
          ) : (
            <ListeningPane
              title={passage?.title ?? null}
              transcript={passage?.transcript ?? []}
              audioUrl={passage?.audioUrl ?? null}
              scrollRef={leftRef}
            />
          )}
        </div>

        {/* 右栏：答题区（阅读/听力共用） */}
        <div
          className={`absolute inset-0 min-h-0 border-line md:relative md:inset-auto md:border-l ${
            mobileTab === "question" ? "" : "invisible md:visible"
          }`}
        >
          {currentQuestion && (
            <QuestionPane
              question={currentQuestion}
              index={currentIndex}
              total={questions.length}
              entry={entry}
              favorited={Boolean(favorites[currentId])}
              submitting={submitting}
              analysisOpen={Boolean(analysisOpen[currentId])}
              analysis={analysis}
              onSelect={(key) => select(currentId, key)}
              onSubmit={() => void submit()}
              onToggleAnalysis={() => void toggleAnalysis()}
              onToggleFavorite={() => void toggleFavorite()}
              onPrev={prev}
              onNext={next}
              onJumpPara={jumpToPara}
              onOpenAI={() => setDrawer("ai")}
              onOpenComments={() => setDrawer("comments")}
              scrollRef={rightRef}
              onScroll={() => {}}
            />
          )}
        </div>
      </div>
      ) : passage ? (
        /* 写作 / 翻译：题干 + 文本框 + AI 批改 + 参考答案 */
        <WritingTranslationPane
          section={activeSection}
          passage={passage}
          paperId={paperId}
          onNotice={setNotice}
        />
      ) : null}

      {/* 词卡浮层 */}
      {wordPayload && passage && (
        <WordCard
          payload={wordPayload}
          passageId={passage.id}
          onClose={() => setWordPayload(null)}
        />
      )}

      {/* 抽屉：key 保证切题时重置会话 */}
      {drawer === "comments" && (
        <CommentDrawer
          key={`comments-${currentId}`}
          questionId={currentId}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer === "ai" && (
        <AiDrawer
          key={`ai-${currentId}`}
          questionId={currentId}
          quickPrompts={quickPrompts}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
