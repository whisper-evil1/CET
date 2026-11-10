"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { GameHud, StarRow } from "./game-hud";
import type {
  AnswerResult,
  PaperSummary,
  PracticePaper,
  PracticeQuestion,
  PracticeSection,
} from "@/lib/types";

/**
 * 趣味阅读闯关：从卷库里抽 5 题，每题限时 45 秒。
 *
 * 刻意不另建题库：抽的就是 /api/papers 里的试卷，判题走同一个 /api/answers，
 * 所以闯关答过的题会同步进错题本与正确率统计，和练习页是同一份数据。
 * 时间到没选 = 判错（但不会替你提交空答案，只在本关计错，不污染错题本）。
 *
 * v2.7 起卷库扩到 66 套：只抽 status=ready 的卷（draft 只有骨架没有正文，
 * 抽到就是空题面），并在候选里随机洗牌，避免每次开局都撞同一套。
 */

const QUESTION_COUNT = 5;
const SECONDS_PER_QUESTION = 45;
/** 一套卷子凑不满就再试下一套，最多试六套，避免首屏卡太久 */
const MAX_PAPER_TRIES = 6;

/** Fisher-Yates，只用于本关取卷顺序 */
function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Item = {
  question: PracticeQuestion;
  section: PracticeSection;
  passageTitle: string;
  paragraphs: { label: string; text: string }[];
};

type Phase = "loading" | "empty" | "error" | "playing" | "result";

/** 篇章里真正能读的段落。空段落是数据噪声，不能当正文 */
function usableParagraphs(passage: PracticeSection["passages"][number]) {
  return (passage.paragraphs ?? []).filter((p) => p.text && p.text.trim().length > 0);
}

/**
 * 从一套卷子里挑可作答的题。
 *
 * 关键一条：**没有正文的篇章一律不出题**。
 * 之前只判断「有没有选项」，结果把 Section II 听力（短篇新闻）的题也抽了进来 ——
 * 听力题本来就没有书面原文（要靠音频），抽出来就是一道「看不到文章却要选主旨」的死题，
 * 用户实测截图就是这样：题干问 news report 的主旨，页面上一个字都没有。
 * 只有仔细阅读才有段落正文，用「有没有可读段落」来筛，比按 Section 标题筛更可靠
 * （这两套卷子的 section.kind 是空的）。
 */
function pickItems(paper: PracticePaper): Item[] {
  const out: Item[] = [];
  for (const section of paper.sections) {
    for (const passage of section.passages) {
      const paragraphs = usableParagraphs(passage);
      if (paragraphs.length === 0) continue;
      for (const question of passage.questions) {
        // 只取有选项的客观题；写作/翻译没有选项，跳过
        if (!question.options || question.options.length < 2) continue;
        out.push({
          question,
          section,
          passageTitle: passage.title || paper.title,
          paragraphs,
        });
      }
    }
  }
  return out.slice(0, QUESTION_COUNT);
}

function starsFor(accuracy: number): number {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  if (accuracy >= 50) return 1;
  return 0;
}

const MAX_HEARTS = 3;

