"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hearts } from "./game-hud";
import { GameError, GameIntro, GameLoading, GameResult } from "./match-ui";
import { speakText } from "@/lib/pronounce";
import {
  MAX_HEARTS,
  firstSense,
  getBest,
  reviewPoolWord,
  saveBest,
  shuffle,
  useWordPool,
  type PoolWord,
} from "./word-pool";

/**
 * 笨鸟先飞（移植自参考站的 flappy：canvas 游戏 + 每 3 分弹一次单词关）。
 *
 * 玩法：点画面/空格拍翅膀穿过管道，每飞过 3 道管道弹出一道单词四选一，
 * 答对继续飞，答错扣一条命；3 条命用完或撞管道结束。
 *
 * 跨浏览器与移动端约束（项目底线 Chrome 80 / Safari 13 / 各家安卓 WebView）：
 *   - 只用 canvas 2D + requestAnimationFrame，不碰 OffscreenCanvas / roundRect；
 *   - 画布固定 420×560 内部分辨率，CSS 宽度自适应（小屏等比缩，不溢出）；
 *   - 拍翅用 onPointerDown：鼠标、触屏、触控笔一条代码路径；
 *     加 touch-action: manipulation 压掉双击缩放，否则手机上连点会被浏览器当缩放。
 *   - canvas 上的文本一律画进 canvas，不用 DOM 覆盖层做开始提示（旧内核
 *     position 嵌套缩放会错位）。
 */

const WIDTH = 420;
const HEIGHT = 560;
const GAP = 195;
const PIPE_W = 54;
const SPEED = 1.9;
const FLAP_VY = -6.4;
const GRAVITY = 0.33;
const QUIZ_EVERY = 3;

type Pipe = { x: number; gapY: number; passed: boolean };

type Quiz = { target: PoolWord; options: { word: string; ok: boolean }[] };

type Phase = "intro" | "playing" | "result";

