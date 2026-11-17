"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameIntro, GameResult } from "./match-ui";
import { DICTATION_SENTENCES, type DictationSentence } from "./dictation-data";
import { speech, type SpeechLine } from "@/lib/speech";
import { useSpeech } from "@/components/practice/listening-player";

/**
 * 听写填空（新关卡）。
 *
 * 为什么做这一关：现有十几个关卡里，真正练「听觉 → 拼写」的只有听音辨词（单词级），
 * 句子级听写完全没有；而听写是最能把「听不清」暴露成「写不对」的练法。
 *
 * 音频与做题共用 src/lib/speech.ts：同一套发音、同一套语速档位、同样是按句朗读，
 * 所以在这里练顺了，进听力题不会换一种声音。
 *
 * 判分按词比对（大小写、标点不敏感），逐词标出「对 / 拼错 / 漏写」，
 * 分数 = 写对词数 / 总词数，不搞整句全对才给分——那样只会让人放弃长句。
 */

const ROUNDS = 8;
const RATES = [0.85, 1, 1.25];

type DiffToken = { word: string; typed?: string; state: "ok" | "bad" | "miss" | "extra" };

export type Verdict = {
  tokens: DiffToken[];
  matched: number;
  total: number;
  score: number;
};

export const normalizeSentence = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 逐词对齐（最长公共子序列）。
 *
 * 为什么不用「按下标逐个比」：中间写错一个词，后面全部错位，明明写对 9 个词却判 0 分，
 * 这不是严格，是误判。用 LCS 对齐后，一个拼错的词只影响它自己，
 * 多写/漏写的词也会单独标出来。
 */
export function judge(target: string, typed: string): Verdict {
  const want = normalizeSentence(target).split(" ").filter(Boolean);
  const got = normalizeSentence(typed).split(" ").filter(Boolean);
  const n = want.length;
  const m = got.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = want[i] === got[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (want[i] === got[j]) {
      tokens.push({ word: want[i], state: "ok" });
      i += 1;
      j += 1;
      continue;
    }
    // 跳过这两个词不损失匹配数 → 认为是一个词写错（拼写/词形），而不是「漏一个 + 多一个」
    if (dp[i + 1][j + 1] >= dp[i + 1][j] && dp[i + 1][j + 1] >= dp[i][j + 1]) {
      tokens.push({ word: want[i], typed: got[j], state: "bad" });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ word: want[i], state: "miss" });
      i += 1;
    } else {
      tokens.push({ word: got[j], state: "extra" });
      j += 1;
    }
  }
  while (i < n) {
    tokens.push({ word: want[i], state: "miss" });
    i += 1;
  }
  while (j < m) {
    tokens.push({ word: got[j], state: "extra" });
    j += 1;
  }

  const matched = tokens.filter((t) => t.state === "ok").length;
  return { tokens, matched, total: n, score: n ? matched / n : 0 };
}

const pickSentences = (): DictationSentence[] => {
  const pool = [...DICTATION_SENTENCES];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, ROUNDS);
};

type Phase = "intro" | "playing" | "result";