export function ReadingGame() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState("");
  const [paperTitle, setPaperTitle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [left, setLeft] = useState(SECONDS_PER_QUESTION);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrong, setWrong] = useState<{ stem: string; answer: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [outOfHearts, setOutOfHearts] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorText("");
    try {
      const papers = await apiFetch<PaperSummary[]>("/api/papers");
      /**
       * 不只看「这套卷子有几道题」——听力、写作、翻译也计入 questionCount，
       * 真正能拿来出题的（有正文的仔细阅读）可能只有 5 题甚至更少。
       * 所以逐套取详情、按可出题数判断，凑不满 QUESTION_COUNT 就往下一套试。
       * 先按 status=ready 过滤，再把候选打乱，66 套卷子才不会次次撞同一套。
       */
      const pool = (papers ?? []).filter(
        (p) => p.status === "ready" && p.questionCount >= QUESTION_COUNT,
      );
      const candidates = shuffle(pool).slice(0, MAX_PAPER_TRIES);

      let chosen: { paper: PracticePaper; built: Item[] } | null = null;
      for (const summary of candidates) {
        const paper = await apiFetch<PracticePaper>(`/api/papers/${summary.id}`);
        const built = pickItems(paper);
        if (built.length >= QUESTION_COUNT) {
          chosen = { paper, built };
          break;
        }
        // 暂时不够 5 题也先留着，总比空手回去强
        if (!chosen && built.length > 0) chosen = { paper, built };
      }

      if (!chosen) {
        setPhase("empty");
        return;
      }

      const { paper, built } = chosen;
      setPaperTitle(paper.title);
      setItems(built);
      setIndex(0);
      setHearts(MAX_HEARTS);
      setOutOfHearts(false);
      setResults([]);
      setPicked(null);
      setResult(null);
      setLeft(SECONDS_PER_QUESTION);
      setCorrectCount(0);
      setWrong([]);
      setPhase("playing");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载失败");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  const current = items[index];

  // 计时：只在未作答且未提交时走
  useEffect(() => {
    if (phase !== "playing" || picked !== null) return;
    timerRef.current = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, picked, index]);

  const choose = useCallback(
    async (key: string) => {
      if (!current || picked !== null || submitting) return;
      setPicked(key);
      setSubmitting(true);
      try {
        const data = await apiFetch<AnswerResult>("/api/answers", {
          method: "POST",
          body: JSON.stringify({ questionId: current.question.id, choice: key }),
        });
        setResult(data);
        setResults((list) => list.concat([Boolean(data.isCorrect)]));
        if (data.isCorrect) {
          setCorrectCount((n) => n + 1);
        } else {
          setHearts((h) => Math.max(0, h - 1));
          setWrong((list) =>
            list
              .concat([{ stem: current.question.stem, answer: data.answer || "—" }])
              .slice(0, 8),
          );
        }
      } catch (error) {
        // 提交失败：不吞掉，用本关内的正确答案兜底（仍计入错误，但不谎报对）
        setResults((list) => list.concat([false]));
        setHearts((h) => Math.max(0, h - 1));
        setWrong((list) =>
          list.concat([{ stem: current.question.stem, answer: "提交失败，未记录" }]).slice(0, 8),
        );
        setErrorText(error instanceof Error ? error.message : "提交失败");
      } finally {
        setSubmitting(false);
      }
    },
    [current, picked, submitting],
  );

  const next = useCallback(() => {
    setPicked(null);
    setResult(null);
    setErrorText("");
    if (hearts <= 0) {
      setOutOfHearts(true);
      setPhase("result");
      return;
    }
    setIndex((i) => {
      const n = i + 1;
      if (n >= items.length) {
        setPhase("result");
        return i;
      }
      setLeft(SECONDS_PER_QUESTION);
      return n;
    });
  }, [hearts, items.length]);

  const timeout = picked === null && left === 0;

  // 连击 = 末尾连续答对的次数（阅读关没有分数系统，用连击表达「手感」）
  const streak = useMemo(() => {
    let n = 0;
    for (let i = results.length - 1; i >= 0 && results[i]; i--) n++;
    return n;
  }, [results]);

  const accuracy = useMemo(() => {
    const answered = correctCount + wrong.length;
    return answered === 0 ? 0 : Math.round((correctCount / answered) * 100);
  }, [correctCount, wrong.length]);

  if (phase === "loading") {
    return (
      <div className="card-soft mt-5 p-10 text-center text-[13px] text-ink-mute">正在抽题…</div>
    );
  }

  if (phase === "error") {
    return (
      <div className="card-soft mt-5 p-8 text-center">
        <p className="text-[13.5px] text-wrong">{errorText || "加载失败"}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-full bg-ink px-5 py-2 text-[13px] text-paper"
        >
          重试
        </button>
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div className="card-soft mt-5 p-8 text-center">
        <p className="font-serif text-[17px] text-ink">题库里还没凑够一套题</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[12.5px] leading-[1.8] text-ink-mute">
          闯关从卷库里抽题。先运行 <code className="font-mono">npm run db:seed</code> 导入种子题库，
          或者先去做一套完整卷子。
        </p>
        <Link href="/" className="mt-5 inline-block rounded-full bg-ink px-5 py-2 text-[13px] text-paper">
          看试卷列表
        </Link>
      </div>
    );
  }

  if (phase === "result") {
    const stars = starsFor(accuracy);
    return (
      <div className="card-soft mt-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10.5px] tracking-[0.24em] text-accent uppercase">Round clear</p>
            <h2 className="mt-2 font-serif text-[24px] text-ink">本关结束</h2>
          </div>
          <div className="text-right">
            <p className="font-serif text-[30px] leading-none text-ink">{accuracy}%</p>
            <p className="mt-1 text-[11px] text-ink-mute">正确率</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <StarRow stars={stars} size={22} />
          {outOfHearts && (
            <span className="rounded-full bg-wrong-soft px-2.5 py-1 text-[11px] text-wrong">
              命用完了 · 提前收关
            </span>
          )}
        </div>

        <p className="mt-4 text-[12.5px] text-ink-soft">
          {correctCount}/{items.length} 题答对 · 出自《{paperTitle}》
        </p>

        {wrong.length > 0 && (
          <div className="mt-5">
            <p className="text-[12px] text-ink-soft">错题已经进错题本：</p>
            <ul className="mt-2 divide-y divide-line-soft border-t border-line">
              {wrong.map((item, i) => (
                <li key={`${i}-${item.stem.slice(0, 12)}`} className="py-2">
                  <p className="truncate text-[12.5px] text-ink-soft">{item.stem}</p>
                  <p className="mt-0.5 text-[11.5px] text-wrong">正确答案 {item.answer}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full bg-ink px-5 py-2.5 text-[13px] text-paper transition-opacity hover:opacity-85"
          >
            再来一关
          </button>
          <Link
            href="/mistakes"
            className="rounded-full border border-line px-5 py-2.5 text-[13px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            去错题本复盘
          </Link>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const answered = picked !== null && result !== null;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <GameHud
        hearts={hearts}
        maxHearts={MAX_HEARTS}
        combo={streak}
        dots={items.map((_, i) => {
          if (i < results.length) return results[i] ? "done-right" : "done-wrong";
          return i === index ? "current" : "todo";
        })}
        timer={picked === null ? { left, total: SECONDS_PER_QUESTION } : undefined}
      />

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        {/*
          桌面走「左文右题」：原文常驻左栏、自己滚动，题目在右栏。
          产品名就叫左文右题，而且阅读题的正确做法本来就是回原文找依据，
          上下堆叠时每选一题都要往回滚一大段，很别扭。窄屏仍然上下排。
        */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-start">
          {current.paragraphs.length > 0 && (
            <div className="scroll-pane scroll-open max-h-[34vh] overflow-y-auto rounded-[11px] border border-line bg-paper/60 px-4 py-3 sm:max-h-[38vh] lg:max-h-[62vh]">
              <p className="mb-2 text-[10.5px] tracking-[0.18em] text-ink-mute uppercase">
                {current.passageTitle}
              </p>
              {current.paragraphs.map((p) => (
                <p
                  key={p.label}
                  className="mb-2 font-serif text-[14px] leading-[1.75] text-ink-soft last:mb-0"
                >
                  <span className="mr-1.5 font-mono text-[10px] text-accent">{p.label}</span>
                  {p.text}
                </p>
              ))}
            </div>
          )}

          <div className="min-w-0">
            <p className="text-[14px] leading-[1.7] text-ink">
              <span className="mr-1.5 font-mono text-[11px] text-accent">
                第 {current.question.number} 题
              </span>
              {current.question.stem}
            </p>

            <ul className="mt-4 grid gap-2.5">
              {current.question.options.map((option) => {
                const isAnswer = answered && result?.answer === option.key;
                const isPicked = picked === option.key;
                const tone = !answered
                  ? isPicked
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line bg-surface text-ink-soft hover:border-accent hover:text-ink"
                  : isAnswer
                    ? "border-correct bg-correct-soft text-correct"
                    : isPicked
                      ? "border-wrong bg-wrong-soft text-wrong"
                      : "border-line bg-surface text-ink-mute/70";
                return (
                  <li key={option.key}>
                    <button
                      type="button"
                      disabled={picked !== null}
                      onClick={() => void choose(option.key)}
                      className={`flex min-h-[46px] w-full items-start gap-3 rounded-[11px] border px-3.5 py-2.5 text-left text-[13px] leading-[1.6] transition-colors ${tone}`}
                    >
                      <span className="shrink-0 font-mono text-[11px] opacity-70">{option.key}</span>
                      <span className="min-w-0 flex-1">{option.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {timeout && (
              <div className="mt-4 rounded-[11px] border border-line bg-paper-deep/60 p-3">
                <p className="text-[12.5px] text-ink-soft">
                  时间到了。本关不替你交空答案（以免污染错题本），这题记为未答。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={next}
                    className="rounded-full bg-ink px-4 py-1.5 text-[12px] text-paper"
                  >
                    下一题
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeft(SECONDS_PER_QUESTION)}
                    className="rounded-full border border-line px-4 py-1.5 text-[12px] text-ink-soft"
                  >
                    再给 45 秒
                  </button>
                </div>
              </div>
            )}

            {answered && (
              <div className="mt-4 rounded-[11px] border border-line bg-paper/60 p-3.5">
                <p className={`text-[13px] ${result?.isCorrect ? "text-correct" : "text-wrong"}`}>
                  {result?.isCorrect ? "答对了" : `答错了 · 正确答案 ${result?.answer}`}
                </p>
                {result?.analysis && (
                  <p className="mt-2 max-h-[12rem] overflow-y-auto text-[12.5px] leading-[1.8] text-ink-soft">
                    {result.analysis}
                  </p>
                )}
                <button
                  type="button"
                  onClick={next}
                  className="mt-3 rounded-full bg-ink px-4 py-1.5 text-[12px] text-paper"
                >
                  {index + 1 >= items.length ? "看本关结果" : "下一题"}
                </button>
              </div>
            )}

            {errorText && <p className="mt-3 text-[12px] text-wrong">{errorText}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
