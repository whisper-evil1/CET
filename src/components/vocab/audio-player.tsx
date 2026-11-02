"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { canPronounce, speakText, stopSpeaking } from "@/lib/pronounce";
import type { VocabItem } from "@/lib/types";

type Props = {
  words: VocabItem[];
  onExit: () => void;
};

type Mode = "both" | "en" | "zh";
type PlayState = "idle" | "playing" | "paused";

const PAUSE_OPTIONS = [3, 5, 8, 12] as const;
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5] as const;

/**
 * 随身听模式：自动连播
 * - 发音走 lib/pronounce：先播音频文件、再退回语音合成，
 *   所以没有语音引擎的安卓内置浏览器（百度 / 迅雷）也能出声
 * - 三种模式：英+中 / 仅英 / 仅中
 * - 语速 0.5-1.5x 可调
 * - 回忆停顿 3/5/8/12 秒可调（读完释义后等多久再切下一个）
 * - 暂停/继续/上一个/下一个/进度条
 * - visibilitychange 时自动暂停
 * - 两种发声方式都不可用时显示降级提示
 * - 底部"这个我认识"按钮计入 reviewCount
 */
export function AudioPlayer({ words, onExit }: Props) {
  // 乐观按「可用」渲染，挂载后再按真实能力校正，避免 SSR 与客户端首屏不一致
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(canPronounce());
  }, []);

  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("both");
  const [rate, setRate] = useState<number>(1);
  const [pauseSec, setPauseSec] = useState<number>(5);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [knownCount, setKnownCount] = useState(0);

  // refs 保存最新值，供 speak 回调读取（避免闭包陷阱）
  const stateRef = useRef({ mode, rate, pauseSec, playState, index, wordsLen: words.length });
  stateRef.current = { mode, rate, pauseSec, playState, index, wordsLen: words.length };

  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentWord = words[index];

  /* ---------- 核心：朗读一个词的英文 + 中文，读完再驱动下一步 ---------- */
  const playOne = useCallback((word: VocabItem | undefined, onComplete: () => void) => {
    if (!word) {
      onComplete();
      return;
    }
    stopSpeaking();

    const { mode: m, rate: r } = stateRef.current;
    const zhText = word.definitions.map((d) => `${d.pos} ${d.zh}`).join("；") || "";

    void (async () => {
      // 每一步前后都检查播放状态：中途暂停/切词时不再继续念
      if (m !== "zh") {
        if (stateRef.current.playState !== "playing") return;
        await speakText(word.word, "en", r);
      }
      if (m !== "en" && zhText) {
        if (stateRef.current.playState !== "playing") return;
        await speakText(zhText, "zh", r * 0.95);
      }
      if (stateRef.current.playState !== "playing") return;
      onComplete();
    })();
  }, []);

  /* ---------- 朗读当前词 → 停顿 → 切下一个 ---------- */
  const playCurrent = useCallback(() => {
    if (stateRef.current.playState !== "playing") return;
    const word = words[stateRef.current.index];
    if (!word) return;

    playOne(word, () => {
      // 朗读完成，等回忆停顿后切下一个
      if (stateRef.current.playState !== "playing") return;
      pauseTimerRef.current = setTimeout(() => {
        if (stateRef.current.playState !== "playing") return;
        if (stateRef.current.index < stateRef.current.wordsLen - 1) {
          setIndex((prev) => prev + 1);
        } else {
          // 播完了
          setPlayState("idle");
        }
      }, stateRef.current.pauseSec * 1000);
    });
  }, [words, playOne]);

  /* ---------- index 变化时自动朗读 ---------- */
  useEffect(() => {
    if (playState === "playing") {
      playCurrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  /* ---------- 开始/暂停/继续 ---------- */
  const startPlaying = () => {
    setPlayState("playing");
    // 触发 playCurrent（通过 useEffect index 依赖不会变，需手动调）
    setTimeout(() => playCurrent(), 50);
  };

  const togglePause = () => {
    if (playState === "playing") {
      setPlayState("paused");
      stopSpeaking();
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    } else if (playState === "paused") {
      setPlayState("playing");
      setTimeout(() => playCurrent(), 50);
    }
  };

  const goPrev = () => {
    stopSpeaking();
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    setIndex((prev) => Math.max(0, prev - 1));
    if (playState === "playing") {
      // 延迟一点让 index 更新后再播
      setTimeout(() => playCurrent(), 100);
    }
  };

  const goNext = () => {
    stopSpeaking();
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    setIndex((prev) => Math.min(words.length - 1, prev + 1));
    if (playState === "playing") {
      setTimeout(() => playCurrent(), 100);
    }
  };

  /* ---------- visibilitychange 暂停 ---------- */
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && playState === "playing") {
        setPlayState("paused");
        stopSpeaking();
        if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [playState]);

  /* ---------- 清理 ---------- */
  useEffect(() => {
    return () => {
      stopSpeaking();
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  /* ---------- "这个我认识" ---------- */
  const markKnown = async () => {
    if (!currentWord) return;
    try {
      await postJson(`/api/vocab/${currentWord.id}/review`, { result: "known" });
      setKnownCount((prev) => prev + 1);
    } catch {
      // 静默
    }
    goNext();
  };

  if (!supported) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-16 text-center">
        <button
          type="button"
          onClick={onExit}
          className="mb-8 text-[13px] text-ink-mute hover:text-ink"
        >
          ← 返回词表
        </button>
        <p className="font-serif text-[20px] text-ink">这个浏览器放不出声音</p>
        <p className="mt-3 text-[13px] text-ink-mute">
          随身听需要能播放音频文件或使用语音合成，当前浏览器两种都不可用。
          <br />
          换 Chrome / Safari / 微信打开即可。
        </p>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-16 text-center">
        <button onClick={onExit} className="mb-8 text-[13px] text-ink-mute hover:text-ink">
          ← 返回词表
        </button>
        <p className="text-[13.5px] text-ink-soft">生词本是空的</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-60px)] max-w-[640px] flex-col px-5 pb-8">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-line py-4">
        <button onClick={onExit} className="text-[13px] text-ink-mute hover:text-ink">
          ← 返回词表
        </button>
        <span className="font-mono text-[12px] text-ink-mute">
          {index + 1} / {words.length}
        </span>
        <span className="text-[12px] text-correct">本次认识 {knownCount}</span>
      </div>

      {/* 进度条 */}
      <div className="mt-3 h-[3px] w-full bg-line-soft">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${((index + 1) / words.length) * 100}%` }}
        />
      </div>

      {/* 当前词卡片 */}
      <div className="flex flex-1 flex-col justify-center">
        <div className="rounded-[14px] border border-line bg-surface px-8 py-10 text-center">
          <p className="font-serif text-[34px] leading-tight tracking-tight text-ink">
            {currentWord?.word}
          </p>
          {currentWord?.phonetic && (
            <p className="mt-2 font-mono text-[12px] text-ink-mute">{currentWord.phonetic}</p>
          )}
          {currentWord && currentWord.definitions.length > 0 && (
            <div className="mt-5 border-t border-line-soft pt-4">
              {currentWord.definitions.map((d, i) => (
                <p key={i} className="text-[13.5px] leading-[1.7] text-ink-soft">
                  {d.pos} {d.zh}
                </p>
              ))}
            </div>
          )}
          {currentWord?.definitions.length === 0 && (
            <p className="mt-5 text-[12.5px] italic text-ink-mute">释义待补</p>
          )}
        </div>
      </div>

      {/* 播放控制 */}
      <div className="space-y-4">
        {/* 模式 + 语速 + 停顿 */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-[12px]">
          <div className="flex gap-1">
            {(
              [
                { key: "both" as const, label: "英+中" },
                { key: "en" as const, label: "仅英" },
                { key: "zh" as const, label: "仅中" },
              ]
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMode(m.key)}
                className={`rounded-full px-2.5 py-1 transition-colors ${
                  mode === m.key ? "bg-ink text-paper" : "text-ink-mute hover:bg-paper-deep"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1 text-ink-mute">
            语速
            <select
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink"
            >
              {RATE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}x</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-ink-mute">
            停顿
            <select
              value={pauseSec}
              onChange={(e) => setPauseSec(Number(e.target.value))}
              className="rounded border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink"
            >
              {PAUSE_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}s</option>
              ))}
            </select>
          </label>
        </div>

        {/* 播放按钮组 */}
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={goPrev}
            disabled={index === 0}
            className="h-10 w-10 rounded-full border border-line text-[16px] text-ink-soft transition-colors hover:border-ink-mute disabled:opacity-30"
            aria-label="上一个"
          >
            ⏮
          </button>

          {playState === "idle" ? (
            <button
              type="button"
              onClick={startPlaying}
              className="h-14 w-14 rounded-full bg-ink text-[20px] text-paper transition-opacity hover:opacity-90"
              aria-label="开始播放"
            >
              ▶
            </button>
          ) : (
            <button
              type="button"
              onClick={togglePause}
              className="h-14 w-14 rounded-full bg-ink text-[20px] text-paper transition-opacity hover:opacity-90"
              aria-label={playState === "playing" ? "暂停" : "继续"}
            >
              {playState === "playing" ? "⏸" : "▶"}
            </button>
          )}

          <button
            type="button"
            onClick={goNext}
            disabled={index >= words.length - 1}
            className="h-10 w-10 rounded-full border border-line text-[16px] text-ink-soft transition-colors hover:border-ink-mute disabled:opacity-30"
            aria-label="下一个"
          >
            ⏭
          </button>
        </div>

        {/* 这个我认识 */}
        <button
          type="button"
          onClick={markKnown}
          className="w-full rounded-[10px] border border-correct py-3 text-[13px] text-correct transition-colors hover:bg-correct-soft"
        >
          ✓ 这个我认识
        </button>

        {playState === "paused" && (
          <p className="text-center text-[11px] text-ink-mute">已暂停，点 ▶ 继续</p>
        )}
      </div>
    </div>
  );
}
