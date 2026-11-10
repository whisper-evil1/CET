"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import { firstSense, getBest, reviewPoolWord, saveBest, shuffle, useWordPool, type PoolWord } from "./word-pool";

/**
 * 单词贪吃蛇（移植自参考站的 snake）。
 *
 * 玩法：场上同时有 3 个单词食物，顶部给一条释义，吃到对应的词 +10 分、
 * 变长、加速；吃错蛇缩短 2 节；撞墙或撞自己结束。
 *
 * 操控（参考站只有键盘 + 方向按钮，手机上按钮太小）：
 *   - 键盘：方向键 / WASD
 *   - 触屏：在画布上**滑动**转向（主操作），下方的按钮保留做备用
 *   - 防呆：不能直接 180° 掉头（会立刻撞死自己），和参考站一致
 */

const CELL = 21;
const COLS = 20;
const ROWS = 20;
const START_TICK_MS = 220;
const MIN_TICK_MS = 110;
const SPEEDUP_PER_FOOD = 4;

type Point = { x: number; y: number };
type Food = Point & { word: string; good: boolean };

type Phase = "intro" | "playing" | "result";

function freeCell(snake: Point[], foods: Food[]): Point {
  for (let t = 0; t < 200; t++) {
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);
    if (!snake.some((s) => s.x === x && s.y === y) && !foods.some((f) => f.x === x && f.y === y)) {
      return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

export function SnakeGame() {
  const pool = useWordPool(40);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snakeRef = useRef<Point[]>([]);
  const dirRef = useRef<Point>({ x: 1, y: 0 });
  const nextDirRef = useRef<Point>({ x: 1, y: 0 });
  const foodsRef = useRef<Food[]>([]);
  const targetRef = useRef<PoolWord | null>(null);
  const poolRef = useRef<PoolWord[]>([]);
  const tickRef = useRef(START_TICK_MS);
  const timerRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const scoreRef = useRef(0);
  const eatenRef = useRef(0);
  const swipeRef = useRef<Point | null>(null);

  const [phase, setPhase] = useState<Phase>("intro");
  const [score, setScore] = useState(0);
  const [length, setLength] = useState(4);
  const [targetDef, setTargetDef] = useState("…");
  const [best, setBest] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.fillStyle = "#eef4e8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 食物：目标词金黄、干扰词灰蓝，词太长截 8 个字符（21px 格子放不下）
    ctx.textAlign = "center";
    for (const food of foodsRef.current) {
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fillStyle = food.good ? "#f4b942" : "#9db2c4";
      ctx.fill();
      ctx.fillStyle = "#333";
      ctx.font = "bold 10px 'Microsoft YaHei',sans-serif";
      ctx.fillText(food.word.slice(0, 8), food.x * CELL + CELL / 2, food.y * CELL + CELL / 2 + 3);
    }

    snakeRef.current.forEach((seg, index) => {
      ctx.fillStyle = index === 0 ? "#4e9a3d" : "#79c267";
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  const newTarget = useCallback(() => {
    const list = poolRef.current;
    if (list.length === 0) return;
    const target = list[Math.floor(Math.random() * list.length)];
    targetRef.current = target;
    setTargetDef(firstSense(target));

    const foods: Food[] = [];
    const others = shuffle(list.filter((p) => p.word.toLowerCase() !== target.word.toLowerCase())).slice(0, 2);
    for (const word of [target, ...others]) {
      const cell = freeCell(snakeRef.current, foods);
      foods.push({ ...cell, word: word.word, good: word.word.toLowerCase() === target.word.toLowerCase() });
    }
    foodsRef.current = foods;
  }, []);

  const endGame = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setBest((b) => {
      const recorded = saveBest("snake", scoreRef.current);
      return recorded ? scoreRef.current : b;
    });
    setPhase("result");
  }, []);

  const turn = useCallback((x: number, y: number) => {
    const dir = dirRef.current;
    // 不能直接掉头
    if (x === -dir.x && y === -dir.y) return;
    nextDirRef.current = { x, y };
  }, []);

  const step = useCallback(() => {
    if (endedRef.current) return;
    const snake = snakeRef.current;
    dirRef.current = nextDirRef.current;
    const head = { x: snake[0].x + dirRef.current.x, y: snake[0].y + dirRef.current.y };
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || hitSelf) {
      endGame();
      return;
    }

    snake.unshift(head);
    const foodIndex = foodsRef.current.findIndex((f) => f.x === head.x && f.y === head.y);
    if (foodIndex >= 0) {
      const food = foodsRef.current[foodIndex];
      if (food.good) {
        scoreRef.current += 10;
        eatenRef.current += 1;
        setScore(scoreRef.current);
        setLength(snake.length);
        reviewPoolWord(targetRef.current, "good");
        void speakText(food.word, "en", 0.95);
        tickRef.current = Math.max(MIN_TICK_MS, tickRef.current - SPEEDUP_PER_FOOD);
        restartTimer();
        newTarget();
      } else {
        if (snake.length > 3) {
          snake.pop();
          snake.pop();
        }
        setLength(snake.length);
        foodsRef.current.splice(foodIndex, 1);
        const cell = freeCell(snakeRef.current, foodsRef.current);
        foodsRef.current.push({ ...cell, word: food.word, good: false });
      }
    } else {
      snake.pop();
      setLength(snake.length);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, endGame, newTarget]);

  const restartTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => step(), tickRef.current);
  }, [step]);

  /* 一局的启动与清理 */
  useEffect(() => {
    if (phase !== "playing") return;
    endedRef.current = false;
    snakeRef.current = [
      { x: 8, y: 10 },
      { x: 7, y: 10 },
      { x: 6, y: 10 },
      { x: 5, y: 10 },
    ];
    dirRef.current = { x: 1, y: 0 };
    nextDirRef.current = { x: 1, y: 0 };
    tickRef.current = START_TICK_MS;
    scoreRef.current = 0;
    eatenRef.current = 0;
    poolRef.current = pool.items;
    setScore(0);
    setLength(4);
    setBest(getBest("snake"));
    newTarget();
    draw();
    restartTimer();

    const onKey = (event: KeyboardEvent) => {
      const map: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        KeyW: [0, -1],
        KeyS: [0, 1],
        KeyA: [-1, 0],
        KeyD: [1, 0],
      };
      const dir = map[event.code];
      if (dir) {
        event.preventDefault();
        turn(dir[0], dir[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, pool.items, newTarget, draw, restartTimer, turn]);

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "场上同时有 3 个单词食物，顶部给一条释义，吃到对应单词 +10 分。",
          "吃对变长加速，吃错缩短 2 节；撞墙或撞自己结束。",
          "操控：电脑方向键 / WASD；手机在画布上直接滑动转向，下方按钮备用。",
          "吃到的词照常写回记忆曲线。",
        ]}
        note={`本机最佳：${getBest("snake")} 分。`}
        cta="进入游戏"
        onStart={() => setPhase("playing")}
      />
    );
  }

  if (phase === "result") {
    return (
      <GameResult
        headline="游戏结束"
        subline={`吃到 ${eatenRef.current} 个正确单词，最终长度 ${length}。`}
        stars={scoreRef.current >= 100 ? 3 : scoreRef.current >= 50 ? 2 : scoreRef.current >= 20 ? 1 : 0}
        stats={[
          { label: "得分", value: String(scoreRef.current) },
          { label: "吃对", value: String(eatenRef.current) },
          { label: "本机最佳", value: String(best) },
        ]}
        onAgain={() => setPhase("playing")}
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
          长度 <b className="g-ink">{length}</b>
        </span>
        <span className="ml-auto font-mono text-[11.5px] g-mute">本机最佳 {best}</span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <div className="rounded-[12px] g-blue-soft-bg px-4 py-2.5 text-center">
          <p className="text-[11.5px] g-blue-deep">吃掉释义为这条的单词</p>
          <p className="mt-0.5 text-[15px] font-medium g-ink">「{targetDef}」</p>
        </div>

        <div
          className="mx-auto mt-3"
          style={{ maxWidth: 420, touchAction: "none" }}
          onPointerDown={(event) => {
            swipeRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={(event) => {
            const start = swipeRef.current;
            swipeRef.current = null;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // 轻点不转向
            if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
            else turn(0, dy > 0 ? 1 : -1);
          }}
        >
          <canvas
            ref={canvasRef}
            width={COLS * CELL}
            height={ROWS * CELL}
            className="block w-full rounded-[12px]"
            style={{ background: "#eef4e8" }}
            aria-label="单词贪吃蛇游戏画面，滑动转向"
          />
        </div>

        {/* 方向按钮：手机上滑动的备用方案，桌面也可以点 */}
        <div className="mx-auto mt-3 grid w-[168px] grid-cols-3 gap-1.5" aria-hidden="false">
          <span />
          <button type="button" onClick={() => turn(0, -1)} className="btn-game-ghost !px-0 text-center" aria-label="向上">
            ↑
          </button>
          <span />
          <button type="button" onClick={() => turn(-1, 0)} className="btn-game-ghost !px-0 text-center" aria-label="向左">
            ←
          </button>
          <button type="button" onClick={() => turn(0, 1)} className="btn-game-ghost !px-0 text-center" aria-label="向下">
            ↓
          </button>
          <button type="button" onClick={() => turn(1, 0)} className="btn-game-ghost !px-0 text-center" aria-label="向右">
            →
          </button>
        </div>

        <p className="mt-3 text-center text-[11.5px] leading-[1.7] g-mute">
          方向键 / WASD / 滑动 / 按钮 = 转向 · 吃对变长，吃错变短
        </p>
      </div>
    </div>
  );
}
