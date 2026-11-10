"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LevelDots } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import { reviewPoolWord, sample, shortDef, shuffle, starsFor, useWordPool, type PoolWord } from "./word-pool";

/**
 * 听音辨词（移植自参考站的 listen）。
 *
 * 玩法：听一个单词的发音，从 4 条中文释义里选对的，共 10 轮。
 *
 * 发声顺序沿用 src/lib/pronounce.ts：先试有道/百度的音频文件，
 * 取不到再退 Web Speech，两条都不行就明确告诉用户「听不到，可以看音标」——
 * 参考站只用 speechSynthesis，在部分安卓内置浏览器上点了没声音也没提示。
 *
 * 自动播放的坑：浏览器要求「有声播放」发生在用户手势之后。所以第一轮的发音
 * 直接在「开始」按钮的点击回调里播；之后每一轮都由「点选项」触发，手势链条不断。
 */

const ROUNDS = 10;
const NEXT_MS = 900;

type Option = { key: string; text: string; ok: boolean };

type Round = {
  target: PoolWord;
  options: Option[];
};

function buildRounds(pool: PoolWord[]): Round[] {
  const picked = sample(pool, ROUNDS);
  const rounds: Round[] = [];

  for (const target of picked) {
    const others = shuffle(pool.filter((word) => word.word.toLowerCase() !== target.word.toLowerCase()));
    const seen = new Set([shortDef(target, 20)]);
    const distractors: string[] = [];

    for (const other of others) {
      const text = shortDef(other, 20);
      if (seen.has(text) || text.length < 2) continue;
      seen.add(text);
      distractors.push(text);
      if (distractors.length >= 3) break;
    }
    if (distractors.length < 3) continue;

    const options = shuffle(
      [shortDef(target, 20), ...distractors].map((text, i) => ({
        key: String.fromCharCode(65 + i),
        text,
        ok: i === 0,
      })),
    );
    rounds.push({ target, options });
  }

  return rounds;
}

type Phase = "intro" | "playing" | "result";

