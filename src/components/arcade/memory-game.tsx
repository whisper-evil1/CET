"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LevelDots } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { reviewPoolWord, pickDistinct, shortDef, starsFor, useWordPool, type PoolWord } from "./word-pool";

/**
 * 翻牌配对（移植自参考站的 memory）。
 *
 * 玩法：12 张背面朝上的牌，6 对「英文 ↔ 中文」，一次翻两张，
 * 对上就留在正面，对不上 700ms 后盖回去。步数越少分越高。
 *
 * 和参考站的差异：
 *   - 牌面文案统一走 shortDef()，中文释义最多 18 字（离线词库原文太长，
 *     翻牌卡片只有半个屏幕宽，放不下两三行）。
 *   - 翻对一对时把该词写回记忆曲线（grade=good），翻错不写（分不清是哪个词）。
 *   - 不用 3D 翻转（rotateY + backface-visibility）：部分安卓 WebView 上
 *     backface-visibility 会把正反面一起隐藏，牌面直接消失。这里改用「内容切换 +
 *     高亮描边」，效果差一点，但任何内核都不会白屏。
 */

const PAIRS = 6;
const FLIP_BACK_MS = 700;

type Card = {
  key: string;
  pair: number;
  kind: "en" | "zh";
  text: string;
};

function buildCards(words: PoolWord[]): Card[] {
  const cards: Card[] = [];
  words.forEach((word, index) => {
    cards.push({ key: `e${index}`, pair: index, kind: "en", text: word.word });
    cards.push({ key: `z${index}`, pair: index, kind: "zh", text: shortDef(word, 18) });
  });
  return cards;
}

function shuffled<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Phase = "intro" | "playing" | "result";

export function MemoryGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [words, setWords] = useState<PoolWord[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [flipped, setFlipped] = useState<string[]>([]);
  const [matched, setMatched] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [locked, setLocked] = useState(false);

  const lockRef = useRef<number | null>(null);

  const clearLock = useCallback(() => {
    if (lockRef.current !== null) {
      window.clearTimeout(lockRef.current);
      lockRef.current = null;
    }
  }, []);

  useEffect(() => clearLock, [clearLock]);

  const startRound = useCallback(() => {
    // 与词义消除同一条规则：中文牌面相同的词不同时上场，避免「看着一样却不让配」
    const picked = pickDistinct(pool.items, PAIRS, (word) => shortDef(word, 18));
    if (picked.length < PAIRS) return;
    clearLock();
    setWords(picked);
    setCards(shuffled(buildCards(picked)));
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setSeconds(0);
    setLocked(false);
    setPhase("playing");
  }, [pool.items, clearLock]);

  // 计时只是给结算页一个「用了多久」的参考，不参与判分（判分看步数）
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const onFlip = (key: string) => {
    if (phase !== "playing" || locked) return;
    if (matched.includes(key) || flipped.includes(key)) return;

    const next = [...flipped, key];
    setFlipped(next);
    if (next.length < 2) return;

    const a = cards.find((card) => card.key === next[0]);
    const b = cards.find((card) => card.key === next[1]);
    if (!a || !b) {
      setFlipped([]);
      return;
    }

    setMoves((value) => value + 1);

    if (a.pair === b.pair && a.kind !== b.kind) {
      const nextMatched = [...matched, a.key, b.key];
      setMatched(nextMatched);
      setFlipped([]);
      reviewPoolWord(words[a.pair], "good");
      if (nextMatched.length >= PAIRS * 2) setPhase("result");
      return;
    }

    setLocked(true);
    lockRef.current = window.setTimeout(() => {
      setFlipped([]);
      setLocked(false);
      lockRef.current = null;
    }, FLIP_BACK_MS);
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          `12 张牌、${PAIRS} 对「英文 ↔ 中文」，一次翻两张，对上就留在正面。`,
          "对不上会在 700 毫秒后自动盖回去，记住它们的位置。",
          "步数越少得分越高：满分 120，每多走一步扣 6 分。",
          "翻对一对时，这个词的复习间隔会往后推一档（仅限你生词本里的词）。",
        ]}
        note={
          pool.ownCount > 0
            ? `本局词源：其中最多 ${Math.min(pool.ownCount, PAIRS)} 个来自你的生词本，其余从四级高频词书补。`
            : "生词本为空时全部取自四级高频词书。去词书导一批，下次就优先考你自己的词。"
        }
        cta="开始翻牌"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const score = Math.max(10, 120 - moves * 6);
    const matchedPairs = matched.length / 2;
    const missed = words
      .map((word, index) => ({ word, index }))
      .filter(({ index }) => !cards.some((c) => c.pair === index && matched.includes(c.key)))
      .map(({ word }) => ({ word: word.word, answer: shortDef(word) }));

    return (
      <GameResult
        headline="全部配对完成"
        subline={`${matchedPairs} 对全翻出来，用了 ${moves} 步、${seconds} 秒。`}
        stars={starsFor(moves <= 8 ? 100 : moves <= 12 ? 80 : moves <= 16 ? 60 : 40)}
        stats={[
          { label: "得分", value: String(score) },
          { label: "步数", value: String(moves) },
          { label: "用时", value: `${seconds}s` },
        ]}
        wrong={missed}
        wrongTitle="翻到最后才凑上的词，再看一眼："
        onAgain={startRound}
      />
    );
  }

  const dots = cards.map((card) => (matched.includes(card.key) ? "done-right" : "todo"));

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          步数 <b className="g-ink">{moves}</b>
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          配对 <b className="g-ink">{matched.length / 2}</b>/{PAIRS}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <LevelDots states={dots} />
          </span>
          <span className="font-mono text-[11.5px] g-mute">{seconds}s</span>
        </span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {cards.map((card) => {
            const isMatched = matched.includes(card.key);
            const isOpen = isMatched || flipped.includes(card.key);
            const tone = isMatched
              ? "border-[#cdeee1] bg-[var(--game-green-soft)] text-[#0f766e]"
              : isOpen
                ? "border-[var(--game-blue)] bg-[var(--game-blue-soft)] g-blue-deep"
                : "border-[#e6e9ef] bg-[#f7f9fc] g-mute hover:border-[#c9d2e0]";
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => onFlip(card.key)}
                disabled={isMatched}
                aria-label={isOpen ? `${card.kind === "en" ? "英文" : "中文"}：${card.text}` : "未翻开的牌"}
                className={`flex h-[74px] items-center justify-center rounded-[12px] border px-2 text-center leading-[1.4] transition-colors ${tone} ${
                  isOpen
                    ? card.kind === "en"
                      ? "font-mono text-[12.5px] font-medium break-all"
                      : "text-[11.5px]"
                    : "text-[16px]"
                }`}
              >
                {isOpen ? card.text : "?"}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11.5px] leading-[1.7] g-mute">
          翻两张找配对，对不上会自己盖回去。步数越少，结算星级越高。
        </p>
      </div>
    </div>
  );
}
