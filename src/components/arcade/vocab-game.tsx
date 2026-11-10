"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import type { VocabItem, VocabQueue } from "@/lib/types";
import { GameHud, StarRow } from "./game-hud";

/**
 * 趣味背单词：释义四选一闯关。
 *
 * 出题不另造数据 —— 题面来自 /api/vocab/queue（按优先级排好的今日队列），
 * 干扰项从同一个词库里取别的词的释义，答完立刻回写调度接口：
 *   答对 → grade=good（间隔推进）  答错/超时 → grade=again（10 分钟后再来）
 * 这样「玩游戏」和「背单词」是同一份数据，玩完生词本里真的前进了，不是另起一套进度。
 */

const ROUND_SIZE = 10;
const SECONDS_PER_WORD = 20;
const FEEDBACK_MS = 850;
const MAX_HEARTS = 3;

type Round = {
  item: VocabItem;
  options: { key: string; text: string }[];
  answerKey: string;
};

function defText(item: VocabItem): string {
  if (!item.definitions || item.definitions.length === 0) return "（释义待补）";
  return item.definitions
    .slice(0, 2)
    .map((d) => `${d.pos ? `${d.pos} ` : ""}${d.zh}`)
    .join("；");
}

/**
 * 选项文案：只取第一条释义、前三个义项，最多 40 字。
 *
 * 为什么不能直接用 defText：离线词库的释义动辄一整行，country 甚至会带出
 * 「[计] DOS外部命令:用于设定国家代码，包括日期时间及货币格式」这种跟四六级无关的义项。
 * 四个选项各自三四行，卡片立刻变成长文，四选一也没法一眼扫完。
 * 所有选项走同一套收敛规则，不会只截正确项，所以不影响公平。
 */
function defOption(item: VocabItem): string {
  const first = item.definitions?.[0];
  if (!first) return "";
  const senses: string[] = [];
  for (const raw of (first.zh || "").split(/[,，;；]/)) {
    // 去掉 [经] [计] [医] 这类词典领域标记，并把「[经] 政府」和「政府」合并成一条
    const clean = raw.replace(/\[[^\]]{1,6}\]/g, "").trim();
    if (!clean || senses.includes(clean)) continue;
    senses.push(clean);
    if (senses.length >= 3) break;
  }
  const text = `${first.pos ? `${first.pos} ` : ""}${senses.join("，")}`.trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** 占位/测试释义：出现这些字样的一律不当题面、也不当干扰项 */
const PLACEHOLDER_DEF = /测试词|占位|待补|TODO|lorem ipsum|test word|dummy/i;

/**
 * 这条词能不能用来出题。
 *
 * 起因：演示账号里混进过 `zzzzipitrddjka`（释义「测试词一」）这类测试数据，
 * 结果题面是个根本不存在的词，三个干扰项也全是「测试词一/二/三」。
 * 脏数据本体已经从库里清掉，但导入接口对用户是开放的，谁都能再灌进来，
 * 所以在出题这一层再拦一道 —— 数据干净时这里什么都不会挡。
 *
 * 判定故意放松：只拦「明显不是词」的，宁可漏判，不能把真词误挡在门外。
 */
