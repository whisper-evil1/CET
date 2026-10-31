"use client";

import { create } from "zustand";
import type { AnswerResult } from "@/lib/types";

export type AnswerEntry = {
  choice: string | null;
  submitted: boolean;
  result: AnswerResult | null;
  /** 服务端回填的对错（此时还没有解析内容，解析要展开时才拉） */
  isCorrect?: boolean;
};

export type DrawerKind = "ai" | "comments" | null;

export type FontSize = 14 | 16 | 18 | 20;
export const FONT_SIZES: FontSize[] = [14, 16, 18, 20];

type PracticeState = {
  paperId: string;
  /** 题目顺序，用于上一题/下一题 */
  order: string[];
  currentId: string;
  answers: Record<string, AnswerEntry>;
  favorites: Record<string, boolean>;
  /** 小写单词 → 第一条释义（用于正文淡黄底的 hover 提示） */
  vocabWords: Record<string, string>;
  analysisOpen: Record<string, boolean>;
  drawer: DrawerKind;
  mobileTab: "article" | "question";
  fontSize: FontSize;
  /** 依据句跳转：段落 label + 递增计数器（相同段落也能重复触发动画） */
  jump: { para: string; nonce: number } | null;

  init: (payload: {
    paperId: string;
    order: string[];
    answers: Record<string, AnswerEntry>;
    favorites: Record<string, boolean>;
    vocabWords: Record<string, string>;
    startId?: string;
  }) => void;
  goTo: (id: string) => void;
  next: () => void;
  prev: () => void;
  select: (questionId: string, choice: string) => void;
  markSubmitted: (questionId: string, result: AnswerResult) => void;
  toggleFavoriteLocal: (questionId: string, value: boolean) => void;
  addVocabLocal: (word: string, brief: string) => void;
  setAnalysisOpen: (questionId: string, open: boolean) => void;
  setDrawer: (drawer: DrawerKind) => void;
  setMobileTab: (tab: "article" | "question") => void;
  setFontSize: (size: FontSize) => void;
  jumpToPara: (label: string) => void;
  reset: () => void;
};

const emptyAnswers: Record<string, AnswerEntry> = {};

export const usePracticeStore = create<PracticeState>((set, get) => ({
  paperId: "",
  order: [],
  currentId: "",
  answers: emptyAnswers,
  favorites: {},
  vocabWords: {},
  analysisOpen: {},
  drawer: null,
  mobileTab: "article",
  fontSize: 18,
  jump: null,

  init: ({ paperId, order, answers, favorites, vocabWords, startId }) =>
    set({
      paperId,
      order,
      currentId: startId && order.includes(startId) ? startId : (order[0] ?? ""),
      answers,
      favorites,
      vocabWords,
      analysisOpen: {},
      drawer: null,
      jump: null,
    }),

  goTo: (id) => {
    if (!get().order.includes(id)) return;
    // 切题时关掉抽屉，避免上一题的对话/留言串到下一题
    set({ currentId: id, drawer: null });
  },

  next: () => {
    const { order, currentId, goTo } = get();
    const index = order.indexOf(currentId);
    if (index >= 0 && index < order.length - 1) goTo(order[index + 1]!);
  },

  prev: () => {
    const { order, currentId, goTo } = get();
    const index = order.indexOf(currentId);
    if (index > 0) goTo(order[index - 1]!);
  },

  select: (questionId, choice) => {
    const entry = get().answers[questionId] ?? { choice: null, submitted: false, result: null };
    // 已提交的题目允许改选，但改选后需要重新提交才更新对错
    set({
      answers: { ...get().answers, [questionId]: { ...entry, choice } },
    });
  },

  markSubmitted: (questionId, result) => {
    const entry = get().answers[questionId] ?? { choice: null, submitted: false, result: null };
    set({
      answers: {
        ...get().answers,
        [questionId]: {
          ...entry,
          submitted: true,
          result,
          choice: result.choice || entry.choice,
          isCorrect: result.isCorrect,
        },
      },
    });
  },

  toggleFavoriteLocal: (questionId, value) =>
    set({ favorites: { ...get().favorites, [questionId]: value } }),

  addVocabLocal: (word, brief) =>
    set({ vocabWords: { ...get().vocabWords, [word.toLowerCase()]: brief } }),

  setAnalysisOpen: (questionId, open) =>
    set({ analysisOpen: { ...get().analysisOpen, [questionId]: open } }),

  setDrawer: (drawer) => set({ drawer }),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setFontSize: (fontSize) => set({ fontSize }),
  jumpToPara: (label) =>
    set({ jump: { para: label, nonce: (get().jump?.nonce ?? 0) + 1 }, mobileTab: "article" }),
  reset: () =>
    set({
      paperId: "",
      order: [],
      currentId: "",
      answers: {},
      favorites: {},
      vocabWords: {},
      analysisOpen: {},
      drawer: null,
      jump: null,
    }),
}));
