"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { apiFetch } from "@/lib/api-client";
import { withSharecode, isPlatformBlock } from "@/lib/share-code";
import { prepareMarkdown } from "@/lib/markdown";
import type { PaperSummary, PracticePaper, PracticeQuestion } from "@/lib/types";

/**
 * 趣味写作 / 翻译挑战。
 *
 * 题目同样来自卷库（写作、翻译题），批改走 /api/ai/grade：
 * 配了模型就按阅卷要求逐项点评，没配模型也会依据真实作答检查字数、句长、
 * 衔接词、中文标点残留这些硬指标，不会出现「演示模式」这种空话。
 *
 * v2.7 起卷库扩到 66 套：只抽 status=ready 的卷，候选先洗牌再逐套找题，
 * 否则前四套里碰不到写作/翻译就直接报「暂时没有题目」。
 */

type Item = {
  question: PracticeQuestion;
  paperTitle: string;
  level: string;
};

type Phase = "loading" | "empty" | "error" | "ready";

/** 写作挑战限时：15 分钟，超时不停写，只是把计时变红并记下超时 */
const CHALLENGE_SECONDS = 15 * 60;

/** 逐套翻找写作/翻译题时最多看几套，防止 66 套全量请求拖慢首屏 */
const MAX_PAPER_TRIES = 8;

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 建议字数：CET4 120 词 / CET6 150 词（沿用考纲要求，不自己编） */
function targetWords(level: string): number {
  return level === "CET6" ? 150 : 120;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function isWritingLike(q: PracticeQuestion): boolean {
  const type = (q.type ?? "").toLowerCase();
  if (type === "translation" || type === "writing") return true;
  const hasOptions = q.options && q.options.length >= 2;
  return !hasOptions && q.stem.trim().length >= 20;
}

export function WritingGame() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [grading, setGrading] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const [notice, setNotice] = useState("");
  const [spent, setSpent] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase !== "ready") return;
    const id = window.setInterval(() => setSpent((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase, index]);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorText("");
    try {
      const papers = await apiFetch<PaperSummary[]>("/api/papers");
      const found: Item[] = [];
      const pool = shuffle((papers ?? []).filter((p) => p.status === "ready"));
      const tried = pool.slice(0, MAX_PAPER_TRIES);
      for (const summary of tried) {
        if (found.length > 0) break;
        const paper: PracticePaper = await apiFetch<PracticePaper>(`/api/papers/${summary.id}`);
        for (const section of paper.sections) {
          for (const passage of section.passages) {
            for (const question of passage.questions) {
              if (!isWritingLike(question)) continue;
              found.push({ question, paperTitle: paper.title, level: paper.level });
            }
          }
        }
      }
      if (found.length === 0) {
        setPhase("empty");
        return;
      }
      setItems(found);
      setIndex(0);
      setAnswer("");
      setFeedback("");
      setShowReference(false);
      setNotice("");
      setPhase("ready");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载失败");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const current = items[index];

  const grade = useCallback(async () => {
    if (!current) return;
    if (!answer.trim()) {
      setNotice("先写下你的作答，再让 AI 批改");
      return;
    }
    if (grading) return;

    setGrading(true);
    setFeedback("");
    setNotice("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(withSharecode("/api/ai/grade"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ questionId: current.question.id, answer }),
      });

      if (isPlatformBlock(response, response.headers.get("content-type"))) {
        throw new Error("分享链接不完整，请从分享链接重新进入本页");
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? `批改失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error("当前浏览器不支持流式响应");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setFeedback(acc);
      }
      if (!acc.trim()) setNotice("这次没收到批改内容，可以再点一次");
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setNotice(error instanceof Error ? error.message : "批改失败，请重试");
      }
    } finally {
      setGrading(false);
    }
  }, [answer, current, grading]);

  const next = () => {
    abortRef.current?.abort();
    setIndex((i) => (i + 1) % items.length);
    setAnswer("");
    setFeedback("");
    setShowReference(false);
    setNotice("");
  };

  if (phase === "loading") {
    return (
      <div className="card-soft mt-5 p-10 text-center text-[13px] text-ink-mute">正在找题目…</div>
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

  if (phase === "empty" || !current) {
    return (
      <div className="card-soft mt-5 p-8 text-center">
        <p className="font-serif text-[17px] text-ink">题库里还没有写作/翻译题</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[12.5px] leading-[1.8] text-ink-mute">
          这些题来自卷库的写作与翻译部分。先导入种子题库，或去做一套完整卷子。
        </p>
        <Link href="/" className="mt-5 inline-block rounded-full bg-ink px-5 py-2 text-[13px] text-paper">
          看试卷列表
        </Link>
      </div>
    );
  }

  const isTranslation = (current.question.type ?? "").toLowerCase() === "translation";
  const length = answer.replace(/\s/g, "").length;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft">
          {isTranslation ? "翻译" : "写作"}
        </span>
        <span className="truncate text-[11.5px] text-ink-mute">
          {current.level} · {current.paperTitle}
        </span>
        <span
          className={`ml-auto font-mono text-[11.5px] ${spent > CHALLENGE_SECONDS ? "text-wrong" : "text-ink-mute"}`}
          title="挑战计时（15 分钟）"
        >
          {mmss(spent)} / 15:00
        </span>
        <span className="text-[11.5px] text-ink-mute">
          已写 <span className="font-mono text-ink">{length}</span> 字
        </span>
      </div>

      {/* 字数目标条：给一个「还差多少」的具体手感，比只显示字数更像关卡目标 */}
      <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2 sm:px-6">
        <span className="shrink-0 text-[10.5px] text-ink-mute">
          目标 {targetWords(current.level)} 字
        </span>
        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
          <span
            className="block h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.round((length / targetWords(current.level)) * 100))}%`,
              background: length >= targetWords(current.level) ? "var(--color-correct)" : "var(--color-accent)",
            }}
          />
        </span>
        <span className={`shrink-0 text-[10.5px] ${length >= targetWords(current.level) ? "text-correct" : "text-ink-mute"}`}>
          {length >= targetWords(current.level) ? "已达标" : `差 ${targetWords(current.level) - length} 字`}
        </span>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <p className="text-[10.5px] tracking-[0.2em] text-ink-mute uppercase">
          {isTranslation ? "把下面这段译成英文" : "按题目要求写一段"}
        </p>
        <p className="mt-2 whitespace-pre-wrap font-serif text-[14.5px] leading-[1.85] text-ink">
          {current.question.stem}
        </p>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={isTranslation ? "Write your translation here…" : "Write your response here…"}
          rows={7}
          className="mt-4 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-3 text-[13.5px] leading-[1.8] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
        />

        {notice && <p className="mt-2 text-[12px] text-wrong">{notice}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => void grade()}
            disabled={grading}
            className="min-h-[42px] rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85 disabled:opacity-50"
          >
            {grading ? "批改中…" : "让 AI 批改"}
          </button>
          <button
            type="button"
            onClick={() => setShowReference((v) => !v)}
            className="min-h-[42px] rounded-full border border-line px-4 py-2 text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            {showReference ? "收起参考" : "先看参考"}
          </button>
          <button
            type="button"
            onClick={next}
            className="min-h-[42px] rounded-full border border-line px-4 py-2 text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            换一题
          </button>
        </div>

        {showReference && (
          <div className="mt-4 rounded-[11px] border border-line bg-paper/60 p-3.5">
            <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">参考译本 / 范文</p>
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-[1.85] text-ink-soft">
              {current.question.analysis?.trim() || "这道题暂无参考内容。"}
            </p>
          </div>
        )}

        {feedback && (
          <div className="prose-tight mt-4 rounded-[11px] border border-line bg-paper/60 p-3.5 text-[13px] leading-[1.9] text-ink-soft">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{prepareMarkdown(feedback)}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
