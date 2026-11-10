"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ComboBadge, TimerRing } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import {
  firstSense,
  getBest,
  reviewPoolWord,
  sample,
  saveBest,
  starsFor,
  useWordPool,
  type PoolWord,
} from "./word-pool";

/**
 * 单词打地鼠（移植自参考站的 mole）。
 *
 * 玩法：顶部给一条中文释义，9 个洞里随机冒出举着单词的地鼠，
 * 在它缩回去之前敲中「释义对得上」的那只。60 秒限时，连击加分。
 *
 * 实现和参考站的差异：
 *   - 参考站给每只地鼠挂独立的 setTimeout 收回；这里统一用一条 120ms 的
 *     tick 扫「到期收回」——9 个洞 × 60 秒，独立 timer 会堆出几百个
 *     setTimeout，切页/重开时容易漏清，tick 扫描只有一个定时器要管。
 *   - 敲中时把该词写回记忆曲线；敲错不写（一次错敲分不清是哪个词没记住）。
 */

const SECONDS = 60;
const MOLE_LIFETIME_MS = 1500;
const HIT_MS = 250;
const SPAWN_INTERVAL_MS = 750;
const WORDS_NEEDED = 12;
const MAX_COMBO_BONUS = 10;

type Slot = { key: number; word: string; hit: boolean; until: number };

type Phase = "intro" | "playing" | "result";

