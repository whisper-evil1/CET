"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComboBadge, LevelDots, TimerRing } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { reviewPoolWord, pickDistinct, shortDef, starsFor, useWordPool, type PoolWord } from "./word-pool";

/**
 * 词义消除（移植自参考站的 blast）。
 *
 * 玩法：16 张牌，8 张英文、8 张中文，点英文再点它的中文释义即消除，
 * 连击有额外加分，90 秒内全部消完算通关。
 *
 * 和参考站的两处差异，都是为了让「游戏」和「背词」共用同一份进度：
 *   1. 词源：参考站用全局词库 + 12 关内置题；这里走 /api/vocab/game-pool，
 *      生词本优先、词书兜底，新用户也能开局。
 *   2. 消除一对时把这一对里来自生词本的词写回记忆曲线（grade=good）。
 *      配对失败**不**写回 —— 一次错配分不清是哪个词没记住，硬写会把两个词的
 *      间隔一起拖坏。
 */

const PAIRS = 8;
const SECONDS = 90;
const MISMATCH_MS = 380;

type Tile = {
  key: string;
  pair: number;
  kind: "en" | "zh";
  text: string;
};

function buildTiles(words: PoolWord[]): Tile[] {
  const out: Tile[] = [];
  words.forEach((word, index) => {
    out.push({ key: `e${index}`, pair: index, kind: "en", text: word.word });
    out.push({ key: `z${index}`, pair: index, kind: "zh", text: shortDef(word, 18) });
  });
  return out;
}

