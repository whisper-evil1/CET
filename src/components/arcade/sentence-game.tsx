"use client";

import { useCallback, useMemo, useState } from "react";
import { GameIntro, GameResult } from "./match-ui";
import { LevelDots } from "./game-hud";
import { sample, saveBest, getBest, starsFor } from "./word-pool";
import { SENTENCES } from "@/lib/game-sentences";

/**
 * 句子重组（移植自参考站的 sentence）。
 *
 * 玩法：给中文句意，把打乱的英文单词点回正确语序，一局 5 句。
 *
 * 交互上和参考站的差异：chip 用「点击移入 / 移出」而不是删掉重画，
 * 并按对象 id 而不是单词文本追踪 —— 有的句子里同一个词出现两次
 * （"the streets" 的 the 和句首的 The），按文本追踪会串位。
 * 判分仍然按 join(" ") 全等比对，规则不变。
 */

const ROUND_SIZE = 5;

type Chip = { id: number; text: string };

type Phase = "intro" | "playing" | "result";

function makeChips(words: string[]): Chip[] {
  return words.map((text, id) => ({ id, text }));
}

export function SentenceGame() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [puzzles, setPuzzles] = useState<Chip[][]>([]); // 每句的打乱词序（chip 对象）
  const [answers, setAnswers] = useState<string[][]>([]); // 每句的正确答案
  const [chinese, setChinese] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [built, setBuilt] = useState<Chip[]>([]);
  const [remaining, setRemaining] = useState<Chip[]>([]);
  const [right, setRight] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [best, setBest] = useState(0);

  const startRound = useCallback(() => {
    const picked = sample(SENTENCES, ROUND_SIZE);
    setPuzzles(picked.map((s) => makeChips(s.en)));
    setAnswers(picked.map((s) => s.en));
    setChinese(picked.map((s) => s.zh));
    setIndex(0);
    setBuilt([]);
    setRemaining(picked.length > 0 ? makeChips(shuffleCopy(picked[0].en)) : []);
    setRight(0);
    setMessage(null);
    setBest(getBest("sentence"));
    setPhase("playing");
  }, []);

  const resetCurrent = useCallback(() => {
    setBuilt([]);
    setRemaining(makeChips(shuffleCopy(answers[index] ?? [])));
    setMessage(null);
  }, [answers, index]);

  const moveFromPool = (chipId: number) => {
    const chip = remaining.find((c) => c.id === chipId);
    if (!chip) return;
    setRemaining((list) => list.filter((c) => c.id !== chipId));
    setBuilt((list) => list.concat([chip]));
    setMessage(null);
  };

  const moveFromBuilt = (chipId: number) => {
    const chip = built.find((c) => c.id === chipId);
    if (!chip) return;
    setBuilt((list) => list.filter((c) => c.id !== chipId));
    setRemaining((list) => list.concat([chip]));
    setMessage(null);
  };

  const submit = () => {
    if (built.length === 0) return;
    const guess = built.map((c) => c.text).join(" ");
    const answer = (answers[index] ?? []).join(" ");
    if (guess === answer) {
      const nextRight = right + 1;
      setRight(nextRight);
      setMessage({ ok: true, text: "正确！这一句语序完全对" });
      window.setTimeout(() => {
        if (index + 1 >= puzzles.length) {
          const isBest = saveBest("sentence", nextRight);
          setBest(getBest("sentence"));
          void isBest;
          setPhase("result");
          return;
        }
        const next = index + 1;
        setIndex(next);
        setBuilt([]);
        setRemaining(makeChips(shuffleCopy(puzzles[next].map((c) => c.text))));
        setMessage(null);
      }, 900);
    } else {
      setMessage({ ok: false, text: `不对，再试试。句意：${chinese[index] ?? ""}` });
    }
  };

  const doneStates = useMemo(
    () =>
      puzzles.map((_, i) => (i < index ? "done-right" : i === index ? "current" : "todo")),
    [puzzles, index],
  );

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "看中文句意，把打乱的英文单词点回正确语序，一局 5 句。",
          "点下面的词放进句子，点错了再点一下就退回去。",
          "全部摆好点「提交句子」；拼错不扣分，可以无限重试。",
          "这 12 个句子都来自四六级作文和翻译里的高频表达，拼一遍等于背一遍句型。",
        ]}
        note={`本机最佳：一局拼对 ${getBest("sentence")} 句。`}
        cta="开始组句"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    const stars = starsFor((right / ROUND_SIZE) * 100);
    return (
      <GameResult
        headline={right === ROUND_SIZE ? "全部拼对" : "本局结束"}
        subline={`拼对 ${right} / ${ROUND_SIZE} 句${best === right && right > 0 ? "，追平本机最佳" : ""}。`}
        stars={stars}
        stats={[
          { label: "拼对", value: `${right}/${ROUND_SIZE}` },
          { label: "正确率", value: `${Math.round((right / ROUND_SIZE) * 100)}%` },
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
          第 <b className="g-ink">{index + 1}</b>/{puzzles.length} 句
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          答对 <b className="g-ink">{right}</b>
        </span>
        <span className="ml-auto">
          <LevelDots states={doneStates} />
        </span>
      </div>

      <div className="px-4 py-6 sm:px-6 sm:py-7">
        <p className="text-[10.5px] tracking-[0.22em] g-mute uppercase">把英文句子拼回来</p>
        <p className="mt-2 text-[16px] leading-[1.75] g-ink">{chinese[index]}</p>

        {/* 已拼区：空态给一行提示，避免出现高度塌陷 */}
        <div className="mt-5 min-h-[58px] rounded-[12px] border border-dashed g-line bg-[#fbfcfe] p-2.5">
          {built.length === 0 ? (
            <p className="px-1 py-1.5 text-[11.5px] g-mute">点击下方单词，按语序放进这里</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {built.map((chip) => (
                <button
                  key={`b${chip.id}`}
                  type="button"
                  onClick={() => moveFromBuilt(chip.id)}
                  className="rounded-[9px] border border-[var(--game-blue)] bg-[var(--game-blue-soft)] px-3 py-1.5 font-mono text-[13px] font-medium g-blue-deep transition-colors"
                >
                  {chip.text}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          {remaining.length === 0 ? (
            <p className="px-1 text-[11.5px] g-mute">单词用完了，点「提交句子」验一下</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {remaining.map((chip) => (
                <button
                  key={`r${chip.id}`}
                  type="button"
                  onClick={() => moveFromPool(chip.id)}
                  className="rounded-[9px] border g-line bg-white px-3 py-1.5 font-mono text-[13px] g-ink transition-colors hover:border-[var(--game-blue)] hover:g-blue-deep"
                >
                  {chip.text}
                </button>
              ))}
            </div>
          )}
        </div>

        {message && (
          <p className={`mt-4 text-[12.5px] leading-[1.7] ${message.ok ? "text-[#0f766e]" : "text-[#b3261e]"}`}>
            {message.text}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button type="button" onClick={submit} className="btn-game">
            提交句子
          </button>
          <button type="button" onClick={resetCurrent} className="btn-game-ghost">
            重排本句
          </button>
        </div>
      </div>
    </div>
  );
}

function shuffleCopy<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
