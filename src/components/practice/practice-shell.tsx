"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch, postJson } from "@/lib/api-client";
import { pauseForLeaving, resumeAfterReturn } from "@/lib/listening-audio-client";
import type { AnswerResult, PracticePaper } from "@/lib/types";
import { detectReadingTask } from "@/lib/reading-task";
import { usePracticeStore, type AnswerEntry, type FontSize, FONT_SIZES } from "@/stores/practice";
import { ArticlePane, type WordClickPayload } from "./article-pane";
import { ReadingPane } from "./reading-pane";
import { WordCard } from "./word-card";
import { CommentDrawer } from "./comment-drawer";
import { AiDrawer } from "./ai-drawer";
import { ListeningPane } from "./listening-pane";
import { ListeningQuestionsPane } from "./listening-questions-pane";
import { WritingTranslationPane } from "./writing-translation-pane";

const FONT_KEY = "cet:font-size";
const CN_NUMBERS = ["一", "二", "三", "四", "五"];

type Props = {
  paper: PracticePaper;
  initialAnswers: Record<string, { choice: string; isCorrect: boolean; viewedAnalysis: boolean }>;
  initialFavorites: string[];
  initialVocab: Record<string, string>;
  /** 从收藏页直达某道题 */
  startQuestionId?: string;
};

type BatchResponse = { results: AnswerResult[]; correctCount: number; total: number };

type Notice = { text: string; tone: "info" | "error" };