export function MoleGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [words, setWords] = useState<PoolWord[]>([]);
  const [slots, setSlots] = useState<(Slot | null)[]>(new Array(9).fill(null));
  const [target, setTarget] = useState<PoolWord | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [hits, setHits] = useState(0);
  const [misses, setMisses] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [best, setBest] = useState(0);
  const [flash, setFlash] = useState<string>("");

  const wordsRef = useRef<PoolWord[]>([]);
  const targetRef = useRef<PoolWord | null>(null);
  const endedRef = useRef(false);
  const keyRef = useRef(1);
  const slotTimersRef = useRef<number[]>([]);

  const clearAll = useCallback(() => {
    for (const id of slotTimersRef.current) window.clearTimeout(id);
    slotTimersRef.current = [];
  }, []);

  useEffect(() => clearAll, [clearAll]);

  const pickTarget = useCallback(() => {
    const list = wordsRef.current;
    if (list.length === 0) return null;
    const next = list[Math.floor(Math.random() * list.length)];
    targetRef.current = next;
    setTarget(next);
    // 释义出来时顺带念一遍词：答对主要靠看，发音是辅助记忆
    void speakText(next.word, "en", 0.95);
    return next;
  }, []);

  const startRound = useCallback(() => {
    const picked = sample(pool.items, WORDS_NEEDED);
    if (picked.length < 4) return;
    clearAll();
    endedRef.current = false;
    wordsRef.current = picked;
    setWords(picked);
    setSlots(new Array(9).fill(null));
    setScore(0);
    setCombo(0);
    setPeakCombo(0);
    setHits(0);
    setMisses(0);
    setLeft(SECONDS);
    setFlash("");
    setBest(getBest("mole"));
    setPhase("playing");
    pickTarget();
  }, [pool.items, clearAll, pickTarget]);

  /* 主循环 tick：每 120ms 收回到期的地鼠。只有一个定时器，切页/重开不会漏清 */
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      if (endedRef.current) return;
      const now = Date.now();
      setSlots((list) => {
        let changed = false;
        const next = list.map((slot) => {
          if (slot && now >= slot.until) {
            changed = true;
            return null;
          }
          return slot;
        });
        return changed ? next : list;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* 刷怪：每 750ms 挑一个空洞。45% 概率是目标词，其余是干扰词 */
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      if (endedRef.current) return;
      setSlots((list) => {
        const empty: number[] = [];
        list.forEach((slot, i) => {
          if (!slot) empty.push(i);
        });
        if (empty.length === 0) return list;
        const hole = empty[Math.floor(Math.random() * empty.length)];
        const targetNow = targetRef.current;
        const useTarget = targetNow && Math.random() < 0.45;
        const word = useTarget
          ? targetNow.word
          : wordsRef.current[Math.floor(Math.random() * wordsRef.current.length)]?.word ?? "";
        if (!word) return list;
        const next = list.slice();
        next[hole] = {
          key: keyRef.current++,
          word,
          hit: false,
          until: Date.now() + MOLE_LIFETIME_MS,
        };
        return next;
      });
    }, SPAWN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* 倒计时 */
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setInterval(() => {
      setLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing" || left > 0 || endedRef.current) return;
    endedRef.current = true;
    clearAll();
    setBest((b) => {
      const recorded = saveBest("mole", score);
      return recorded ? score : b;
    });
    setPhase("result");
  }, [left, phase, score, clearAll]);

  const hit = (index: number) => {
    if (phase !== "playing" || endedRef.current) return;
    const slot = slots[index];
    if (!slot || slot.hit) return;

    const targetNow = targetRef.current;
    const isRight = targetNow && slot.word.toLowerCase() === targetNow.word.toLowerCase();

    const next = slots.slice();
    next[index] = { ...slot, hit: true, until: Date.now() + HIT_MS };
    setSlots(next);

    if (isRight) {
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setPeakCombo((peak) => (nextCombo > peak ? nextCombo : peak));
      setScore((s) => s + 10 + Math.min(MAX_COMBO_BONUS, nextCombo * 2));
      setHits((n) => n + 1);
      setFlash("");
      reviewPoolWord(targetNow, "good");
      pickTarget();
    } else {
      setCombo(0);
      setMisses((n) => n + 1);
      setFlash("打错了，连击断了");
    }
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "顶部给一条释义，9 个洞里会冒出举着单词的地鼠。",
          "在它缩回去之前（1.5 秒）敲中「释义对得上」的那只。",
          "连击越长单次得分越高（10~20 分），打错清零重来。",
          "45% 的地鼠是答案本鼠，其余是干扰 —— 别见词就敲。",
        ]}
        note={`本机最佳：${getBest("mole")} 分。生词本为空时全部取自四级高频词书。`}
        cta="开始（60 秒）"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const accuracy = hits + misses === 0 ? 0 : Math.round((hits / (hits + misses)) * 100);
    return (
      <GameResult
        headline="时间到"
        subline={`敲中 ${hits} 只、打错 ${misses} 次，正确率 ${accuracy}%。`}
        stars={starsFor(accuracy)}
        stats={[
          { label: "得分", value: String(score) },
          { label: "最高连击", value: String(peakCombo) },
          { label: "本机最佳", value: String(best) },
        ]}
        onAgain={startRound}
      />
    );
  }

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <ComboBadge combo={combo} />
        <span className="ml-auto">
          <TimerRing left={left} total={SECONDS} />
        </span>
      </div>

      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <div className="rounded-[12px] g-blue-soft-bg px-4 py-3 text-center">
          <p className="text-[11.5px] g-blue-deep">敲中释义为下面这条的地鼠</p>
          <p className="mt-1 text-[16px] font-medium g-ink">「{target ? firstSense(target) : "…"}」</p>
        </div>

        <div className="mx-auto mt-4 grid max-w-[420px] grid-cols-3 gap-2.5">
          {slots.map((slot, index) => {
            const raised = Boolean(slot) && !slot?.hit;
            return (
              <button
                key={index}
                type="button"
                onClick={() => hit(index)}
                aria-label={slot ? `地鼠：${slot.word}` : "空地鼠洞"}
                className={`relative flex h-[76px] items-end justify-center overflow-hidden rounded-[14px] border transition-colors sm:h-[84px] ${
                  slot?.hit
                    ? "border-[#f7c9c9] bg-[#fdecec]"
                    : raised
                      ? "border-[#e5d8bd] bg-[#fdf6e7]"
                      : "border-[#e6e9ef] bg-[#f4f6f9]"
                }`}
              >
                {/* 洞口：地鼠从这后面冒出来 */}
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-1/2 h-[14px] w-[70%] -translate-x-1/2 rounded-t-[999px] bg-[#dfe3ea]"
                />
                {slot && (
                  <span
                    className={`relative mb-[10px] max-w-full truncate rounded-[9px] px-2.5 py-1.5 font-mono text-[12.5px] font-medium ${
                      slot.hit ? "bg-[#f7c9c9] text-[#b3261e] line-through" : "bg-[#8d6e4f] text-white"
                    }`}
                  >
                    {slot.word}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-3 min-h-[20px] text-center text-[12px] text-[#b3261e]">{flash}</p>
        <p className="text-center text-[11.5px] g-mute">
          词库里这一局有 {words.length} 个词，地鼠最多同时冒 9 只。
        </p>
      </div>
    </div>
  );
}
