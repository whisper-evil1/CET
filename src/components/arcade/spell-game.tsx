"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hearts } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import {
  MAX_HEARTS,
  reviewPoolWord,
  sample,
  shortDef,
  spellHint,
  starsFor,
  useWordPool,
  type PoolWord,
} from "./word-pool";

/**
 * 拼写达人（移植自参考站的 spell）。
 *
 * 玩法：看中文释义 + 首尾字母提示，把单词拼出来。3 条命，拼错一次掉一条，
 * 命用完就收关；答对 8 个即通关。
 *
 * 和参考站的差异：
 *   - 参考站把「得分满 40」当通关条件，玩起来有点莫名其妙（拼对不同长度的词
 *     加分差不多，40 分大概 7~9 个词）。这里直接写「拼对 8 个词」，
 *     目标看得见，结算也好解释。
 *   - 判对不收大小写与首尾空格（输入框里顺手多打一个空格不算错），
 *     但**不接受**少一个字母 —— 拼写题的意义就在这儿。
 *   - 拼对写 good、拼错写 again，都落到同一个 /api/vocab/:id/review 上。
 */

const GOAL = 8;
const FEEDBACK_MS = 850;
const REVEAL_MS = 1300;
const POOL_TAKE = 12;

type Phase = "intro" | "playing" | "result";

