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

const CELL = 28;
const COLS = 16;
const ROWS = 16;
const START_TICK_MS = 240;
const MIN_TICK_MS = 130;
const SPEEDUP_PER_FOOD = 5;
/** 两个食物之间至少隔几个格子：词卡比格子宽，太近会叠在一起看不清 */
const FOOD_MIN_GAP = 4;

type Point = { x: number; y: number };
type Food = Point & { word: string; good: boolean };

type Phase = "intro" | "playing" | "result";

function freeCell(snake: Point[], foods: Food[]): Point {
  for (let t = 0; t < 300; t++) {
    // 留出最外一圈：词卡比格子宽，贴着边界会画到画布外被切掉
    const x = 1 + Math.floor(Math.random() * (COLS - 2));
    const y = 1 + Math.floor(Math.random() * (ROWS - 2));
    if (snake.some((s) => s.x === x && s.y === y)) continue;
    // 词卡向左右各有溢出，食物挨太近会互相压住；按切比雪夫距离留出间隔
    if (foods.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) < FOOD_MIN_GAP)) continue;
    return { x, y };
  }
  return { x: 1, y: 1 };
}

/** 圆角矩形：旧内核没有 ctx.roundRect，用 arcTo 手写一份 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 词卡字号：词越长字越小，但都不低于 12px，保证在 448px 画布里一眼能读 */
function labelFont(word: string): { size: number; weight: number } {
  const n = word.length;
  if (n <= 5) return { size: 16, weight: 700 };
  if (n <= 8) return { size: 15, weight: 600 };
  if (n <= 11) return { size: 13.5, weight: 600 };
  return { size: 12.5, weight: 600 };
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

    const W = canvas.width;
    const H = canvas.height;

    // 底色跟站点纸张同色，格子线极淡 —— 只用来判断距离，不抢单词的注意力
    ctx.fillStyle = "#f7f4ec";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#eae3d6";
    ctx.lineWidth = 1;
    for (let i = 1; i < COLS; i += 1) {
      const x = Math.round(i * CELL) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let i = 1; i < ROWS; i += 1) {
      const y = Math.round(i * CELL) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // 蛇身：圆角方块，头部深一档并带眼睛，方向一眼可辨
    const snake = snakeRef.current;
    snake.forEach((seg, index) => {
      const x = seg.x * CELL + 2.5;
      const y = seg.y * CELL + 2.5;
      const s = CELL - 5;
      if (index === 0) {
        ctx.fillStyle = "#4f7146";
        roundRect(ctx, x, y, s, s, 9);
        ctx.fill();

        const dir = dirRef.current;
        const cx = seg.x * CELL + CELL / 2;
        const cy = seg.y * CELL + CELL / 2;
        const perp = 5;
        const fwd = 4;
        const ox = -dir.y * perp;
        const oy = dir.x * perp;
        const ex = cx + dir.x * fwd;
        const ey = cy + dir.y * fwd;
        for (const sign of [-1, 1]) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(ex + ox * sign, ey + oy * sign, 2.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#243020";
          ctx.beginPath();
          ctx.arc(ex + ox * sign + dir.x * 1.1, ey + oy * sign + dir.y * 1.1, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      ctx.fillStyle = index % 2 === 0 ? "#93b487" : "#a3c096";
      roundRect(ctx, x, y, s, s, 7);
      ctx.fill();
    });

    // 词卡：白底 + 细描边压在棋盘上；目标词用暖金边，干扰词用暖灰边
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const food of foodsRef.current) {
      const { size, weight } = labelFont(food.word);
      ctx.font = `${weight} ${size}px "Microsoft YaHei","PingFang SC",sans-serif`;
      const textW = ctx.measureText(food.word).width;
      const w = Math.min(Math.max(textW + 20, CELL * 2.4), CELL * 4.9);
      const h = Math.round(CELL * 0.94);
      const cx = food.x * CELL + CELL / 2;
      const cy = food.y * CELL + CELL / 2;
      // 夹在画布内：贴边的食物不许把词卡画到外面去
      const x = Math.min(Math.max(cx - w / 2, 4), W - w - 4);
      const y = Math.min(Math.max(cy - h / 2, 4), H - h - 4);

      ctx.save();
      ctx.shadowColor = "rgba(48,38,24,0.16)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = food.good ? "#fff7e2" : "#f4f1ea";
      roundRect(ctx, x, y, w, h, 9);
      ctx.fill();
      ctx.restore();

      ctx.lineWidth = 2;
      ctx.strokeStyle = food.good ? "#c08a2e" : "#b6ac9b";
      roundRect(ctx, x, y, w, h, 9);
      ctx.stroke();

      ctx.fillStyle = food.good ? "#6b4a12" : "#4a443a";
      // 以「卡片矩形」为基准居中，而不是格子中心：贴边时卡片被夹回来，字也要跟着走
      ctx.fillText(food.word, x + w / 2, y + h / 2 + 1, w - 14);
    }
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
          <p className="mt-0.5 text-[17px] font-medium g-ink">「{targetDef}」</p>
        </div>

        <div
          className="mx-auto mt-3"
          style={{ maxWidth: COLS * CELL, touchAction: "none" }}
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
            className="block w-full rounded-[12px] border border-[#e7dfd2]"
            style={{ background: "#f7f4ec" }}
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