export function DictationGame() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [rounds, setRounds] = useState<DictationSentence[]>([]);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [scores, setScores] = useState<number[]>([]);
  const [replays, setReplays] = useState(0);
  const [showText, setShowText] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const state = useSpeech();

  const current = rounds[index];
  const lines = useMemo<SpeechLine[]>(
    () => (current ? [{ id: 1, text: current.text }] : []),
    [current],
  );

  const stop = useCallback(() => speech.stop(), []);
  useEffect(() => stop, [stop]);

  const play = useCallback(
    (rate?: number) => {
      if (!current) return;
      if (rate) speech.setRate(rate);
      speech.play(`dictation-${index}`, lines, 0);
      setReplays((n) => n + 1);
    },
    [current, index, lines],
  );

  const start = () => {
    const picked = pickSentences();
    setRounds(picked);
    setIndex(0);
    setScores([]);
    setTyped("");
    setVerdict(null);
    setReplays(0);
    setShowText(false);
    setPhase("playing");
    // 第一句必须直接传文本：此刻 rounds 还没进 state，走 play() 会读到上一轮的 current（空）
    const first = picked[0];
    if (first) {
      window.setTimeout(() => {
        speech.play("dictation-0", [{ id: 1, text: first.text }], 0);
        setReplays(1);
      }, 140);
    }
  };

  const submit = () => {
    if (!current || verdict) return;
    speech.stop();
    const result = judge(current.text, typed);
    setVerdict(result);
    setScores((prev) => [...prev, result.score]);
  };

  const nextOne = () => {
    if (index + 1 >= rounds.length) {
      setPhase("result");
      return;
    }
    setIndex((i) => i + 1);
    setTyped("");
    setVerdict(null);
    setReplays(0);
    setShowText(false);
    window.setTimeout(() => {
      const next = rounds[index + 1];
      if (next) {
        speech.play(`dictation-${index + 1}`, [{ id: 1, text: next.text }], 0);
        setReplays(1);
      }
    }, 200);
  };

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "共 8 句，句子长度按四六级听力常见句长挑选，每句只读一遍也能写下一半以上。",
          "听不清可以点「重听」，或在 0.85× / 1× / 1.25× 之间调语速——和做听力题用的是同一套发音。",
          "按词判分：拼错、漏写都会单独标出来，分数 = 写对的词数 ÷ 总词数。",
        ]}
        cta="开始听写"
        onStart={start}
        note="需要浏览器支持语音朗读（Chrome / Edge / Safari 均可）；若没有声音，先确认系统音量与静音键。"
      />
    );
  }

  if (phase === "result") {
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const full = scores.filter((s) => s === 1).length;
    const stars = avg >= 0.95 ? 3 : avg >= 0.8 ? 2 : avg >= 0.6 ? 1 : 0;
    return (
      <GameResult
        headline={avg >= 0.9 ? "耳朵已经很稳" : avg >= 0.7 ? "大意听懂了，细节还漏" : "先把语速降到 0.85× 再练一轮"}
        subline={`${rounds.length} 句 · 平均得分 ${Math.round(avg * 100)}% · 全对 ${full} 句`}
        stars={stars}
        stats={[
          { label: "平均准确率", value: `${Math.round(avg * 100)}%` },
          { label: "全对句数", value: `${full}/${rounds.length}` },
          { label: "星级", value: `${stars}/3` },
        ]}
        onAgain={start}
        againLabel="再听一轮"
      />
    );
  }

  if (!current) return null;

  const progress = Math.round((index / rounds.length) * 100);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11.5px] g-mute">
          第 {index + 1} / {rounds.length} 句
        </span>
        <span className="h-[3px] min-w-[80px] flex-1 overflow-hidden rounded-full bg-[#eee7dc]">
          <span className="block h-full rounded-full bg-[var(--game-blue)]" style={{ width: `${progress}%` }} />
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          {scores.length ? `已得 ${Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)}%` : "尚未判分"}
        </span>
      </div>

      <div className="card-soft mt-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => play()} className="btn-game">
            {state.playing ? "再读一遍" : "播放句子"}
          </button>
          {RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => play(rate)}
              className={`rounded-full px-2.5 py-1 font-mono text-[11.5px] transition-colors ${
                Math.abs(state.rate - rate) < 0.01
                  ? "bg-ink text-paper"
                  : "border border-line text-ink-soft hover:text-ink"
              }`}
            >
              {rate}×
            </button>
          ))}
          <span className="ml-auto text-[11px] g-mute">本句已听 {replays} 次</span>
        </div>

        <p className="mt-3 text-[12px] g-mute">
          提示：{current.hint}
          <span className="ml-2 rounded-full bg-[#f1ece4] px-1.5 py-0.5 font-mono text-[10.5px]">
            {current.level}
          </span>
        </p>

        <textarea
          ref={inputRef}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (verdict) nextOne();
              else submit();
            }
          }}
          rows={3}
          placeholder="听到什么就写什么，标点、大小写不计分"
          className="mt-3 w-full resize-none rounded-[8px] border border-line bg-paper px-3 py-2.5 text-[14px] leading-[1.8] text-ink outline-none focus:border-accent"
          readOnly={Boolean(verdict)}
        />

        {!verdict && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!typed.trim()}
              className="btn-game disabled:opacity-40"
            >
              提交
            </button>
            <button
              type="button"
              onClick={() => setTyped("")}
              className="btn-game-ghost"
            >
              清空
            </button>
            <span className="ml-auto text-[11px] g-mute">Enter 提交 · Shift+Enter 换行</span>
          </div>
        )}

        {verdict && (
          <div className="mt-4 rounded-[8px] border border-[#eee7dc] bg-[#fbf8f3] p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-medium g-ink">
                得分 {Math.round(verdict.score * 100)}%
              </span>
              <span className="text-[11.5px] g-mute">
                写对 {verdict.matched}/{verdict.total} 词
                {verdict.score === 1 ? " · 全对" : ""}
              </span>
              <button
                type="button"
                onClick={() => setShowText((v) => !v)}
                className="ml-auto text-[11.5px] g-blue hover:underline"
              >
                {showText ? "收起原文" : "看原文"}
              </button>
            </div>

            <p className="mt-2.5 flex flex-wrap gap-x-1.5 gap-y-1 text-[13.5px] leading-[1.9]">
              {verdict.tokens.map((token, i) => {
                if (token.state === "ok") {
                  return (
                    <span key={`${token.word}-${i}`} className="text-[#1b7f4b]" title="写对">
                      {token.word}
                    </span>
                  );
                }
                if (token.state === "miss") {
                  return (
                    <span
                      key={`${token.word}-${i}`}
                      className="rounded bg-[#fdf3e3] px-1 text-[#a9701a]"
                      title="漏写"
                    >
                      {token.word}
                    </span>
                  );
                }
                if (token.state === "extra") {
                  return (
                    <span
                      key={`${token.word}-${i}`}
                      className="rounded bg-[#f1ece4] px-1 text-[#8b8377] line-through"
                      title="多写"
                    >
                      {token.word}
                    </span>
                  );
                }
                return (
                  <span
                    key={`${token.word}-${i}`}
                    className="rounded bg-[#fdeceb] px-1 text-[#b3261e]"
                    title={`你写的是 ${token.typed ?? ""}`}
                  >
                    {token.word}
                  </span>
                );
              })}
            </p>

            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[#a39889]">
              <span>绿 = 写对</span>
              <span className="text-[#b3261e]">红 = 拼错</span>
              <span className="text-[#a9701a]">黄 = 漏写</span>
              <span className="line-through">划掉 = 多写</span>
            </p>

            {showText && (
              <p className="mt-2 border-t border-[#eee7dc] pt-2 text-[13px] leading-[1.8] g-mute">
                原文：{current.text}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={nextOne} className="btn-game">
                {index + 1 >= rounds.length ? "看结算" : "下一句"}
              </button>
              <button type="button" onClick={() => play()} className="btn-game-ghost">
                再听一遍
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