export function SpellGame() {
  const pool = useWordPool(40);

  const [phase, setPhase] = useState<Phase>("intro");
  const [queue, setQueue] = useState<PoolWord[]>([]);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [lives, setLives] = useState(MAX_HEARTS);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [wrongList, setWrongList] = useState<{ word: string; answer: string }[]>([]);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(false);
  const [speakNote, setSpeakNote] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const current = queue[index];

  const startRound = useCallback(() => {
    const picked = sample(pool.items, POOL_TAKE);
    if (picked.length === 0) return;
    clearTimer();
    setQueue(picked);
    setIndex(0);
    setValue("");
    setLives(MAX_HEARTS);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setCorrect(0);
    setAttempts(0);
    setWrongList([]);
    setFlash(null);
    setMessage("");
    setReveal(false);
    setPhase("playing");
  }, [pool.items, clearTimer]);

  // 每题自动聚焦；用 select 而不是 focus，重新开始时旧值会被整段选中，直接覆盖
  useEffect(() => {
    if (phase !== "playing" || !current) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [phase, index, current]);

  const speak = async () => {
    if (!current) return;
    const channel = await speakText(current.word, "en", 0.9);
    setSpeakNote(channel === "failed" ? "当前浏览器放不出声音，可以看首尾字母提示拼" : "");
  };

  const submit = () => {
    if (phase !== "playing" || !current || reveal) return;
    const guess = value.trim().toLowerCase();
    if (!guess) return;

    setAttempts((n) => n + 1);

    if (guess === current.word.trim().toLowerCase()) {
      const nextStreak = streak + 1;
      const gain = 4 + Math.min(4, nextStreak);
      const nextCorrect = correct + 1;
      setStreak(nextStreak);
      setBestStreak((best) => (nextStreak > best ? nextStreak : best));
      setScore((s) => s + gain);
      setCorrect(nextCorrect);
      setFlash("ok");
      setMessage(`拼对了 +${gain} 分，连对 ${nextStreak}`);
      reviewPoolWord(current, "good");
      void speakText(current.word, "en", 0.9);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setFlash(null);
        setMessage("");
        if (nextCorrect >= GOAL || index + 1 >= queue.length) {
          setPhase("result");
          return;
        }
        setIndex((i) => i + 1);
        setValue("");
      }, FEEDBACK_MS);
      return;
    }

    const nextLives = Math.max(0, lives - 1);
    setLives(nextLives);
    setStreak(0);
    setFlash("bad");
    reviewPoolWord(current, "again");
    setWrongList((list) =>
      list.some((item) => item.word === current.word)
        ? list
        : list.concat([{ word: current.word, answer: shortDef(current) }]).slice(0, 12),
    );

    if (nextLives <= 0) {
      setReveal(true);
      setMessage(`命用完了。正确答案是 ${current.word}`);
      clearTimer();
      timerRef.current = window.setTimeout(() => setPhase("result"), REVEAL_MS);
      return;
    }

    setMessage(`差一点，还剩 ${nextLives} 条命 —— 首尾字母能帮你`);
    timerRef.current = window.setTimeout(() => {
      setFlash(null);
      inputRef.current?.select();
    }, 600);
  };

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          `看中文释义 + 首尾字母提示，把单词完整拼出来，拼对 ${GOAL} 个即通关。`,
          "3 条命：拼错一次掉一条，命用完这一关就结束。",
          "拼对得分随连对上升（4~8 分），拼错清零重来。",
          "拿不准就点「听发音」，听一遍再拼。",
        ]}
        note={
          pool.ownCount > 0
            ? `本局词源：最多 ${Math.min(pool.ownCount, GOAL)} 个来自你的生词本，其余从四级高频词书补。`
            : "生词本为空时全部取自四级高频词书。拼错的词推荐你先导进生词本，下一轮就会重点考它。"
        }
        cta="开始拼写"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const accuracy = attempts === 0 ? 0 : Math.round((correct / attempts) * 100);
    return (
      <GameResult
        headline={correct >= GOAL ? "拼写达人达成" : "这一关结束了"}
        subline={
          correct >= GOAL
            ? `连对最长 ${bestStreak} 个，拼写正确率 ${accuracy}%。`
            : `拼对 ${correct} 个，还差 ${Math.max(0, GOAL - correct)} 个到通关线。`
        }
        stars={starsFor(accuracy)}
        stats={[
          { label: "得分", value: String(score) },
          { label: "拼对", value: `${correct}/${Math.max(attempts, 1)}` },
          { label: "最长连对", value: String(bestStreak) },
        ]}
        wrong={wrongList}
        wrongTitle="拼错过的词，已经排到下一轮复习："
        onAgain={startRound}
      />
    );
  }

  if (!current) return null;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <Hearts left={lives} total={MAX_HEARTS} />
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          连对 <b className="g-ink">{streak}</b>
        </span>
        <span className="ml-auto font-mono text-[11.5px] g-mute">
          {correct}/{GOAL}
        </span>
      </div>

      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-[10.5px] tracking-[0.22em] g-mute uppercase">根据释义拼出单词</p>
        <p className="mt-2 text-[15px] leading-[1.7] g-ink sm:text-[16px]">{shortDef(current, 48)}</p>
        <p className="mt-2 font-mono text-[12.5px] tracking-[0.12em] g-mute">
          首尾提示：{spellHint(current.word)}
          {current.phonetic ? `　/ ${current.phonetic} /` : ""}
        </p>

        <div className="mt-5 flex flex-wrap items-stretch gap-2">
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="在这里拼写，回车提交"
            className={`min-w-0 flex-1 rounded-[10px] border bg-white px-3 py-2.5 font-mono text-[14px] outline-none transition-colors ${
              flash === "ok"
                ? "border-[#0f766e] text-[#0f766e]"
                : flash === "bad"
                  ? "border-[#f7c9c9] text-[#b3261e]"
                  : "border-[#e6e9ef] g-ink focus:border-[var(--game-blue)]"
            }`}
          />
          <button type="button" onClick={submit} className="btn-game shrink-0">
            提交
          </button>
          <button type="button" onClick={() => void speak()} className="btn-game-ghost shrink-0">
            听发音
          </button>
        </div>

        {message && (
          <p
            className={`mt-3 text-[12.5px] ${
              flash === "ok" ? "text-[#0f766e]" : flash === "bad" ? "text-[#b3261e]" : "g-mute"
            }`}
          >
            {message}
          </p>
        )}
        {reveal && <p className="mt-1 font-mono text-[13px] g-ink">{current.word}</p>}
        {speakNote && <p className="mt-2 text-[11.5px] text-[#b3261e]">{speakNote}</p>}
      </div>
    </div>
  );
}