function isPlayable(item: VocabItem): boolean {
  if (!item.definitions || item.definitions.length === 0) return false;
  // 占位判定看完整释义，不看截断后的选项文案
  const raw = item.definitions.map((d) => d.zh || "").join(" ");
  if (!raw.trim() || PLACEHOLDER_DEF.test(raw)) return false;
  if (defOption(item).length < 2) return false;
  const w = (item.word || "").trim();
  if (!/^[a-z][a-z'’\- ]*$/i.test(w)) return false; // 纯字母，允许短语/连字符/撇号
  if (/([a-z])\1{2,}/i.test(w)) return false; // zzzz 这种连续重复不是英语词
  if (w.replace(/[\s'’\-]/g, "").length > 24) return false; // 去掉分隔符还超长基本是乱敲
  return true;
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 用别的词的释义当干扰项；释义太短或重复的跳过，凑不满就少给几个选项 */
function buildRounds(items: VocabItem[]): Round[] {
  // 先把不可能是真词的条目剔掉 —— 它们既不能当题面，也不能当干扰项
  const pool = items.filter((item) => isPlayable(item));
  if (pool.length === 0) return [];
  const target = pool.slice(0, ROUND_SIZE);
  const rounds: Round[] = [];

  for (const item of target) {
    const correct = defOption(item);
    const seen = new Set<string>([correct]);
    const distractors: string[] = [];
    const others = shuffle(pool.filter((p) => p.id !== item.id));
    for (const other of others) {
      const text = defOption(other);
      if (seen.has(text) || text.length < 2) continue;
      seen.add(text);
      distractors.push(text);
      if (distractors.length >= 3) break;
    }
    if (distractors.length < 3) continue;

    const options = shuffle(
      [correct].concat(distractors).map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
    );
    const answer = options.find((o) => o.text === correct);
    if (!answer) continue;
    rounds.push({ item, options, answerKey: answer.key });
  }
  return rounds;
}

function starsFor(accuracy: number): number {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  if (accuracy >= 50) return 1;
  return 0;
}

type Phase = "loading" | "empty" | "error" | "playing" | "result";

export function VocabGame() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorText, setErrorText] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [left, setLeft] = useState(SECONDS_PER_WORD);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrong, setWrong] = useState<{ word: string; answer: string }[]>([]);
  const [hearts, setHearts] = useState(MAX_HEARTS);
  const [outOfHearts, setOutOfHearts] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  const timerRef = useRef<number | null>(null);
  const advanceRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (advanceRef.current !== null) {
      window.clearTimeout(advanceRef.current);
      advanceRef.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setErrorText("");
    try {
      const queue = await apiFetch<VocabQueue>("/api/vocab/queue?limit=60&includeMastered=0");
      const list = queue.items ?? [];
      const built = buildRounds(list);
      if (built.length === 0) {
        setPhase("empty");
        return;
      }
      setRounds(built);
      setIndex(0);
      setPicked(null);
      setScore(0);
      setCombo(0);
      setPeakCombo(0);
      setCorrectCount(0);
      setWrong([]);
      setHearts(MAX_HEARTS);
      setOutOfHearts(false);
      setResults([]);
      setLeft(SECONDS_PER_WORD);
      setPhase("playing");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载失败");
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    return clearTimers;
  }, [load, clearTimers]);

  const round = rounds[index];

  const submit = useCallback(
    (grade: "good" | "again") => {
      if (!round) return;
      void apiFetch(`/api/vocab/${round.item.id}/review`, {
        method: "POST",
        body: JSON.stringify({ grade }),
      }).catch(() => {
        /* 落库失败不影响本局继续，下次进生词本仍按原计划 */
      });
    },
    [round],
  );

  const decide = useCallback(
    (key: string | null) => {
      if (!round || picked !== null) return;
      const ok = key === round.answerKey;
      setPicked(key ?? "");
      submit(ok ? "good" : "again");
      // 命值在答错/超时时扣，扣到 0 就提前收关（已答的题照常写回，不白答）
      const nextHearts = ok ? hearts : Math.max(0, hearts - 1);
      setResults((list) => list.concat([ok]));

      if (ok) {
        setCorrectCount((n) => n + 1);
        setCombo((c) => {
          const next = c + 1;
          setPeakCombo((peak) => (next > peak ? next : peak));
          setScore((s) => s + 10 + Math.min(next, 5) * 2);
          return next;
        });
      } else {
        setCombo(0);
        setHearts(nextHearts);
        setWrong((list) =>
          list.concat([{ word: round.item.word, answer: defText(round.item) }]).slice(0, 12),
        );
      }

      const dead = nextHearts <= 0;

      advanceRef.current = window.setTimeout(() => {
        setPicked(null);
        if (dead) {
          setOutOfHearts(true);
          setPhase("result");
          return;
        }
        setIndex((i) => {
          const next = i + 1;
          if (next >= rounds.length) {
            setPhase("result");
            return i;
          }
          setLeft(SECONDS_PER_WORD);
          return next;
        });
      }, FEEDBACK_MS);
    },
    [hearts, picked, round, rounds.length, submit],
  );

  // 倒计时：到 0 按「没答上来」处理，计入错题
  useEffect(() => {
    if (phase !== "playing" || picked !== null) return;
    timerRef.current = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
          }
          decide(null);
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
  }, [phase, picked, index, decide]);

  const accuracy = useMemo(() => {
    const answered = correctCount + wrong.length;
    return answered === 0 ? 0 : Math.round((correctCount / answered) * 100);
  }, [correctCount, wrong.length]);

  if (phase === "loading") {
    return (
      <div className="card-soft mt-5 p-10 text-center text-[13px] text-ink-mute">正在按优先级取词…</div>
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
        <p className="font-serif text-[17px] text-ink">词库还没词，先建个词库</p>
        <p className="mx-auto mt-2 max-w-[36ch] text-[12.5px] leading-[1.8] text-ink-mute">
          闯关的题目全部来自你自己的生词本。去词书里一键导入四六级高频词，回来就能开局。
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/vocab" className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper">
            去词书导词
          </Link>
          <Link
            href="/vocab?tab=import"
            className="rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft"
          >
            粘贴自己的词表
          </Link>
        </div>
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
            <p className="font-serif text-[30px] leading-none text-ink">{score}</p>
            <p className="mt-1 text-[11px] text-ink-mute">分</p>
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

        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            { label: "正确率", value: `${accuracy}%` },
            { label: "最高连击", value: String(peakCombo) },
            { label: "答对", value: `${correctCount}/${Math.max(results.length, 1)}` },
          ].map((cell) => (
            <div key={cell.label} className="rounded-[11px] border border-line bg-paper/60 p-3">
              <p className="text-[10.5px] text-ink-mute">{cell.label}</p>
              <p className="mt-1 font-serif text-[19px] text-ink">{cell.value}</p>
            </div>
          ))}
        </div>

        {wrong.length > 0 && (
          <div className="mt-5">
            <p className="text-[12px] text-ink-soft">
              这几个词记一下，已经排到 10 分钟后再出现：
            </p>
            <ul className="mt-2 divide-y divide-line-soft border-t border-line">
              {wrong.map((item) => (
                <li key={item.word} className="flex flex-wrap items-baseline gap-x-2 py-2">
                  <span className="font-serif text-[15px] text-ink">{item.word}</span>
                  <span className="text-[12px] text-ink-soft">{item.answer}</span>
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
            href="/vocab/stats"
            className="rounded-full bg-tint-jade px-5 py-2.5 text-[13px] text-jade-ink transition-opacity hover:opacity-90"
          >
            看学习数据
          </Link>
          <Link
            href="/vocab"
            className="rounded-full border border-line px-5 py-2.5 text-[13px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            看生词本
          </Link>
        </div>
      </div>
    );
  }

  if (!round) return null;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <GameHud
        hearts={hearts}
        maxHearts={MAX_HEARTS}
        combo={combo}
        score={score}
        dots={rounds.map((_, i) => {
          if (i < results.length) return results[i] ? "done-right" : "done-wrong";
          return i === index ? "current" : "todo";
        })}
        timer={{ left, total: SECONDS_PER_WORD }}
      />

      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-[10.5px] tracking-[0.22em] text-ink-mute uppercase">选出正确释义</p>
        <p className="mt-2 break-words font-serif text-[30px] leading-tight text-ink sm:text-[38px]">
          {round.item.word}
        </p>
        {round.item.phonetic && (
          <p className="mt-1 font-mono text-[12px] text-ink-mute">{round.item.phonetic}</p>
        )}

        <ul className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {round.options.map((option) => {
            const isAnswer = option.key === round.answerKey;
            const isPicked = picked === option.key;
            const revealed = picked !== null;
            const tone = !revealed
              ? "border-line bg-surface text-ink-soft hover:border-accent hover:text-ink"
              : isAnswer
                ? "border-correct bg-correct-soft text-correct"
                : isPicked
                  ? "border-wrong bg-wrong-soft text-wrong"
                  : "border-line bg-surface text-ink-mute/70";
            return (
              <li key={option.key}>
                <button
                  type="button"
                  disabled={revealed}
                  onClick={() => decide(option.key)}
                  className={`flex min-h-[52px] w-full items-start gap-3 rounded-[11px] border px-3.5 py-3 text-left text-[13px] leading-[1.6] transition-colors ${tone}`}
                >
                  <span className="mt-[1px] shrink-0 font-mono text-[11px] opacity-70">
                    {option.key}
                  </span>
                  <span className="min-w-0 flex-1">{option.text}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {picked !== null && (
          <p
            className={`mt-4 text-[12.5px] ${
              picked === round.answerKey ? "text-correct" : "text-wrong"
            }`}
          >
            {picked === round.answerKey
              ? "对了 · 下次间隔会拉长"
              : picked === ""
                ? `超时 · 正确答案：${round.options.find((o) => o.key === round.answerKey)?.text ?? ""}`
                : `错了 · 正确答案：${round.options.find((o) => o.key === round.answerKey)?.text ?? ""}`}
          </p>
        )}
      </div>
    </div>
  );
}