/**
 * 刷题页外壳 —— 两栏独立滚动的实现都在这里：
 *   1. 左栏、右栏各是一个 overflow-y:auto 容器，各自管自己的 scrollTop
 *   2. 切题只操作右栏的 scrollTop（按 questionId 存档/还原），从不碰左栏
 *   3. 滚动左栏只更新左栏，不会引起右栏任何 reflow 或滚动
 *   4. 手机端切换 Tab 用 visibility 控制，两个容器始终留在 DOM 里，滚动位置天然保留
 *
 * 阅读板块（选词填空 / 段落匹配 / 仔细阅读）走 ReadingPane：
 * 一篇 = 一屏题目，交卷时整篇一起判分，滚动位置按篇保存，不再逐题重置。
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
  const passages = useMemo(() => activeSection?.passages ?? [], [activeSection]);

  // 多篇文章切换（阅读 Section 有多篇 passage）
  const [activePassageIndex, setActivePassageIndex] = useState(0);
  const passage = passages[Math.min(activePassageIndex, passages.length - 1)];
  // 题目只取当前 passage 的，切文章时重置题目列表
  const questions = useMemo(() => passage?.questions ?? [], [passage]);
  const order = useMemo(() => questions.map((q) => q.id), [questions]);

  const isReading = activeSection?.type === "reading";
  const isListening = activeSection?.type === "listening";
  const task = useMemo(
    () => (passage && isReading ? detectReadingTask(passage) : null),
    [passage, isReading],
  );

  /**
   * 声音跟着板块走：在听力里可以一直响，切到别的板块必须停。
   *
   * 音频元素是全局单例（见 lib/listening-audio-client），不随组件卸载消失，
   * 所以「离开听力板块」这件事必须在这里显式告知它，否则人已经在写作文了，
   * 耳机里还在念听力原文。
   *
   * 为什么是暂停而不是停止：切回来还要接着听。学生常做的动作是
   * 「听 → 切到题目选答案 → 切回来重听那一句」，每次从头开始等于练不下去。
   *
   * 依赖里故意不写 activePassageIndex：同一板块内翻段由 followPassage 负责，
   * 这里一掺进来，翻段就会被当成「离开再回来」，反倒把正在播的声音打断。
   * 用 ref 读当前段，只让「板块」和「套卷」的变化触发暂停/恢复。
   */
  const listeningKeyRef = useRef(`${paperId}#${activePassageIndex}`);
  listeningKeyRef.current = `${paperId}#${activePassageIndex}`;
  useEffect(() => {
    if (isListening) resumeAfterReturn(listeningKeyRef.current);
    else pauseForLeaving();
    // 离开练习页（组件卸载）同样要停：换成阅读卷、回首页都不该还在响
    return () => pauseForLeaving();
  }, [isListening, paperId]);

  // 板块切换标签：选词填空 / 长篇匹配 / 仔细阅读一、二
  const passageLabels = useMemo(() => {
    const boards = passages.map((p) => detectReadingTask(p).board);
    return boards.map((board, index) => {
      const total = boards.filter((b) => b === board).length;
      if (total <= 1) return board;
      const nth = boards.slice(0, index + 1).filter((b) => b === board).length - 1;
      return board === "仔细阅读" ? `仔细阅读${CN_NUMBERS[nth] ?? nth + 1}` : `${board}${nth + 1}`;
    });
  }, [passages]);

  /** 听力段落标签：新闻 / 长对话 / 篇章 / 讲座 各按出现顺序编号（六级 Section C 是 recording） */
  const listeningLabels = useMemo(() => {
    const seen: Record<string, number> = {};
    return passages.map((p) => {
      const title = p.title ?? "";
      const kind = /news/i.test(title)
        ? "新闻"
        : /conversation/i.test(title)
          ? "对话"
          : /recording|lecture/i.test(title)
            ? "讲座"
            : /passage/i.test(title)
              ? "篇章"
              : "第";
      seen[kind] = (seen[kind] ?? 0) + 1;
      return `${kind} ${seen[kind]}`;
    });
  }, [passages]);

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
  const syncQuestions = usePracticeStore((s) => s.syncQuestions);
  const goTo = usePracticeStore((s) => s.goTo);
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
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 提示条：报错红、结果中性，别让「已判分：答对 1 题」看起来像出错 */
  const notify = useCallback(
    (text: string, tone: Notice["tone"] = "info") => setNotice({ text, tone }),
    [],
  );
  /** 选词填空：当前在填的空号 */
  const [activeBlank, setActiveBlank] = useState<number | null>(null);
  /**
   * 是否已经完成浏览器侧挂载。
   *
   * 只做一件事：给根节点挂 data-hydrated="1"。
   * 首屏是服务端直出的，板块标签、播放器按钮这些 DOM 一开始就在，
   * 但 onClick 还没绑上 —— 这时候点「听力」不会切板块，看起来像按钮坏了。
   * 有了这个标记，自动化验收能等到"真的可点"再点，不用靠 sleep 猜。
   */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  /*
   * 这里原本有一个 listeningBusy 状态，用来在音频播放时锁住「下一题」。
   * 那个锁已经去掉：音频是独立的单例，翻题和播放互不影响，锁住只会让
   * 「边听边看选项」这件事做不到。状态没人读之后一并删掉，免得后来的人
   * 以为它还在起作用。
   */

  /* ---------- 滚动容器 ---------- */
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  /** 右栏滚动位置：阅读按「篇」、听力按「段」存 */
  const rightScrollByPassage = useRef<Record<string, number>>({});

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

    // 同一套卷切篇（选词填空 → 匹配 → 阅读一/二）只同步题目列表：
    // 重新 init 会用首屏快照把刚做完的作答冲掉，这里改为合并。
    if (usePracticeStore.getState().paperId === paperId) {
      syncQuestions({ order, answers: nextAnswers });
    } else {
      init({
        paperId,
        order,
        answers: nextAnswers,
        favorites: favMap,
        vocabWords: initialVocab,
        startId: startQuestionId,
      });
    }
    setActiveBlank(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, activeSectionId, activePassageIndex]);

  /* 离开刷题页才清空 store（放在独立 effect，避免切篇时把作答一并清掉） */
  useEffect(() => () => reset(), [reset]);

  /* 字号存 localStorage */
  useEffect(() => {
    window.localStorage.setItem(FONT_KEY, String(fontSize));
  }, [fontSize]);

  /**
   * 右栏滚动位置按「篇／段」存，切回来还在原来的位置。
   *
   * 阅读是一篇一屏，听力是一段一屏 —— 两种都是「整块内容 + 该块的所有题目」，
   * 所以在同一块里点题目、看选项时不该把列表弹回顶部，只有真的换了块才还原。
   * 左栏的滚动完全不受影响，这里只碰 rightRef。
   */
  const lastPassageId = useRef<string>("");
  useLayoutEffect(() => {
    const pane = rightRef.current;
    if (!pane || !passage) return;
    if (!isReading && !isListening) return;
    if (lastPassageId.current === passage.id) return;
    lastPassageId.current = passage.id;
    pane.scrollTop = rightScrollByPassage.current[passage.id] ?? 0;
  }, [passage, isReading, isListening]);

  /* 记录右栏滚动位置，用于切篇回来时还原 */
  const onPaneScroll = useCallback(() => {
    const pane = rightRef.current;
    if (!pane || !passage) return;
    rightScrollByPassage.current[passage.id] = pane.scrollTop;
  }, [passage]);

  /* 切题时关闭词卡，避免浮层还挂在上一题的坐标上 */
  useEffect(() => {
    setWordPayload(null);
  }, [currentId, passage?.id]);

  const currentQuestion = questions.find((q) => q.id === currentId) ?? questions[0];
  const entry = (currentId && answers[currentId]) || { choice: null, submitted: false, result: null };
  const analysis = entry.result ?? (currentId ? analysisCache[currentId] ?? null : null);

  /* ---------- 提交单题（听力） ---------- */
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
      notify(error instanceof Error ? error.message : "提交失败，请重试", "error");
    } finally {
      setSubmitting(false);
    }
  }, [currentId, submitting, markSubmitted, notify]);

  /* ---------- 交卷判分（阅读：整篇一起判） ---------- */
  const submitAll = useCallback(async () => {
    if (submitting) return;
    const state = usePracticeStore.getState();
    const targets = questions
      .map((q) => ({ questionId: q.id, choice: state.answers[q.id]?.choice ?? null }))
      .filter((item): item is { questionId: string; choice: string } => Boolean(item.choice));

    if (targets.length === 0) {
      notify("还没有作答，先填几个空再交卷");
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const data = await postJson<BatchResponse>("/api/answers/batch", { answers: targets });
      for (const result of data.results) markSubmitted(result.questionId, result);
      setAnalysisCache((prev) => {
        const next = { ...prev };
        for (const result of data.results) next[result.questionId] = result;
        return next;
      });
      const missing = questions.length - targets.length;
      notify(
        missing > 0
          ? `还有 ${missing} 题没作答；本次已判 ${data.total} 题，答对 ${data.correctCount} 题`
          : `已判分：答对 ${data.correctCount}/${data.total} 题`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "交卷失败，请重试", "error");
    } finally {
      setSubmitting(false);
    }
  }, [questions, submitting, markSubmitted, notify]);

  /* ---------- 展开解析（懒加载解析内容） ---------- */
  const toggleAnalysis = useCallback(
    async (questionId?: string) => {
      const targetId = questionId ?? currentId;
      if (!targetId) return;
      const willOpen = !usePracticeStore.getState().analysisOpen[targetId];
      if (!willOpen) {
        setAnalysisOpen(targetId, false);
        return;
      }

      const state = usePracticeStore.getState();
      if (!state.answers[targetId]?.result && !analysisCache[targetId]) {
        try {
          const result = await apiFetch<AnswerResult>(`/api/questions/${targetId}/analysis`);
          setAnalysisCache((prev) => ({ ...prev, [targetId]: result }));
        } catch (error) {
          notify(error instanceof Error ? error.message : "解析加载失败", "error");
          return;
        }
      }
      setAnalysisOpen(targetId, true);
    },
    [currentId, analysisCache, setAnalysisOpen, notify],
  );

  /* ---------- 收藏 ---------- */
  const toggleFavorite = useCallback(
    async (questionId?: string) => {
      const targetId = questionId ?? currentId;
      if (!targetId) return;
      const nextValue = !usePracticeStore.getState().favorites[targetId];
      toggleFavoriteLocal(targetId, nextValue);
      try {
        const result = await postJson<{ favorited: boolean }>(`/api/favorites/${targetId}`, {});
        toggleFavoriteLocal(targetId, result.favorited);
      } catch (error) {
        toggleFavoriteLocal(targetId, !nextValue);
        notify(error instanceof Error ? error.message : "收藏失败", "error");
      }
    },
    [currentId, toggleFavoriteLocal, notify],
  );

  /* ---------- 选词填空：点正文里的空号 ---------- */
  const pickBlank = useCallback(
    (number: number | null) => {
      setActiveBlank(number);
      if (number === null || !task) return;
      const slot = task.blanks.find((item) => item.number === number);
      if (slot) goTo(slot.questionId);
      setMobileTab("question");
    },
    [task, goTo, setMobileTab],
  );

  /* 正文里的空号：填了什么、对错如何 */
  const blankRender = useMemo(() => {
    if (!task || task.kind !== "banked") return undefined;
    const values: Record<number, { key: string; word: string } | undefined> = {};
    const status: Record<number, "correct" | "wrong" | undefined> = {};

    for (const slot of task.blanks) {
      const saved = answers[slot.questionId];
      if (saved?.choice) {
        const word = task.wordBank.find((item) => item.key === saved.choice);
        if (word) values[slot.number] = { key: word.key, word: word.text };
      }
      if (saved?.submitted) {
        const result = saved.result ?? analysisCache[slot.questionId];
        const isCorrect = result?.isCorrect ?? saved.isCorrect;
        if (isCorrect === true) status[slot.number] = "correct";
        else if (isCorrect === false) status[slot.number] = "wrong";
      }
    }

    return {
      numbers: task.blanks.map((slot) => slot.number),
      values,
      status,
      active: activeBlank,
      onPick: (number: number) => pickBlank(number),
    };
  }, [task, answers, analysisCache, activeBlank, pickBlank]);

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
        case "ArrowUp":
          event.preventDefault();
          prev();
          break;
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          next();
          break;
        case "Enter":
          event.preventDefault();
          // 阅读是一篇一交，听力是一段一交，只有写作/翻译那种单题场景才逐题提交
          if (isReading || isListening) void submitAll();
          else void submit();
          break;
        case " ":
        case "Spacebar":
          event.preventDefault();
          void toggleAnalysis();
          break;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8": {
          const index = Number(event.key) - 1;
          if (!currentQuestion) break;
          // 匹配题按段落字母循环，四选一按选项顺序
          const key = task?.kind === "matching" ? task.letters[index] : currentQuestion.options[index]?.key;
          if (key) select(currentQuestion.id, key);
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    wordPayload,
    setDrawer,
    prev,
    next,
    submit,
    submitAll,
    toggleAnalysis,
    select,
    currentQuestion,
    task,
    isReading,
    isListening,
  ]);

  const quickPrompts = [
    entry.submitted && analysis ? `这题为什么选 ${analysis.answer}？` : "这题应该怎么定位答案？",
    "错误选项都错在哪？",
    "这一段是什么意思？",
    "帮我分析这篇文章结构",
  ];

  return (
    /* app-shell：手机浏览器地址栏会伸缩，100vh 比可见高度大，
       底部「提交答案 / 下一题」会被顶到屏幕外且滚不到（容器 overflow-hidden）。
       globals.css 里给它补 100dvh，不认 dvh 的内核自动退回 100vh。 */
    <div className="app-shell flex h-screen flex-col overflow-hidden" data-hydrated={hydrated ? "1" : undefined}>
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
        <div className="min-w-0 flex-1 md:flex-none">
          <p className="truncate font-serif text-[14px] text-ink">{paper.title}</p>
          <p className="hidden truncate text-[11px] text-ink-mute sm:block">
            {passage?.title ?? "Reading"} · 共 {questions.length} 题
          </p>
        </div>

        {/* 手机端 Tab */}
        <div className="ml-auto flex shrink-0 gap-1 md:hidden">
          {(
            [
              /* 听力板块左栏是播放器 + 原文，叫「文章」会让人以为要点开一篇阅读 */
              { key: "article", label: isListening ? "听力" : "文章" },
              { key: "question", label: "题目" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMobileTab(tab.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                mobileTab === tab.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="hidden font-mono text-[11px] text-ink-mute md:ml-auto md:block">
          {paper.level} ·{" "}
          {isReading
            ? "阅读"
            : activeSection.type === "listening"
              ? /* 听力按段推进，顶栏显示「第几段/共几段」，不再按题号 */
                `第 ${activePassageIndex + 1}/${passages.length} 段`
              : activeSection.title}
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
        <div
          className={`shrink-0 border-b border-line px-6 py-2 text-[12px] ${
            notice.tone === "error" ? "bg-wrong-soft text-wrong" : "bg-paper-deep text-ink-soft"
          }`}
        >
          {notice.text}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-3 underline underline-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {/* 阅读板块切换：选词填空 / 长篇匹配 / 仔细阅读一、二 */}
      {passage && passages.length > 1 && (isReading || isListening) && (
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
              {isReading ? passageLabels[i] : listeningLabels[i]}
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
                paragraphs={task?.paragraphs ?? passage?.paragraphs ?? []}
                passageId={passage?.id ?? ""}
                onWordClick={setWordPayload}
                scrollRef={leftRef}
                onScroll={() => {}}
                blank={blankRender}
              />
            ) : (
              <ListeningPane
                paperId={paperId}
                passageId={passage?.id ?? ""}
                index={activePassageIndex}
                title={passage?.title ?? null}
                note={activeSection.note ?? null}
                /* 本段只要交过一次，原文提示就从「先做完」换成「可以逐句核对」 */
                graded={questions.some((q) => Boolean(answers[q.id]?.submitted))}
                scrollRef={leftRef}
              />
            )}
          </div>

          {/* 右栏：阅读走整篇答题板，听力走逐题面板 */}
          <div
            className={`absolute inset-0 min-h-0 border-line md:relative md:inset-auto md:border-l ${
              mobileTab === "question" ? "" : "invisible md:visible"
            }`}
          >
            {isListening ? (
              <ListeningQuestionsPane
                title={passage?.title ?? null}
                index={activePassageIndex}
                total={passages.length}
                questions={questions}
                answers={answers}
                activeId={currentQuestion?.id ?? ""}
                favorites={favorites}
                analysisOpen={analysisOpen}
                cache={analysisCache}
                submitting={submitting}
                onActivate={goTo}
                onSelect={select}
                onSubmitAll={() => void submitAll()}
                onNextPassage={() => setActivePassageIndex((i) => Math.min(i + 1, passages.length - 1))}
                onToggleAnalysis={(id) => void toggleAnalysis(id)}
                onToggleFavorite={(id) => void toggleFavorite(id)}
                onOpenAI={(id) => {
                  goTo(id);
                  setDrawer("ai");
                }}
                onOpenComments={(id) => {
                  goTo(id);
                  setDrawer("comments");
                }}
                scrollRef={rightRef}
                onScroll={onPaneScroll}
              />
            ) : isReading && task ? (
              <ReadingPane
                task={task}
                questions={questions}
                answers={answers}
                activeId={currentId}
                favorites={favorites}
                analysisOpen={analysisOpen}
                cache={analysisCache}
                submitting={submitting}
                activeBlank={activeBlank}
                onActivate={goTo}
                onSelect={select}
                onPickBlank={pickBlank}
                onSubmitAll={() => void submitAll()}
                onToggleAnalysis={(id) => void toggleAnalysis(id)}
                onToggleFavorite={(id) => void toggleFavorite(id)}
                onOpenAI={(id) => {
                  goTo(id);
                  setDrawer("ai");
                }}
                onOpenComments={(id) => {
                  goTo(id);
                  setDrawer("comments");
                }}
                onJumpPara={jumpToPara}
                scrollRef={rightRef}
                onScroll={onPaneScroll}
              />
            ) : null}
          </div>
        </div>
      ) : passage ? (
        /* 写作 / 翻译：题干 + 文本框 + AI 批改 + 参考答案 */
        <WritingTranslationPane
          section={activeSection}
          passage={passage}
          paperId={paperId}
          level={paper.level}
          onNotice={(message) => (message ? notify(message, "error") : setNotice(null))}
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