function shuffleTiles(tiles: Tile[]): Tile[] {
  const out = tiles.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Phase = "intro" | "playing" | "result";

export function BlastGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [words, setWords] = useState<PoolWord[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [cleared, setCleared] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [clearedCount, setClearedCount] = useState(0);
  const [outOfTime, setOutOfTime] = useState(false);

  const timerRef = useRef<number | null>(null);
  const lockRef = useRef<number | null>(null);

  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (lockRef.current !== null) {
      window.clearTimeout(lockRef.current);
      lockRef.current = null;
    }
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const startRound = useCallback(() => {
    // 按中文牌面去重取词：toward / towards 的释义一模一样，两张同文案的牌
    // 同时在场会让玩家觉得「明明一样却不让配」
    const picked8 = pickDistinct(pool.items, PAIRS, (word) => shortDef(word, 18));
    if (picked8.length < PAIRS) return;
    stopTimers();
    setWords(picked8);
    setTiles(shuffleTiles(buildTiles(picked8)));
    setPicked([]);
    setBad([]);
    setLocked(false);
    setCleared([]);
    setScore(0);
    setCombo(0);
    setPeakCombo(0);
    setClearedCount(0);
    setOutOfTime(false);
    setLeft(SECONDS);
    setPhase("playing");
  }, [pool.items, stopTimers]);

  // 倒计时 ticking 和「时间到 → 结算」分成两个 effect：
  // 在 setLeft 的 updater 里顺手 setPhase 属于「渲染期副作用」，
  // React 严格模式下可能被调用两次，导致结算页闪一下。拆开就没有这个隐患。
  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = window.setInterval(() => {
      setLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing" || left > 0) return;
    stopTimers();
    setOutOfTime(true);
    setPhase("result");
  }, [left, phase, stopTimers]);

  const tileByKey = useMemo(() => new Map(tiles.map((tile) => [tile.key, tile])), [tiles]);

  const onPick = (key: string) => {
    if (phase !== "playing" || locked) return;
    if (cleared.includes(key) || picked.includes(key)) return;

    const next = [...picked, key];
    setPicked(next);
    if (next.length < 2) return;

    const first = tileByKey.get(next[0]);
    const second = tileByKey.get(next[1]);
    if (!first || !second) {
      setPicked([]);
      return;
    }

    if (first.pair === second.pair && first.kind !== second.kind) {
      const nextCleared = [...cleared, first.key, second.key];
      setCleared(nextCleared);
      setPicked([]);
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setPeakCombo((peak) => (nextCombo > peak ? nextCombo : peak));
      setScore((value) => value + 10 + (nextCombo - 1) * 2);
      const nextCount = clearedCount + 1;
      setClearedCount(nextCount);
      reviewPoolWord(words[first.pair], "good");
      if (nextCount >= PAIRS) {
        stopTimers();
        setPhase("result");
      }
      return;
    }

    setCombo(0);
    setLocked(true);
    setBad(next);
    lockRef.current = window.setTimeout(() => {
      setBad([]);
      setPicked([]);
      setLocked(false);
      lockRef.current = null;
    }, MISMATCH_MS);
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          `16 张牌，8 个英文词配 8 条中文释义，${SECONDS} 秒内全部消完算通关。`,
          "先点英文、再点它的中文释义；点错一对不扣分，但连击会断。",
          "连击越长单次得分越高（首对 10 分，之后每对 +2）。",
          "消掉一对时，如果这个词在你的生词本里，会把它的复习间隔往后推一档。",
        ]}
        note={
          pool.ownCount > 0
            ? `本局词源：其中最多 ${Math.min(pool.ownCount, PAIRS)} 个来自你的生词本，其余从四级高频词书补。`
            : "你的生词本还是空的，本局词全部来自四级高频词书 —— 玩完去词书导一批，下次就优先考你自己的词。"
        }
        cta={`开始（${SECONDS} 秒）`}
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const accuracy = Math.round((clearedCount / PAIRS) * 100);
    const clearedPairs = new Set(
      cleared.map((key) => tileByKey.get(key)?.pair).filter((v): v is number => typeof v === "number"),
    );
    const missed = words
      .map((word, index) => ({ word, index }))
      .filter(({ index }) => !clearedPairs.has(index))
      .map(({ word }) => ({ word: word.word, answer: shortDef(word) }));

    return (
      <GameResult
        headline={outOfTime ? "时间到" : "全部消除"}
        subline={
          outOfTime
            ? `还剩 ${PAIRS - clearedCount} 对没消掉，下次先挑认识的词下手。`
            : `8 对全清，最高连击 ${peakCombo}。`
        }
        stars={starsFor(accuracy)}
        stats={[
          { label: "得分", value: String(score) },
          { label: "消除", value: `${clearedCount}/${PAIRS}` },
          { label: "最高连击", value: String(peakCombo) },
        ]}
        wrong={missed}
        wrongTitle="这几个没消掉，记一下："
        onAgain={startRound}
      />
    );
  }

  const dots = tiles.map((tile) => (cleared.includes(tile.key) ? "done-right" : "todo"));

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <ComboBadge combo={combo} />
        <span className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <LevelDots states={dots} />
          </span>
          <span className="font-mono text-[11.5px] g-mute">
            {clearedCount}/{PAIRS}
          </span>
          <TimerRing left={left} total={SECONDS} />
        </span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((tile) => {
            const isCleared = cleared.includes(tile.key);
            const isPicked = picked.includes(tile.key);
            const isBad = bad.includes(tile.key);
            const tone = isCleared
              ? "border-[#cdeee1] bg-[var(--game-green-soft)] text-[#0f766e] opacity-45"
              : isBad
                ? "border-[#f7c9c9] bg-[#fdecec] text-[#b3261e]"
                : isPicked
                  ? "border-[var(--game-blue)] bg-[var(--game-blue-soft)] g-blue-deep"
                  : "border-[#e6e9ef] bg-white g-ink hover:border-[#c9d2e0]";
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => onPick(tile.key)}
                disabled={isCleared}
                aria-pressed={isPicked}
                className={`flex min-h-[62px] items-center justify-center rounded-[12px] border px-2 py-2.5 text-center leading-[1.45] transition-colors ${tone} ${
                  tile.kind === "en"
                    ? "font-mono text-[13px] font-medium break-all"
                    : "text-[12px]"
                }`}
              >
                {tile.text}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11.5px] leading-[1.7] g-mute">
          点一个英文、再点它的中文释义。点错一对不扣分，只断连击。
        </p>
      </div>
    </div>
  );
}
