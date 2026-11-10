"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import { firstSense, getBest, reviewPoolWord, saveBest, useWordPool, type PoolWord } from "./word-pool";

/**
 * 单词保卫战（移植自参考站的 guard：打字击落陨石）。
 *
 * 玩法：陨石带着单词从天上掉，屏幕下方列出每颗陨石的中文释义，
 * 把对应的单词打进输入框回车即击落 +10 分；陨石落地摧毁一座城，3 座城失守结束。
 *
 * 移动端专门处理：参考站只靠物理键盘，手机没法玩。这里加了一个
 * 「点释义自动填词」—— 点图例里那条释义，把对应单词填进输入框并聚焦，
 * 手机用户点两下就能击落；电脑用户仍然可以全程盲打。
 */

const WIDTH = 460;
const HEIGHT = 440;
const GROUND = 30;

type Meteor = { word: string; x: number; y: number; speed: number; def: string };

type Phase = "intro" | "playing" | "result";

export function GuardGame() {
  const pool = useWordPool(40);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const meteorsRef = useRef<Meteor[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef(0);
  const spawnTRef = useRef(0);
  const startedRef = useRef(false);
  const endedRef = useRef(false);
  const scoreRef = useRef(0);
  const citiesRef = useRef(3);
  const poolRef = useRef<PoolWord[]>([]);
  const shotRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [score, setScore] = useState(0);
  const [cities, setCities] = useState(3);
  const [legend, setLegend] = useState<Meteor[]>([]);
  const [toast, setToast] = useState("");
  const [endReason, setEndReason] = useState("");
  const [best, setBest] = useState(0);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // 夜空：两段色块拼出纵深感（不依赖渐变 API 的内核差异）
    ctx.fillStyle = "#10142a";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#2a2140";
    ctx.fillRect(0, HEIGHT * 0.45, WIDTH, HEIGHT * 0.55);

    // 城市轮廓：8 栋楼，高度按 i%3 起伏（参考站同款画法）
    ctx.fillStyle = "#3d5a80";
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(20 + i * 55, HEIGHT - GROUND - (i % 3) * 22, 36, GROUND + (i % 3) * 22);
    }

    ctx.textAlign = "center";
    for (const meteor of meteorsRef.current) {
      ctx.beginPath();
      ctx.arc(meteor.x, meteor.y, 24, 0, Math.PI * 2);
      ctx.fillStyle = "#e07a3f";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,180,90,.8)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px 'Microsoft YaHei',sans-serif";
      ctx.fillText(meteor.word, meteor.x, meteor.y + 4);
    }

    if (!startedRef.current) {
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.font = "bold 17px 'Microsoft YaHei',sans-serif";
      ctx.fillText("在下方输入单词开始防御", WIDTH / 2, HEIGHT / 2);
    }
  }, []);

  const endGame = useCallback(
    (why: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      stopLoop();
      setBest((b) => {
        const recorded = saveBest("guard", scoreRef.current);
        return recorded ? scoreRef.current : b;
      });
      setEndReason(why);
      setPhase("result");
    },
    [stopLoop],
  );

  const loopRef = useRef<(t?: number) => void>(() => {});
  loopRef.current = (t?: number) => {
    if (!canvasRef.current || endedRef.current) return;
    const now = t ?? performance.now();
    const dt = Math.min(50, now - (lastTRef.current || now));
    lastTRef.current = now;

    if (startedRef.current) {
      spawnTRef.current += dt;
      if (spawnTRef.current > 2600 - Math.min(1200, scoreRef.current * 8)) {
        spawnTRef.current = 0;
        const list = poolRef.current;
        const entry = list[Math.floor(Math.random() * list.length)];
        if (entry) {
          meteorsRef.current.push({
            word: entry.word,
            def: firstSense(entry),
            x: 40 + Math.random() * (WIDTH - 80),
            y: -20,
            speed: 0.55 + Math.random() * 0.3 + scoreRef.current * 0.006,
          });
        }
        setLegend(meteorsRef.current.slice());
      }
      for (const meteor of meteorsRef.current) meteor.y += (meteor.speed * dt) / 16;
      for (let i = meteorsRef.current.length - 1; i >= 0; i--) {
        if (meteorsRef.current[i].y > HEIGHT - GROUND) {
          meteorsRef.current.splice(i, 1);
          citiesRef.current -= 1;
          setCities(citiesRef.current);
          setLegend(meteorsRef.current.slice());
          if (citiesRef.current <= 0) {
            endGame("城市失守");
            return;
          }
          setToast(`陨石落地！还剩 ${citiesRef.current} 座城市`);
        }
      }
    }
    draw();
    rafRef.current = requestAnimationFrame((next) => loopRef.current(next));
  };

  const shoot = (value: string) => {
    if (endedRef.current) return;
    startedRef.current = true;
    const word = value.trim().toLowerCase();
    if (!word) return;
    const index = meteorsRef.current.findIndex((m) => m.word.toLowerCase() === word);
    if (index >= 0) {
      const meteor = meteorsRef.current[index];
      meteorsRef.current.splice(index, 1);
      scoreRef.current += 10;
      shotRef.current += 1;
      setScore(scoreRef.current);
      setLegend(meteorsRef.current.slice());
      setToast("");
      reviewPoolWord(poolRef.current.find((p) => p.word.toLowerCase() === word) ?? null, "good");
      void speakText(meteor.word, "en", 0.95);
    } else {
      setToast("没有这颗陨石，看准释义再打");
    }
  };

  const startRound = useCallback(() => {
    stopLoop();
    endedRef.current = false;
    meteorsRef.current = [];
    startedRef.current = false;
    spawnTRef.current = 0;
    lastTRef.current = 0;
    scoreRef.current = 0;
    citiesRef.current = 3;
    shotRef.current = 0;
    poolRef.current = pool.items;
    setScore(0);
    setCities(3);
    setLegend([]);
    setToast("");
    setSpeakNoteReset();
    setBest(getBest("guard"));
    setPhase("playing");
  }, [pool.items, stopLoop]);

  const setSpeakNoteReset = () => setToast("");

  useEffect(() => {
    if (phase !== "playing") return;
    rafRef.current = requestAnimationFrame((t) => loopRef.current(t));
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => {
      window.clearTimeout(focusTimer);
      stopLoop();
    };
  }, [phase, stopLoop]);

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "陨石带着单词从天上掉下来，下方列出每颗陨石的中文释义。",
          "把对应的单词打进输入框回车即击落 +10 分，越到后面陨石越快。",
          "陨石落地摧毁一座城，3 座城全部失守就结束。",
          "手机玩法：点下面图例里的释义，单词会自动填进输入框，点「击落」即可。",
        ]}
        note={`本机最佳：${getBest("guard")} 分。击落的词照常写回记忆曲线。`}
        cta="进入防御"
        onStart={startRound}
      />
    );
  }

  if (phase === "result") {
    return (
      <GameResult
        headline={endReason}
        subline={`击落 ${shotRef.current} 颗陨石，守住到最后得分 ${scoreRef.current}。`}
        stars={scoreRef.current >= 100 ? 3 : scoreRef.current >= 60 ? 2 : scoreRef.current >= 20 ? 1 : 0}
        stats={[
          { label: "得分", value: String(score) },
          { label: "击落", value: String(shotRef.current) },
          { label: "本机最佳", value: String(best) },
        ]}
        onAgain={startRound}
        againLabel="再来一局"
      />
    );
  }

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <span className="font-mono text-[11.5px] g-mute">
          城市 <b className="g-ink">{cities}</b>/3
        </span>
        <span className="ml-auto font-mono text-[11.5px] g-mute">本机最佳 {best}</span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="mx-auto block w-full max-w-[460px] rounded-[12px]"
          style={{ background: "#10142a" }}
          aria-label="单词保卫战游戏画面"
        />

        {/* 雷达图例：每颗陨石的释义；点它=把词填进输入框（手机的主要操作方式） */}
        <div className="mt-3 min-h-[30px] rounded-[10px] bg-[#f4f6f9] px-3 py-2">
          {legend.length === 0 ? (
            <p className="text-[11.5px] g-mute">雷达静默中…输入任意单词开始防御</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {legend.map((meteor) => (
                <button
                  key={meteor.word}
                  type="button"
                  onClick={() => {
                    const input = inputRef.current;
                    if (!input) return;
                    input.value = meteor.word;
                    input.focus();
                  }}
                  className="rounded-[8px] border border-[#dfe4ec] bg-white px-2 py-1 text-[11.5px] g-ink transition-colors hover:border-[var(--game-blue)]"
                >
                  「{meteor.def}」
                </button>
              ))}
            </div>
          )}
        </div>

        <form
          className="mt-3 flex items-stretch gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = inputRef.current;
            if (!input) return;
            shoot(input.value);
            input.value = "";
            input.focus();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="输入陨石上的单词 →"
            aria-label="输入陨石上的单词"
            className="min-w-0 flex-1 rounded-[10px] border border-[#e6e9ef] bg-white px-3 py-2.5 font-mono text-[13.5px] g-ink outline-none transition-colors focus:border-[var(--game-blue)]"
          />
          <button type="submit" className="btn-game shrink-0">
            击落
          </button>
        </form>

        <p className="mt-2 min-h-[18px] text-center text-[11.5px] text-[#b3261e]">{toast}</p>
      </div>
    </div>
  );
}
