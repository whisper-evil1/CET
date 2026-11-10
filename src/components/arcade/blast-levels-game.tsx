"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { ComboBadge, TimerRing } from "./game-hud";
import { GameError, GameIntro, GameLoading } from "./match-ui";
import { getBest, localProgress, saveBest, saveLocalProgress, shuffle, shortDef } from "./word-pool";

/**
 * 单词消消乐（移植自参考站的 blastlv：12 关关卡制消除）。
 *
 * 玩法：12 关真题高频词按难度递增，每关 10 对英文↔中文，120 秒内清完算通过，
 * 通过第 n 关解锁第 n+1 关。解锁进度存 localStorage —— 这是单机进度，
 * 不进数据库（和参考站一致），换设备/清缓存会重来，无伤大雅。
 *
 * 和参考站的差异：
 *   - 分级词库来自 /api/vocab/game-levels（本站词书按词频 rank 分级），
 *     同一关的词永远固定 —— 参考站靠题库语料，本站靠词书，口径等价；
 *   - 第 n 关的词都是词书词（不在生词本里），所以**不写记忆曲线**：
 *     没收藏过的词谈不上复习，想收进生词本去词书一键导入。
 */

const LEVEL_WORDS = 10;
const LEVEL_SECONDS = 120;
const MISMATCH_MS = 380;

type LevelWord = {
  word: string;
  phonetic: string | null;
  definition: string;
  pos: string;
  mine: boolean;
};

type LevelData = { level: number; name: string; count: number; words: LevelWord[] };

type Tile = { key: string; pair: number; kind: "en" | "zh"; text: string };

type Phase = "intro" | "map" | "playing" | "result";

function buildTiles(words: LevelWord[]): Tile[] {
  const out: Tile[] = [];
  words.forEach((word, index) => {
    out.push({ key: `e${index}`, pair: index, kind: "en", text: word.word });
    out.push({ key: `z${index}`, pair: index, kind: "zh", text: shortDef(word, 16) });
  });
  return out;
}

