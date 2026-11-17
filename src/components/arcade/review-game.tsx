"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { speakText } from "@/lib/pronounce";
import { createVoiceQueue, sleep } from "@/lib/voice-queue";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { ComboBadge, ComboBurst, comboPraise, LevelDots } from "./game-hud";
import { ExamEvidence, prefetchExamEvidence } from "@/components/vocab/exam-evidence";
import {
  firstSense,
  reviewPoolWord,
  sample,
  shortDef,
  starsFor,
  useWordPool,
  type PoolWord,
} from "./word-pool";

/**
 * 生词本背单词（参考「不背单词」的记忆节奏重写）。
 *
 * 和「趣味背单词」的区别不是界面，而是**过关规则**：
 *   1. 先给词、不给义，自己判断认不认识 —— 认识才进入四选一验证，
 *      不认识就直接看释义；不允许「看着选项猜出词义」蒙混过关；
 *   2. 一个词要在本轮**连续答对 3 次**才算过，答错一次进度归零、隔两题再来；
 *   3. 本轮全部过关后再走一轮「回顾」，刚才过的词重新出现一遍，
 *      这一遍是对的巩固，也是对「刚才是蒙的」的兜底；
 *   4. 干扰项不再是随机别的词，而是**词义相近**的词（共享义项汉字 + 同词性优先），
 *      四个选项都像对的时候，才真的在考「分辨」，不是在考「排除」。
 *
 * 成绩照旧写回 /api/vocab/:id/review：答对 grade=good、答错 grade=again，
 * 所以玩完这一关，生词本里的间隔是真的动了，不是另开一套进度。
 */

const ROUND_WORDS = 6;
const PASS_STREAK = 3;
/** 答错后隔几题重新出现（太小会立刻重考，太大就忘了刚才错过） */
const WRONG_GAP = 3;
/** 答对但还没凑满三连时，隔几题再来一次 */
const RIGHT_GAP = 2;

type Stage = "judge" | "choose" | "reveal";

type Card = {
  item: PoolWord;
  /** 本轮已连续答对几次 */
  streak: number;
  /** 本轮答错次数，结算时用来排「最该再看一眼」 */
  misses: number;
  /** 是否已经在回顾轮出现过 */
  reviewed: boolean;
};

type Round = {
  queue: Card[];
  passed: Card[];
  total: number;
};