export function ListenGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [wrongList, setWrongList] = useState<{ word: string; answer: string }[]>([]);
  const [speakNote, setSpeakNote] = useState("");
  const [playingAudio, setPlayingAudio] = useState(false);

  const nextRef = useRef<number | null>(null);

  const clearNext = useCallback(() => {
    if (nextRef.current !== null) {
      window.clearTimeout(nextRef.current);
      nextRef.current = null;
    }
  }, []);

  useEffect(() => clearNext, [clearNext]);

  const current = rounds[index];

  const play = useCallback(async (word: string) => {
    setPlayingAudio(true);
    const channel = await speakText(word, "en", 0.85);
    setPlayingAudio(false);
    setSpeakNote(
      channel === "failed" ? "这台设备放不出声音，可以先看音标和首字母，再选释义。" : "",
    );
  }, []);

  const startRound = useCallback(() => {
    const built = buildRounds(pool.items);
    if (built.length === 0) return;
    clearNext();
    setRounds(built);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setResults([]);
    setWrongList([]);
    setSpeakNote("");
    setPhase("playing");
    // 第一轮的音在手势回调里播，避免被自动播放策略静默拦掉
    void play(built[0].target.word);
  }, [pool.items, clearNext, play]);

  const decide = (option: Option) => {
    if (!current || picked !== null) return;
    setPicked(option.key);
    setResults((list) => list.concat([option.ok]));

    if (option.ok) {
      setCorrect((n) => n + 1);
      reviewPoolWord(current.target, "good");
    } else {
      reviewPoolWord(current.target, "again");
      setWrongList((list) =>
        list.some((item) => item.word === current.target.word)
          ? list
          : list
              .concat([
                { word: current.target.word, answer: shortDef(current.target, 32) },
              ])
              .slice(0, 12),
      );
    }

    const isLast = index + 1 >= rounds.length;
    clearNext();
    nextRef.current = window.setTimeout(() => {
      setPicked(null);
      if (isLast) {
        setPhase("result");
        return;
      }
      const nextIndex = index + 1;
      setIndex(nextIndex);
      void play(rounds[nextIndex].target.word);
    }, NEXT_MS);
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          `共 ${ROUNDS} 轮：听单词发音，从 4 条中文释义里选出正确的那条。`,
          "每轮都会自动念一遍，没听清可以点「再听一遍」。",
          "答对计入正确率，答错会把正确答案标出来，本局结束统一回顾。",
          "答完一题会把这个词写回记忆曲线（仅限你生词本里的词）。",
        ]}
        note={
          pool.ownCount > 0
            ? `本局词源：其中最多 ${Math.min(pool.ownCount, ROUNDS)} 个来自你的生词本，其余从四级高频词书补。`
            : "生词本为空时全部取自四级高频词书，所以这局听到的都是四六级高频词。"
        }
        cta="开始听力"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const accuracy = results.length === 0 ? 0 : Math.round((correct / results.length) * 100);
    return (
      <GameResult
        headline={correct === results.length ? "全对" : "本局结束"}
        subline={`答对 ${correct} / ${results.length} 轮，正确率 ${accuracy}%。`}
        stars={starsFor(accuracy)}
        stats={[
          { label: "答对", value: `${correct}/${Math.max(results.length, 1)}` },
          { label: "正确率", value: `${accuracy}%` },
          { label: "总轮数", value: String(Math.max(results.length, 1)) },
        ]}
        wrong={wrongList}
        wrongTitle="听错的词，已经排到下一轮复习："
        onAgain={startRound}
      />
    );
  }

  if (!current) return null;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          第 <b className="g-ink">{index + 1}</b>/{rounds.length} 轮
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          答对 <b className="g-ink">{correct}</b>
        </span>
        <span className="ml-auto hidden sm:inline-flex">
          <LevelDots
            states={rounds.map((_, i) => {
              if (i < results.length) return results[i] ? "done-right" : "done-wrong";
              return i === index ? "current" : "todo";
            })}
          />
        </span>
      </div>

      <div className="px-4 py-6 text-center sm:px-6 sm:py-8">
        <p className="text-[10.5px] tracking-[0.22em] g-mute uppercase">听发音，选释义</p>

        <button
          type="button"
          onClick={() => void play(current.target.word)}
          aria-label="播放单词发音"
          className="mx-auto mt-4 flex h-[76px] w-[76px] items-center justify-center rounded-full border border-[#d7e3fb] bg-[var(--game-blue-soft)] transition-colors hover:border-[var(--game-blue)]"
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden="true">
            <path
              d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"
              fill="var(--game-blue)"
              stroke="var(--game-blue-deep)"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            <path
              d="M15.4 8.6a4.6 4.6 0 0 1 0 6.8M17.8 6.2a8 8 0 0 1 0 11.6"
              fill="none"
              stroke="var(--game-blue)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <p className="mt-2 font-mono text-[11.5px] g-mute">
          {playingAudio ? "正在播放…" : "点喇叭再听一遍"}
        </p>

        <ul className="mt-5 grid gap-2 text-left sm:grid-cols-2">
          {current.options.map((option) => {
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
                  onClick={() => decide(option)}
                  disabled={revealed}
                  className={`flex min-h-[52px] w-full items-start gap-2.5 rounded-[11px] border px-3.5 py-3 text-left text-[13px] leading-[1.55] transition-colors ${tone}`}
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
              current.options.find((o) => o.key === picked)?.ok ? "text-[#0f766e]" : "text-[#b3261e]"
            }`}
          >
            {current.options.find((o) => o.key === picked)?.ok
              ? `对了 · 这个词是 ${current.target.word}`
              : `错了 · 正确答案是 ${shortDef(current.target, 32)}（${current.target.word}）`}
          </p>
        )}

        {speakNote && <p className="mt-2 text-[11.5px] text-[#b3261e]">{speakNote}</p>}
      </div>
    </div>
  );
}
