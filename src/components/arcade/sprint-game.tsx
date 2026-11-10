"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ComboBadge, TimerRing } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import {
  firstSense,
  getBest,
  reviewPoolWord,
  saveBest,
  shuffle,
  shortDef,
  starsFor,
  useWordPool,
  type PoolWord,
} from "./word-pool";

/**
 * 60 秒快问快答（移植自参考站的 sprint）。
 *
 * 三种题型混着出，不给思考缓冲：
 *   0 词 → 义：看单词选释义
 *   1 义 → 词：看释义选单词
 *   2 听音 → 义：只听发音选释义
 * 答对秒切下一题（350ms），答错停 800ms 标出正确答案 —— 节奏本身就是难度。
 */

const SECONDS = 60;
const NEXT_OK_MS = 350;
const NEXT_BAD_MS = 800;
const MAX_COMBO_BONUS = 10;

type QType = 0 | 1 | 2;

type Question = {
  type: QType;
  target: PoolWord;
  /** 4 个选项的展示文本；type=1 展示单词，其余展示释义 */
  options: { key: string; text: string; ok: boolean }[];
};

function buildQuestion(pool: PoolWord[]): Question | null {
  if (pool.length < 4) return null;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const type = Math.floor(Math.random() * 3) as QType;

  // 干扰项按展示文本去重：两个词释义一样时，第二个换成别的词
  const shown = (word: PoolWord) => (type === 1 ? word.word : shortDef(word, 20));
  const seen = new Set([shown(target)]);
  const distractors: PoolWord[] = [];
  for (const other of shuffle(pool.filter((p) => p.word.toLowerCase() !== target.word.toLowerCase()))) {
    const text = shown(other);
    if (seen.has(text) || text.length < 2) continue;
    seen.add(text);
    distractors.push(other);
    if (distractors.length >= 3) break;
  }
  if (distractors.length < 3) return null;

  const options = shuffle(
    [target, ...distractors].map((word, i) => ({
      key: String.fromCharCode(65 + i),
      text: shown(word),
      ok: i === 0,
    })),
  );
  return { type, target, options };
}

type Phase = "intro" | "playing" | "result";