export function FlappyGame() {
  const pool = useWordPool(40);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const birdRef = useRef({ x: 90, y: HEIGHT / 2, vy: 0, r: 16 });
  const pipesRef = useRef<Pipe[]>([]);
  const startedRef = useRef(false);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const scoreRef = useRef(0);
  const quizNextRef = useRef(QUIZ_EVERY);
  const livesRef = useRef(MAX_HEARTS);
  const poolRef = useRef<PoolWord[]>([]);
  const quizRightRef = useRef(0);
  const quizTotalRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_HEARTS);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [endReason, setEndReason] = useState("");
  const [best, setBest] = useState(0);
  const [speakNote, setSpeakNote] = useState("");

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const endGame = useCallback(
    (why: string) => {
      stopLoop();
      livesRef.current = 0;
      const finalScore = scoreRef.current;
      setBest((b) => {
        const recorded = saveBest("flappy", finalScore);
        return recorded ? finalScore : b;
      });
      setEndReason(why);
      setQuiz(null);
      pausedRef.current = false;
      setPhase("result");
    },
    [stopLoop],
  );

  const openQuiz = useCallback(() => {
    const list = poolRef.current;
    if (list.length < 4) return;
    const target = list[Math.floor(Math.random() * list.length)];
    const options = shuffle(
      [target, ...shuffle(list.filter((p) => p.word.toLowerCase() !== target.word.toLowerCase())).slice(0, 3)].map(
        (word) => ({ word: word.word, ok: word.word.toLowerCase() === target.word.toLowerCase() }),
      ),
    );
    pausedRef.current = true;
    setQuiz({ target, options });
    void speakText(target.word, "en", 0.9);
  }, []);

  const answerQuiz = (ok: boolean, word: string) => {
    const current = quiz;
    setQuiz(null);
    pausedRef.current = false;
    quizTotalRef.current += 1;
    if (ok) quizRightRef.current += 1;
    reviewPoolWord(current?.target ?? null, ok ? "good" : "again");
    if (ok) {
      void speakText(word, "en", 0.9);
      rafRef.current = requestAnimationFrame(loopRef.current);
      return;
    }
    const nextLives = livesRef.current - 1;
    livesRef.current = nextLives;
    setLives(nextLives);
    if (nextLives <= 0) {
      endGame("答错次数用完");
      return;
    }
    rafRef.current = requestAnimationFrame(loopRef.current);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    // 背景：天空到草地的双色带（渐变直接画矩形，避免个别内核的 createLinearGradient 差异）
    ctx.fillStyle = "#bfe3ff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT - 40);
    ctx.fillStyle = "#e8f7e9";
    ctx.fillRect(0, HEIGHT - 40, WIDTH, 40);

    const bird = birdRef.current;
    for (const pipe of pipesRef.current) {
      ctx.fillStyle = "#7bb661";
      ctx.fillRect(pipe.x, 0, PIPE_W, pipe.gapY);
      ctx.fillRect(pipe.x, pipe.gapY + GAP, PIPE_W, HEIGHT - pipe.gapY - GAP);
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.fillRect(pipe.x + PIPE_W - 6, 0, 4, pipe.gapY);
      ctx.fillRect(pipe.x + PIPE_W - 6, pipe.gapY + GAP, 4, HEIGHT - pipe.gapY - GAP);
    }

    // 小鸟：身体 + 眼 + 喙
    ctx.beginPath();
    ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
    ctx.fillStyle = "#f4b942";
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bird.x + 6, bird.y - 5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(bird.x + 7, bird.y - 5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8842c";
    ctx.beginPath();
    ctx.moveTo(bird.x + bird.r, bird.y);
    ctx.lineTo(bird.x + bird.r + 9, bird.y + 3);
    ctx.lineTo(bird.x + bird.r, bird.y + 7);
    ctx.fill();

    if (!startedRef.current) {
      ctx.fillStyle = "rgba(23,24,26,.55)";
      ctx.font = "bold 20px 'Microsoft YaHei',sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("点击画面开始飞", WIDTH / 2, HEIGHT / 2 - 60);
      ctx.font = "14px 'Microsoft YaHei',sans-serif";
      ctx.fillText("点击 / 空格 = 拍翅膀", WIDTH / 2, HEIGHT / 2 - 34);
    }
  }, []);

  const spawnPipe = useCallback(() => {
    const gapY = 80 + Math.random() * (HEIGHT - GAP - 160);
    pipesRef.current.push({ x: WIDTH + 30, gapY, passed: false });
  }, []);

  const loopRef = useRef<() => void>(() => {});
  loopRef.current = () => {
    if (!canvasRef.current) return; // 组件已卸载
    if (pausedRef.current) {
      draw();
      rafRef.current = requestAnimationFrame(loopRef.current);
      return;
    }

    const bird = birdRef.current;
    if (!startedRef.current) {
      draw();
      rafRef.current = requestAnimationFrame(loopRef.current);
      return;
    }

    bird.vy += GRAVITY;
    bird.y += bird.vy;

    for (const pipe of pipesRef.current) pipe.x -= SPEED;
    if (pipesRef.current.length && pipesRef.current[0].x < -PIPE_W - 10) pipesRef.current.shift();
    const last = pipesRef.current[pipesRef.current.length - 1];
    if (!last || last.x < WIDTH - 240) spawnPipe();

    if (bird.y + bird.r > HEIGHT || bird.y - bird.r < 0) {
      endGame("撞到了边界");
      return;
    }
    for (const pipe of pipesRef.current) {
      if (bird.x + bird.r > pipe.x && bird.x - bird.r < pipe.x + PIPE_W) {
        if (bird.y - bird.r < pipe.gapY || bird.y + bird.r > pipe.gapY + GAP) {
          endGame("撞到了管道");
          return;
        }
      }
      if (!pipe.passed && pipe.x + PIPE_W < bird.x - bird.r) {
        pipe.passed = true;
        scoreRef.current += 1;
        setScore(scoreRef.current);
        if (scoreRef.current >= quizNextRef.current) {
          quizNextRef.current += QUIZ_EVERY;
          openQuiz();
        }
      }
    }
    draw();
    rafRef.current = requestAnimationFrame(loopRef.current);
  };

  const flap = useCallback(() => {
    if (phase !== "playing" || pausedRef.current) return;
    if (!startedRef.current) {
      startedRef.current = true;
      birdRef.current.vy = FLAP_VY;
      return;
    }
    birdRef.current.vy = FLAP_VY;
  }, [phase]);

  /* 游戏主循环：只在 playing 阶段跑；卸载/切页时统一清理 */
  useEffect(() => {
    if (phase !== "playing") return;
    // 重置一局
    birdRef.current = { x: 90, y: HEIGHT / 2, vy: 0, r: 16 };
    pipesRef.current = [];
    startedRef.current = false;
    pausedRef.current = false;
    scoreRef.current = 0;
    quizNextRef.current = QUIZ_EVERY;
    quizRightRef.current = 0;
    quizTotalRef.current = 0;
    livesRef.current = MAX_HEARTS;
    poolRef.current = pool.items;
    setScore(0);
    setLives(MAX_HEARTS);
    setQuiz(null);
    setSpeakNote("");
    spawnPipe();
    rafRef.current = requestAnimationFrame(loopRef.current);

    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        flap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopLoop();
    };
  }, [phase, pool.items, spawnPipe, flap, stopLoop]);

  if (pool.phase === "loading") return <GameLoading text="正在取词…" />;
  if (pool.phase === "error") return <GameError text={pool.error || "词库加载失败"} onRetry={pool.reload} />;

  if (phase === "intro") {
    return (
      <GameIntro
        bullets={[
          "点画面或按空格拍翅膀，穿过一道道管道，每过一道 +1 分。",
          "每飞过 3 道管道会弹出单词四选一（看释义选单词），飞行暂停。",
          "答对继续飞，答错扣一条命；3 条命用完或撞到管道就结束。",
          "电脑和手机都能玩：手机直接点画面就行。",
        ]}
        note={`本机最佳：${getBest("flappy")} 分。弹出的单词题照常写回记忆曲线。`}
        cta="进入游戏"
        onStart={() => setPhase("playing")}
      />
    );
  }

  if (phase === "result") {
    const rewardReady = score >= 15;
    return (
      <GameResult
        headline={endReason}
        subline={`飞越 ${score} 道管道${rewardReady ? "" : "（满 15 分算入门）"}，本机最佳 ${best} 分。`}
        stars={score >= 30 ? 3 : score >= 15 ? 2 : score >= 5 ? 1 : 0}
        stats={[
          { label: "飞越管道", value: String(score) },
          { label: "单词题", value: `${quizRightRef.current}/${quizTotalRef.current}` },
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
        <Hearts left={lives} total={MAX_HEARTS} />
        <span className="font-mono text-[11.5px] g-mute">
          得分 <b className="g-ink">{score}</b>
        </span>
        <span className="ml-auto font-mono text-[11.5px] g-mute">本机最佳 {best}</span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <div className="relative mx-auto" style={{ maxWidth: WIDTH, touchAction: "manipulation" }}>
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            onPointerDown={flap}
            className="block w-full rounded-[12px]"
            style={{ background: "#bfe3ff", cursor: "pointer" }}
            aria-label="笨鸟先飞游戏画面，点击拍翅膀"
          />
          {quiz && (
            <div
              className="absolute inset-0 flex items-center justify-center rounded-[12px] px-4"
              style={{ background: "rgba(15,23,42,.55)" }}
            >
              <div className="w-full max-w-[340px] rounded-[14px] bg-white p-4 shadow-lg">
                <p className="text-[11px] tracking-[0.18em] g-blue uppercase">单词关卡 · 第 {score} 分</p>
                <p className="mt-2 text-[15px] leading-[1.6] g-ink">{firstSense(quiz.target)}</p>
                <div className="mt-3 grid gap-2">
                  {quiz.options.map((option, index) => (
                    <button
                      key={`${option.word}-${index}`}
                      type="button"
                      onClick={() => answerQuiz(option.ok, option.word)}
                      className="rounded-[10px] border border-[#e6e9ef] bg-white px-3 py-2.5 text-left font-mono text-[13.5px] g-ink transition-colors hover:border-[var(--game-blue)]"
                    >
                      {option.word}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <p className="mt-2.5 text-center text-[11.5px] leading-[1.7] g-mute">
          点击画面 / 空格键 = 拍翅膀 · 每过 3 道管道弹出单词关{speakNote ? ` · ${speakNote}` : ""}
        </p>
      </div>
    </div>
  );
}