type Verdict = "known" | "unsure" | "unknown";

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 一条释义里的实义汉字（去掉标点、词性、括号里的英文） */
function senseChars(text: string): Set<string> {
  const clean = text
    .replace(/\[[^\]]{1,8}\]/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[a-zA-Z.]/g, "")
    .replace(/[\s,，、;；:：。."'“”‘’]/g, "");
  return new Set(Array.from(clean));
}

/**
 * 同义干扰项。
 *
 * 打分只看两件事：和正确释义共享多少个汉字、词性是否一致。
 * 「减少」vs「降低、缩减、削弱」共享字多，天然构成近义混淆；
 * 「减少」vs「政府」共享字为 0，就排在后面当兜底。
 * 这样不需要一份同义词词典，也能得到「四个都像对」的选项。
 */
function pickNearSynonyms(correct: PoolWord, pool: PoolWord[], count = 3): string[] {
  const target = firstSense(correct);
  const targetChars = senseChars(target);
  const targetPos = (correct.pos || "").split(/[.,，]/)[0]?.trim().toLowerCase() ?? "";

  const scored = pool
    .filter((word) => word.word.toLowerCase() !== correct.word.toLowerCase())
    .map((word) => {
      const sense = firstSense(word);
      const chars = senseChars(sense);
      let overlap = 0;
      for (const ch of chars) if (targetChars.has(ch)) overlap += 1;
      const pos = (word.pos || "").split(/[.,，]/)[0]?.trim().toLowerCase() ?? "";
      const posBonus = targetPos && pos && targetPos === pos ? 2 : 0;
      // 分档比加权更管用：共享字的永远排在「只是词性相同」的前面，
      // 否则「也许」旁边会出现「怀旧 / 跟随」这种一眼排除的选项。
      const bucket = overlap >= 2 ? 0 : overlap === 1 ? 1 : posBonus ? 2 : 3;
      return { sense, bucket, score: overlap * 3 + posBonus };
    })
    .filter((entry) => entry.bucket < 3)
    // 释义完全一样的（toward / towards）不能当干扰项，否则两个选项都「对」
    .filter((entry) => entry.sense && entry.sense !== target);

  scored.sort((a, b) => a.bucket - b.bucket || b.score - a.score);

  const out: string[] = [];
  const seen = new Set<string>([target]);
  for (const entry of scored) {
    if (seen.has(entry.sense)) continue;
    seen.add(entry.sense);
    out.push(entry.sense);
    if (out.length >= count) break;
  }
  return out;
}

type Option = { key: string; text: string };

/**
 * 出选项：优先用服务端算好的近义干扰（全库比对，像「减少 / 降低 / 缩减」这种），
 * 服务端没给（接口超时或这个词太孤立）时，再用本地词池兜底。
 */
function buildOptions(
  correct: PoolWord,
  pool: PoolWord[],
  bank: string[] = [],
): { options: Option[]; answer: string } {
  const right = shortDef(correct, 26);
  const near = bank
    .map((sense) => shortDef({ definition: sense }, 26))
    .filter((sense) => sense && sense !== right)
    .slice(0, 3);
  if (near.length < 3) near.push(...pickNearSynonyms(correct, pool, 3 - near.length));
  // 词池太小、近义词凑不满时，用随机别的词补齐，保证永远是四个选项
  while (near.length < 3) {
    const filler = sample(pool, 12)
      .map((word) => shortDef(word, 26))
      .find((text) => text && text !== right && !near.includes(text));
    if (!filler) break;
    near.push(filler);
  }
  const options = shuffle([right, ...near].slice(0, 4)).map((text, i) => ({
    key: String.fromCharCode(65 + i),
    text,
  }));
  const answer = options.find((option) => option.text === right)?.key ?? "A";
  return { options, answer };
}

export function ReviewGame({
  onExit,
  embedded = false,
  pool: externalPool,
  poolLabel,
  onPoolExit,
}: {
  /** 从哪来回哪去：嵌在生词本里时由外层接管返回 */
  onExit?: () => void;
  /** 嵌在生词本里：返回按钮文案与去向都换掉，不再提示「回游戏厅」 */
  embedded?: boolean;
  /** 指定词池：词书「开始背」时传入这本书的词，绕过生词本/词书兜底的取词 */
  pool?: PoolWord[];
  /** 外部词池的说明文案（intro 页那句「本局考的是…」） */
  poolLabel?: string;
  /** 外部词池背完「回书架」时的返回（替代 onExit 的「回生词本/回游戏厅」文案） */
  onPoolExit?: () => void;
} = {}) {
  // 有外部词池时，直接把它当「已就绪」的词池用，不再走 useWordPool 取词。
  const ownPool = useWordPool(40);
  const pool = useMemo(() => {
    if (!externalPool) return ownPool;
    return {
      phase: "ready" as const,
      items: externalPool,
      ownCount: externalPool.length,
      error: "",
      reload: () => {},
    };
  }, [externalPool, ownPool]);
  const backLabel = externalPool && onPoolExit ? "回书架" : embedded ? "回生词本" : "回游戏厅";
  const handleExit = externalPool && onPoolExit ? onPoolExit : onExit;

  const [phase, setPhase] = useState<"intro" | "playing" | "result">("intro");
  const [round, setRound] = useState<Round>({ queue: [], passed: [], total: 0 });
  const [stage, setStage] = useState<Stage>("judge");
  const [picked, setPicked] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [answerKey, setAnswerKey] = useState("A");
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [correctTotal, setCorrectTotal] = useState(0);
  const [wrongTotal, setWrongTotal] = useState(0);
  const [missed, setMissed] = useState<{ word: string; answer: string }[]>([]);
  const [recallMode, setRecallMode] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioHint, setAudioHint] = useState("");
  /** 服务端算好的近义干扰项：word → [义项 ×3] */
  const [nearBank, setNearBank] = useState<Record<string, string[]>>({});
  const [preparing, setPreparing] = useState(false);

  const timerRef = useRef<number | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  const current = round.queue[0];

  /** 自动发音队列：鼓励语与下一张卡的读音不能叠在一起 */
  const voice = useRef(createVoiceQueue()).current;
  const liveWord = useRef("");

  const speak = useCallback(async (text: string, manual = false) => {
    if (!text) return;
    setSpeaking(true);
    const channel = await speakText(text, "en", 0.95);
    setSpeaking(false);
    if (manual) setAudioHint(channel === "failed" ? "这台设备发不了声，换 Chrome / Safari 试试" : "");
  }, []);

  const startRound = useCallback(async () => {
    const pickedWords = sample(
      pool.items.filter((word) => word.word && word.definition),
      ROUND_WORDS,
    );
    if (pickedWords.length < 3) return;

    // 真题证据也一并预取：揭晓释义的那一刻就能看到例句，不等网络
    prefetchExamEvidence(pickedWords.map((word) => word.word));

    // 先把这一轮的近义干扰项一次要回来：6 个词一次请求，失败就退回本地词池
    setPreparing(true);
    let bank: Record<string, string[]> = {};
    try {
      const payload = await Promise.race([
        apiFetch<{ results: Record<string, string[]> }>("/api/vocab/distractors", {
          method: "POST",
          body: JSON.stringify({
            items: pickedWords.map((word) => ({
              word: word.word,
              definition: word.definition,
              pos: word.pos,
            })),
            count: 3,
          }),
        }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1800)),
      ]);
      bank = payload?.results ?? {};
    } catch {
      bank = {};
    }
    setNearBank(bank);
    setPreparing(false);

    const cards: Card[] = pickedWords.map((item) => ({ item, streak: 0, misses: 0, reviewed: false }));
    clearTimer();
    setRound({ queue: cards, passed: [], total: cards.length });
    setStage("judge");
    setPicked(null);
    setVerdict(null);
    setOptions([]);
    setCombo(0);
    setPeakCombo(0);
    setCorrectTotal(0);
    setWrongTotal(0);
    setMissed([]);
    setRecallMode(false);
    setAudioHint("");
    setPhase("playing");
  }, [clearTimer, pool.items]);

  /* 每换一张卡：出选项 + 读一遍词（认词阶段不给义，只给声音和词形） */
  useEffect(() => {
    if (phase !== "playing" || !current) return;
    const built = buildOptions(current.item, pool.items, nearBank[current.item.word] ?? []);
    setOptions(built.options);
    setAnswerKey(built.answer);
    setStage("judge");
    setPicked(null);
    setVerdict(null);
    liveWord.current = current.item.word;
    const word = current.item.word;
    voice.enqueue(async () => {
      if (liveWord.current !== word) return; // 已经换卡了，不再补读
      await speak(word);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, current?.item.word, nearBank]);

  /** 把这张卡按间隔放回队列（不在本轮消失） */
  const requeue = (rest: Card[], card: Card, gap: number): Card[] => {
    const next = rest.slice();
    next.splice(Math.min(gap, next.length), 0, card);
    return next;
  };

  /**
   * 结算一张卡。
   *
   * 这里直接用当前 round 计算下一份队列，而不是在 setRound 的 updater 里
   * 顺手 setPhase —— updater 在严格模式下可能执行两次，会把「进回顾轮」做两遍。
   */
  const advance = useCallback(
    (ok: boolean) => {
      const card = current;
      if (!card) return;
      reviewPoolWord(card.item, ok ? "good" : "again");

      if (!ok) {
        setWrongTotal((n) => n + 1);
        setCombo(0);
        setMissed((list) => {
          const next = list.filter((entry) => entry.word !== card.item.word);
          next.push({ word: card.item.word, answer: shortDef(card.item, 22) });
          return next.slice(-12);
        });
      }

      const rest = round.queue.slice(1);
      let passed = round.passed;
      let queue: Card[];

      if (!ok) {
        queue = requeue(rest, { ...card, streak: 0, misses: card.misses + 1 }, WRONG_GAP);
      } else {
        const streak = card.streak + 1;
        if (streak >= PASS_STREAK) {
          // 同一个词可能已经进过 passed（回顾轮），按词去重
          if (!passed.some((entry) => entry.item.word === card.item.word)) {
            passed = passed.concat([{ ...card, streak }]);
          }
          queue = rest;
        } else {
          queue = requeue(rest, { ...card, streak }, RIGHT_GAP);
        }
      }

      setPicked(null);
      setVerdict(null);
      setStage("judge");

      if (queue.length > 0) {
        setRound({ ...round, passed, queue });
        return;
      }

      // 本轮全部过关 → 进回顾轮；回顾轮也走完 → 结算
      if (!recallMode && passed.length >= round.total) {
        setRecallMode(true);
        setRound({
          ...round,
          passed,
          queue: shuffle(passed.map((entry) => ({ ...entry, streak: PASS_STREAK - 1, reviewed: true }))),
        });
        return;
      }

      setRound({ ...round, passed, queue: [] });
      setPhase("result");
    },
    [current, recallMode, round],
  );

  /* ---------- 交互 ---------- */

  const onVerdict = (value: Verdict) => {
    if (stage !== "judge" || !current) return;
    setVerdict(value);
    if (value === "unknown") {
      // 不认识：直接看释义，进度归零，隔几题再来
      setStage("reveal");
      void speak(current.item.word, false);
      return;
    }
    // 「认识 / 有点印象」都要过一遍四选一：自己说认识不算，选对才算
    setStage("choose");
  };

  const onChoose = (key: string) => {
    if (stage !== "choose" || picked !== null) return;
    setPicked(key);
    const ok = key === answerKey;
    if (ok) {
      setCorrectTotal((n) => n + 1);
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setPeakCombo((peak) => (nextCombo > peak ? nextCombo : peak));
      // 连击鼓励语音与画面彩蛋同时发生（和「趣味背单词」同一套）
      const praise = comboPraise(nextCombo);
      if (praise) {
        // 排队而不是定时乱放：这样它一定先说完，下一张卡才开始读
        voice.enqueue(async () => {
          await sleep(260);
          if (liveWord.current !== current.item.word) return;
          await speak(praise.say, false);
        });
      }
    }
    setStage("reveal");
    // 不自动划走：释义 + 近几届真题例句要留给用户慢慢看，看完自己点「下一个 →」
  };

  const onRevealNext = () => {
    if (stage !== "reveal") return;
    clearTimer();
    const ok = verdict !== "unknown" && picked === answerKey;
    advance(ok);
  };

  const progress = useMemo(() => {
    const passed = round.passed.length;
    const dots: ("done-right" | "current" | "todo")[] = Array.from(
      { length: round.total },
      (_, i) => (i < passed ? "done-right" : i === passed ? "current" : "todo"),
    );
    return { passed, dots };
  }, [round.passed.length, round.total]);

  if (pool.phase === "loading" || preparing) {
    return <GameLoading text={preparing ? "正在按词义挑干扰项…" : "正在取你的生词…"} />;
  }
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "先只给单词，不给释义：认识的进四选一验证，不认识的直接看释义。",
          "一个词要连续答对 3 次才算过，错一次进度归零、隔两题再考。",
          "四个选项是近义词级别的干扰（共享义项、同词性优先），靠排除法蒙不过去。",
          `一轮 ${ROUND_WORDS} 个词，全部过关后还有一轮「回顾」把它们再认一遍。`,
        ]}
        note={
          externalPool
            ? poolLabel ?? `这本书共 ${pool.ownCount} 个词，每轮随机抽 ${ROUND_WORDS} 个来背。`
            : pool.ownCount > 0
              ? `本局优先用你生词本里的 ${Math.min(pool.ownCount, ROUND_WORDS)} 个词，不够的从四级词书补。`
              : "生词本为空时全部取自四级词书高频词；导一批自己的词，下一局就考你的。"
        }
        cta="开始背词"
        onStart={startRound}
        onBack={handleExit}
        backLabel={backLabel}
        large
      />
    );
  }

  if (phase === "result") {
    const answered = correctTotal + wrongTotal;
    const accuracy = answered ? Math.round((correctTotal / answered) * 100) : 0;
    const stars = starsFor(accuracy);
    return (
      <GameResult
        headline={recallMode ? "本轮全部过关" : "这一轮结束"}
        subline={`${round.passed.length} 个词都连对 ${PASS_STREAK} 次，最高连击 ${peakCombo}。`}
        stars={stars}
        stats={[
          { label: "过关词", value: `${round.passed.length}` },
          { label: "正确率", value: `${accuracy}%` },
          { label: "最高连击", value: String(peakCombo) },
        ]}
        wrong={missed}
        wrongTitle="这些词本轮错过，已按错词排进复习："
        onAgain={startRound}
        againLabel="再背一轮"
        onBack={handleExit}
        backLabel={backLabel}
        large
      />
    );
  }

  if (!current) {
    return (
      <div className="card-soft mt-5 p-10 text-center">
        <p className="font-serif text-[23px] g-ink">这一轮背完了</p>
        <p className="mt-2.5 text-[15px] g-mute">去结算看看这一轮的连击与错词。</p>
        <button type="button" className="btn-game-lg mt-5" onClick={() => setPhase("result")}>
          看结算
        </button>
      </div>
    );
  }

  const revealed = stage === "reveal";
  const isRight = picked !== null && picked === answerKey;

  return (
    <div className="card-soft relative mt-5 overflow-hidden">
      <ComboBurst combo={combo} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b g-line bg-[#fbfcfe] px-5 py-3.5 sm:px-7">
        <ComboBadge combo={combo} />
        <span className="font-mono text-[13.5px] g-mute">
          过关 <b className="g-ink">{progress.passed}</b> / {round.total}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {recallMode && (
            <span className="rounded-full bg-[var(--game-green-soft)] px-2.5 py-1 text-[12.5px] text-[#12805c]">
              回顾轮
            </span>
          )}
          <LevelDots states={progress.dots} />
        </span>
      </div>

      <div className="grid gap-0 lg:min-h-[min(70vh,660px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* 左：词 */}
        <div className="flex flex-col justify-center border-b g-line px-6 py-8 sm:px-9 sm:py-12 lg:border-r lg:border-b-0">
          <p className="text-[12px] tracking-[0.22em] g-mute uppercase">
            {stage === "judge" ? "这个单词，你认识吗" : "选出它的释义"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <span className="break-words font-serif text-[46px] leading-tight g-ink sm:text-[64px]">
              {current.item.word}
            </span>
            <button
              type="button"
              onClick={() => void speak(current.item.word, true)}
              aria-label="播放单词读音"
              className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#e7dfd2] text-[21px] transition-colors hover:border-[var(--game-blue)] hover:text-[var(--game-blue)] ${
                speaking ? "speaking-pulse bg-[var(--game-blue-soft)] text-[var(--game-blue)]" : "bg-white text-[var(--game-blue-deep)]"
              }`}
            >
              🔊
            </button>
          </div>
          {current.item.phonetic && (
            <p className="mt-2 font-mono text-[15px] g-mute">{current.item.phonetic}</p>
          )}
          {audioHint && <p className="mt-1.5 text-[13px] text-wrong">{audioHint}</p>}
          <ExamEvidence word={current.item.word} rank={current.item.rank} variant="compact" />

          <div className="mt-5 flex items-center gap-2.5 text-[13px] g-mute">
            <span className="font-mono">
              连对 {current.streak}/{PASS_STREAK}
            </span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-[8px] w-[24px] rounded-full ${
                  i < current.streak ? "bg-[#7f9e88]" : "bg-[#eae2d6]"
                }`}
              />
            ))}
            {current.misses > 0 && <span>· 本轮错过 {current.misses} 次</span>}
          </div>

          {stage === "judge" && (
            <div className="mt-7 grid gap-2.5 sm:grid-cols-3">
              {(
                [
                  { value: "known", label: "认识", hint: "再选一次义" },
                  { value: "unsure", label: "有点印象", hint: "直接选义" },
                  { value: "unknown", label: "不认识", hint: "看释义" },
                ] as { value: Verdict; label: string; hint: string }[]
              ).map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onVerdict(item.value)}
                  className="rounded-[14px] border border-[#e7dfd2] bg-white px-4 py-4 text-center transition-colors hover:border-[var(--game-blue)]"
                >
                  <span className="block text-[16.5px] g-ink">{item.label}</span>
                  <span className="mt-1 block text-[12px] g-mute">{item.hint}</span>
                </button>
              ))}
            </div>
          )}

          {revealed && (
            <div className="mt-7 rounded-[14px] border border-[#e7dfd2] bg-[#fbf7f0] px-5 py-5">
              <p className="text-[12px] tracking-[0.2em] g-mute uppercase">释义</p>
              <p className="mt-2 text-[19px] leading-[1.7] g-ink">{shortDef(current.item, 40)}</p>
              <div className="mt-3.5">
                <ExamEvidence word={current.item.word} rank={current.item.rank} variant="full" />
              </div>
              <button
                type="button"
                onClick={onRevealNext}
                className="btn-game mt-5 text-[15px]"
              >
                下一个 →
              </button>
            </div>
          )}
        </div>

        {/* 右：选项 / 提示 */}
        <div className="flex flex-col justify-center px-6 py-8 sm:px-9 sm:py-12">
          {stage === "judge" ? (
            <div className="flex min-h-[280px] flex-col justify-center rounded-[14px] border border-dashed border-[#e3dbcd] bg-[#fcfaf5] px-6 py-9 text-center">
              <p className="font-serif text-[19px] g-ink">先别看选项</p>
              <p className="mx-auto mt-2.5 max-w-[26ch] text-[14.5px] leading-[1.8] g-mute">
                只凭词形和读音判断认不认识。说不认识不丢分，看了选项才想起来，考试里可没有选项提示。
              </p>
            </div>
          ) : (
            <>
              <p className="text-[12px] tracking-[0.22em] g-mute uppercase">
                {verdict === "known" ? "验证：你选的是这个意思吗" : "四选一"}
              </p>
              <ul className="mt-4 grid gap-3">
                {options.map((option) => {
                  const isAnswer = option.key === answerKey;
                  const isPicked = picked === option.key;
                  const tone = !revealed
                    ? "border-[#e7dfd2] bg-white g-ink hover:border-[var(--game-blue)]"
                    : isAnswer
                      ? "border-[#bfe3d3] bg-[var(--game-green-soft)] text-[#0f766e]"
                      : isPicked
                        ? "border-[#f0c2bd] bg-[#fdeceb] text-[#b3261e]"
                        : "border-[#eee7db] bg-white g-mute";
                  return (
                    <li key={option.key}>
                      <button
                        type="button"
                        disabled={revealed}
                        onClick={() => onChoose(option.key)}
                        className={`flex min-h-[74px] w-full items-start gap-3.5 rounded-[14px] border px-5 py-5 text-left text-[17px] leading-[1.6] transition-colors ${tone}`}
                      >
                        <span className="mt-[2px] shrink-0 font-mono text-[13px] opacity-70">
                          {option.key}
                        </span>
                        <span className="min-w-0 flex-1">{option.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {revealed && (
                <p className={`mt-4 text-[15px] ${isRight ? "text-[#12805c]" : "text-[#b3261e]"}`}>
                  {isRight
                    ? verdict === "known"
                      ? "对，确实认识 · 再对两次这个词本轮就过"
                      : "对了 · 再对两次本轮就过"
                    : `不完全是 · 正确释义：${options.find((o) => o.key === answerKey)?.text ?? ""}`}
                </p>
              )}
            </>
          )}

          <p className="mt-6 text-[13px] leading-[1.75] g-mute">
            规则：连对 {PASS_STREAK} 次过关，答错从头再来。答完的词会按记忆曲线回写生词本，
            下一轮出现的时机由它决定。
          </p>
        </div>
      </div>
    </div>
  );
}