export function SprintGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [question, setQuestion] = useState<Question | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [right, setRight] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [best, setBest] = useState(0);
  const [speakNote, setSpeakNote] = useState("");

  const timerRef = useRef<number | null>(null);
  const nextRef = useRef<number | null>(null);
  const endedRef = useRef(false);

  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (nextRef.current !== null) {
      window.clearTimeout(nextRef.current);
      nextRef.current = null;
    }
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const nextQuestion = useCallback(() => {
    setPicked(null);
    setQuestion(buildQuestion(pool.items));
  }, [pool.items]);

  const startRound = useCallback(() => {
    if (pool.items.length < 4) return;
    stopTimers();
    endedRef.current = false;
    setScore(0);
    setCombo(0);
    setPeakCombo(0);
    setRight(0);
    setAnswered(0);
    setLeft(SECONDS);
    setPicked(null);
    setSpeakNote("");
    setBest(getBest("sprint"));
    setQuestion(buildQuestion(pool.items));
    setPhase("playing");
  }, [pool.items, stopTimers]);

  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = window.setInterval(() => {
      setLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return stopTimers;
  }, [phase, stopTimers]);

  useEffect(() => {
    if (phase !== "playing" || left > 0 || endedRef.current) return;
    endedRef.current = true;
    stopTimers();
    setBest((b) => {
      const recorded = saveBest("sprint", score);
      return recorded ? score : b;
    });
    setPhase("result");
  }, [left, phase, score, stopTimers]);

  const pick = (option: { key: string; text: string; ok: boolean }) => {
    if (!question || picked !== null || endedRef.current) return;
    setPicked(option.key);
    setAnswered((n) => n + 1);
    reviewPoolWord(question.target, option.ok ? "good" : "again");

    let nextCombo = 0;
    if (option.ok) {
      nextCombo = combo + 1;
      setCombo(nextCombo);
      setPeakCombo((peak) => (nextCombo > peak ? nextCombo : peak));
      setScore((s) => s + 10 + Math.min(MAX_COMBO_BONUS, nextCombo * 2));
      setRight((n) => n + 1);
    } else {
      setCombo(0);
    }

    const delay = option.ok ? NEXT_OK_MS : NEXT_BAD_MS;
    nextRef.current = window.setTimeout(() => {
      if (endedRef.current) return;
      nextQuestion();
    }, delay);
  };

  const replayAudio = async (word: string) => {
    const channel = await speakText(word, "en", 0.9);
    setSpeakNote(channel === "failed" ? "这台设备放不出声音" : "");
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          `60 秒极限连答：看词选义、看义选词、听音选义三种题型混着来。`,
          "答对立刻切下一题；答错会停一下标出正确答案，节奏慢半拍。",
          "连击越长单题加分越高（10~20 分），断连就得从头攒。",
          "答完的词照常写回记忆曲线 —— 这一分钟也是正经复习。",
        ]}
        note={`本机最佳：${getBest("sprint")} 分。`}
        cta="开始（60 秒）"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const accuracy = answered === 0 ? 0 : Math.round((right / answered) * 100);
    return (
      <GameResult
        headline="时间到"
        subline={`60 秒答对 ${right} 题，正确率 ${accuracy}%，最高连击 ${peakCombo}。`}
        stars={starsFor(accuracy)}
        stats={[
          { label: "得分", value: String(score) },
          { label: "答对", value: `${right}/${Math.max(answered, 1)}` },
          { label: "本机最佳", value: String(best) },
        ]}
        onAgain={startRound}
        againLabel="再来一局"
      />
    );
  }

  if (!question) return <GameLoading text="正在出题…" />;

  const stem =
    question.type === 0 ? (
      <p className="mt-3 break-words font-serif text-[30px] leading-tight g-ink sm:text-[36px]">
        {question.target.word}
      </p>
    ) : question.type === 1 ? (
      <p className="mt-3 text-[16px] leading-[1.75] g-ink">{shortDef(question.target, 48)}</p>
    ) : (
      <div className="mt-4 flex flex-col items-center">
        <button
          type="button"
          onClick={() => void replayAudio(question.target.word)}
          aria-label="播放单词发音"
          className="flex h-[64px] w-[64px] items-center justify-center rounded-full border border-[#d7e3fb] bg-[var(--game-blue-soft)] transition-colors hover:border-[var(--game-blue)]"
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
            <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" fill="var(--game-blue)" stroke="var(--game-blue-deep)" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8M17.8 6.2a8 8 0 0 1 0 11.6" fill="none" stroke="var(--game-blue)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="mt-2 text-[11.5px] g-mute">听发音，选释义（可反复点）</span>
      </div>
    );

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <ComboBadge combo={combo} />
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11.5px] g-mute">
            {right}/{answered}
          </span>
          <TimerRing left={left} total={SECONDS} />
        </span>
      </div>

      <div className="px-4 py-6 text-center sm:px-6 sm:py-8">
        <p className="text-[10.5px] tracking-[0.22em] g-mute uppercase">
          {question.type === 0 ? "选出正确释义" : question.type === 1 ? "选出对应的单词" : "听音辨义"}
        </p>
        {stem}

        <ul className="mt-6 grid gap-2 text-left sm:grid-cols-2">
          {question.options.map((option) => {
            const isAnswer = option.ok;
            const isPicked = picked === option.key;
            const revealed = picked !== null;
            const tone = !revealed
              ? "border-[#e6e9ef] bg-white g-ink hover:border-[var(--game-blue)]"
              : isAnswer
                ? "border-[#0f766e] bg-[var(--game-green-soft)] text-[#0f766e]"
                : isPicked
                  ? "border-[#f7c9c9] bg-[#fdecec] text-[#b3261e]"
                  : "border-[#eef1f6] bg-white g-mute opacity-60";
            return (
              <li key={option.key}>
                <button
                  type="button"
                  onClick={() => pick(option)}
                  disabled={revealed}
                  className={`flex min-h-[52px] w-full items-start gap-2.5 rounded-[11px] border px-3.5 py-3 text-left text-[13px] leading-[1.55] transition-colors ${tone} ${
                    question.type === 1 ? "font-mono" : ""
                  }`}
                >
                  <span className="mt-[1px] shrink-0 font-mono text-[11px] opacity-70">{option.key}</span>
                  <span className="min-w-0 flex-1">{option.text}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {picked !== null && (
          <p
            className={`mt-4 text-[12.5px] ${
              question.options.find((o) => o.key === picked)?.ok ? "text-[#0f766e]" : "text-[#b3261e]"
            }`}
          >
            {question.options.find((o) => o.key === picked)?.ok
              ? "对了"
              : `错了 · ${question.target.word} = ${firstSense(question.target)}`}
          </p>
        )}
        {speakNote && <p className="mt-2 text-[11.5px] text-[#b3261e]">{speakNote}</p>}
      </div>
    </div>
  );
}