function shuffled<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function BlastLevelsGame() {
  const [dataPhase, setDataPhase] = useState<"loading" | "error" | "ready">("loading");
  const [levels, setLevels] = useState<LevelData[]>([]);
  const [error, setError] = useState("");
  const [view, setView] = useState<Phase>("intro");
  const [unlocked, setUnlocked] = useState(0);
  const [best, setBest] = useState(0);

  const [level, setLevel] = useState<LevelData | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [bad, setBad] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [cleared, setCleared] = useState<string[]>([]);
  const [clearedCount, setClearedCount] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [peakCombo, setPeakCombo] = useState(0);
  const [left, setLeft] = useState(LEVEL_SECONDS);
  const [outOfTime, setOutOfTime] = useState(false);
  const [newRecord, setNewRecord] = useState(false);

  const timerRef = useRef<number | null>(null);
  const lockRef = useRef<number | null>(null);
  const tileByKey = useRef(new Map<string, Tile>());

  const stopTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (lockRef.current !== null) {
      window.clearTimeout(lockRef.current);
      lockRef.current = null;
    }
  }, []);

  useEffect(() => stopTimers, [stopTimers]);

  const load = useCallback(async () => {
    setDataPhase("loading");
    setError("");
    try {
      const data = await apiFetch<{ levels: LevelData[]; enough: boolean }>("/api/vocab/game-levels");
      setLevels(data.levels ?? []);
      setDataPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "关卡加载失败");
      setDataPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
    setUnlocked(localProgress("blastlv-unlocked"));
    setBest(getBest("blastlv"));
  }, [load]);

  const enterLevel = (data: LevelData) => {
    stopTimers();
    tileByKey.current = new Map();
    const built = shuffled(buildTiles(data.words));
    built.forEach((tile) => tileByKey.current.set(tile.key, tile));
    setLevel(data);
    setTiles(built);
    setPicked([]);
    setBad([]);
    setLocked(false);
    setCleared([]);
    setClearedCount(0);
    setScore(0);
    setCombo(0);
    setPeakCombo(0);
    setLeft(LEVEL_SECONDS);
    setOutOfTime(false);
    setNewRecord(false);
    setView("playing");
  };

  useEffect(() => {
    if (view !== "playing") return;
    timerRef.current = window.setInterval(() => {
      setLeft((value) => (value > 0 ? value - 1 : 0));
    }, 1000);
    return stopTimers;
  }, [view, stopTimers]);

  const finish = useCallback(
    (won: boolean) => {
      stopTimers();
      if (won && level) {
        if (level.level > localProgress("blastlv-unlocked")) {
          saveLocalProgress("blastlv-unlocked", level.level);
          setUnlocked(level.level);
        }
        setNewRecord(saveBest("blastlv", score));
        setBest(getBest("blastlv"));
      }
      setOutOfTime(!won);
      setView("result");
    },
    [level, score, stopTimers],
  );

  useEffect(() => {
    if (view !== "playing" || left > 0) return;
    finish(false);
  }, [left, view, finish]);

  const onPick = (key: string) => {
    if (view !== "playing" || locked) return;
    if (cleared.includes(key) || picked.includes(key)) return;

    const next = [...picked, key];
    setPicked(next);
    if (next.length < 2) return;

    const first = tileByKey.current.get(next[0]);
    const second = tileByKey.current.get(next[1]);
    if (!first || !second) {
      setPicked([]);
      return;
    }

    if (first.pair === second.pair && first.kind !== second.kind) {
      const nextCleared = [...cleared, first.key, second.key];
      setCleared(nextCleared);
      setPicked([]);
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setPeakCombo((peak) => (nextCombo > peak ? nextCombo : peak));
      setScore((value) => value + 10 + (nextCombo - 1) * 2);
      const nextCount = clearedCount + 1;
      setClearedCount(nextCount);
      if (nextCount >= LEVEL_WORDS) {
        finish(true);
      }
      return;
    }

    setCombo(0);
    setLocked(true);
    setBad(next);
    lockRef.current = window.setTimeout(() => {
      setBad([]);
      setPicked([]);
      setLocked(false);
      lockRef.current = null;
    }, MISMATCH_MS);
  };

  if (dataPhase === "loading") return <GameLoading text="正在生成分级词库…" />;
  if (dataPhase === "error") return <GameError text={error || "关卡加载失败"} onRetry={() => void load()} />;

  if (view === "intro") {
    return (
      <GameIntro
        bullets={[
          "12 关全部取自词书里的真题高频难词，按词长 + 生僻度递增排布。",
          `每关 ${LEVEL_WORDS} 对英文↔中文，${LEVEL_SECONDS} 秒内清完算通过；通过第 n 关解锁第 n+1 关。`,
          "连击越长单对加分越高；点错一对不扣分，只断连击。",
          "进度存在本机（过到第几关、各游戏最佳分），换设备或清缓存会重来。",
        ]}
        note={unlocked > 0 ? `当前已通关 ${unlocked} 关，第 ${Math.min(unlocked + 1, 12)} 关已解锁。` : "还没通过关，从第 1 关开始。"}
        cta="进入关卡地图"
        onStart={() => setView("map")}
      />
    );
  }

  if (view === "map") {
    return (
      <div className="card-soft mt-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-[19px] g-ink">关卡地图</h2>
          <span className="text-[11.5px] g-mute">
            已通关 {unlocked} / {levels.length} 关 · 本机最佳 {best} 分
          </span>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-[1.8] g-mute">
          第 n 关的词比第 n-1 关更长更生僻。过关解锁下一关，随时可以回头重刷旧关。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {levels.map((data) => {
            const open = data.level <= unlocked + 1;
            return (
              <button
                key={data.level}
                type="button"
                disabled={!open}
                onClick={() => enterLevel(data)}
                className={`rounded-[14px] border p-3 text-left transition-colors ${
                  open
                    ? "border-[#d7e3fb] bg-[var(--game-blue-soft)] hover:border-[var(--game-blue)]"
                    : "cursor-not-allowed border-[#e6e9ef] bg-[#f6f7f9] opacity-70"
                }`}
              >
                <p className="font-mono text-[17px] font-semibold g-blue-deep">
                  {open ? data.level : "🔒"}
                </p>
                <p className="mt-1 text-[12.5px] font-medium g-ink">{data.name}</p>
                <p className="mt-0.5 text-[10.5px] g-mute">
                  {open ? `${LEVEL_WORDS} 对 · ${LEVEL_SECONDS}s` : `先通过第 ${data.level - 1} 关`}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button type="button" onClick={() => setView("intro")} className="btn-game-ghost">
            返回说明页
          </button>
          <Link href="/arcade" className="btn-game-ghost">
            回游戏厅
          </Link>
        </div>
      </div>
    );
  }

  if (view === "result" && level) {
    return (
      <div className="card-soft mt-5 p-6 sm:p-8">
        <p className="text-[10.5px] tracking-[0.24em] g-blue uppercase">
          {outOfTime ? "Time up" : "Level clear"}
        </p>
        <h2 className="mt-2 font-serif text-[22px] g-ink">
          {outOfTime ? `第 ${level.level} 关没清完` : `第 ${level.level} 关通过`}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-[1.8] g-mute">
          {outOfTime
            ? `清了 ${clearedCount}/${LEVEL_WORDS} 对。这一关的词都在词书高频段，多刷一遍就熟。`
            : `清完全部 ${LEVEL_WORDS} 对${newRecord ? "，刷新本机最佳" : ""}。${
                level.level < levels.length ? `第 ${level.level + 1} 关「${levels[level.level]?.name ?? ""}」已解锁。` : "你已通关全部 12 关。"
              }`}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {[
            { label: "得分", value: String(score) },
            { label: "消除", value: `${clearedCount}/${LEVEL_WORDS}` },
            { label: "最高连击", value: String(peakCombo) },
          ].map((cell) => (
            <div key={cell.label} className="rounded-[12px] border g-line px-3 py-2.5">
              <p className="text-[10.5px] g-mute">{cell.label}</p>
              <p className="mt-1 font-mono text-[17px] leading-none font-semibold g-ink">{cell.value}</p>
            </div>
          ))}
        </div>

        {!outOfTime && clearedCount < LEVEL_WORDS && null}

        <div className="mt-6 flex flex-wrap gap-2.5">
          {outOfTime && (
            <button type="button" onClick={() => enterLevel(level)} className="btn-game">
              重试本关
            </button>
          )}
          {!outOfTime && level.level < levels.length && levels[level.level] && (
            <button type="button" onClick={() => enterLevel(levels[level.level])} className="btn-game">
              挑战第 {level.level + 1} 关
            </button>
          )}
          <button type="button" onClick={() => setView("map")} className="btn-game-ghost">
            回关卡地图
          </button>
          <Link href="/arcade" className="btn-game-ghost">
            回游戏厅
          </Link>
        </div>
      </div>
    );
  }

  if (!level) return null;

  return (
    <div className="card-soft mt-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b g-line bg-[#fbfcfe] px-4 py-2.5 sm:px-5">
        <span className="text-[12px] font-medium g-ink">
          第 {level.level} 关 · {level.name}
        </span>
        <ComboBadge combo={combo} />
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11.5px] g-mute">{score} 分</span>
          <span className="font-mono text-[11.5px] g-mute">
            {clearedCount}/{LEVEL_WORDS}
          </span>
          <TimerRing left={left} total={LEVEL_SECONDS} />
        </span>
      </div>

      <div className="px-3 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {tiles.map((tile) => {
            const isCleared = cleared.includes(tile.key);
            const isPicked = picked.includes(tile.key);
            const isBad = bad.includes(tile.key);
            const tone = isCleared
              ? "border-[#cdeee1] bg-[var(--game-green-soft)] text-[#0f766e] opacity-45"
              : isBad
                ? "border-[#f7c9c9] bg-[#fdecec] text-[#b3261e]"
                : isPicked
                  ? "border-[var(--game-blue)] bg-[var(--game-blue-soft)] g-blue-deep"
                  : "border-[#e6e9ef] bg-white g-ink hover:border-[#c9d2e0]";
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => onPick(tile.key)}
                disabled={isCleared}
                className={`flex min-h-[60px] items-center justify-center rounded-[12px] border px-2 py-2 text-center leading-[1.4] transition-colors ${tone} ${
                  tile.kind === "en" ? "font-mono text-[12.5px] font-medium break-all" : "text-[11.5px]"
                }`}
              >
                {tile.text}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11.5px] leading-[1.7] g-mute">
          点一个英文、再点它的中文释义。这一关的词不在你的生词本里，想收藏去词书一键导入。
        </p>
      </div>
    </div>
  );
}
