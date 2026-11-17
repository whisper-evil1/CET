"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  fmtTime,
  followPassage,
  getAudioState,
  restart,
  retry,
  seek,
  setRate,
  subscribeAudio,
  toggle,
} from "@/lib/listening-audio-client";
import { ListeningTranscript } from "./listening-transcript";

type Props = {
  paperId: string;
  /** 这一段的库内 id：拉原文用 */
  passageId: string;
  /** 该套卷听力第几段（0 起） */
  index: number;
  title: string | null;
  /** 该部分的口径说明（真题出处 / 与哪一套共用） */
  note?: string | null;
  /** 本段是否已交卷：原文提示文案据此切换（"先做完" ↔ "可以逐句核对"） */
  graded?: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPlayingChange?: (playing: boolean) => void;
};

const RATES = [0.85, 1, 1.25];

export function useAudioState() {
  return useSyncExternalStore(subscribeAudio, getAudioState, getAudioState);
}

/**
 * 听力左栏：播放器 + 可折叠原文。
 *
 * 原文**默认收起**：听力里看到原文基本等于看到答案，一进来就摊开，
 * 练的就变成阅读理解。但收起只是默认值 —— 想核对的人点一下就能展开，
 * 每句还能点着跳回音频里那句重听（见 ListeningTranscript）。
 *
 * 原文不走首屏：刷题页下发的是 `transcript: []`，展开时才向
 * /api/papers/[id]/transcript 取。这样「打开页面顺手看到答案」不成立，
 * 也不用为一段长对话在首屏多传几 KB。
 *
 * 播放器读取的是模块级单例 <audio>（见 lib/listening-audio-client），
 * 所以切到题目、切栏、翻段都不会把它掐断。
 */
export function ListeningPane({
  paperId,
  passageId,
  index,
  title,
  note,
  graded = false,
  scrollRef,
  onPlayingChange,
}: Props) {
  const state = useAudioState();
  const key = `${paperId}#${index}`;
  const mine = state.key === key;
  const playing = mine && state.playing;
  const duration = mine ? state.duration : 0;
  const time = mine ? state.time : 0;
  const [started, setStarted] = useState(false);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  /*
   * 换段时自动切到新音频（是否真的跟随由 followPassage 判断）：
   * 同一套卷内翻段、且此前已经听过，才接着放；首次进页面不会突然出声。
   */
  useEffect(() => {
    followPassage(key);
  }, [key]);

  const begin = () => {
    setStarted(true);
    toggle(key);
  };

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-paper px-5 py-6 md:px-8">
      <div className="mx-auto max-w-[62ch]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-[17px] text-ink">{title ?? "听力"}</h2>
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            audio
          </span>
        </div>

        <div className="mt-4 rounded-[12px] border border-line bg-paper-deep px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={begin}
              aria-label={playing ? "暂停" : "播放"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-[15px] text-paper transition-transform hover:scale-[1.03] active:scale-95"
            >
              {playing ? "❚❚" : "▶"}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-ink-mute">
                <span>{fmtTime(time)}</span>
                <span>{duration ? fmtTime(duration) : "--:--"}</span>
              </div>

              <div className="relative mt-1.5">
                <div className="h-[5px] w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.5}
                  value={Math.min(time, duration || 0)}
                  disabled={!duration}
                  onChange={(e) => seek(Number(e.target.value))}
                  aria-label="播放进度"
                  className="absolute inset-x-0 top-1/2 h-6 w-full -translate-y-1/2 cursor-pointer appearance-none bg-transparent"
                  style={{ accentColor: "#a6392b" }}
                />
              </div>

              <p className="mt-2 text-[11.5px] text-ink-mute">
                {state.error
                  ? "音频没能加载出来"
                  : state.loading
                    ? "正在准备音频…"
                    : playing
                      ? "正在播放 · 可以切到题目继续听"
                      : started
                        ? "已暂停"
                        : "点播放开始听这一段"}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => restart(key)}
              className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
            >
              ⟲ 从头重播
            </button>
            <span className="ml-2 text-[11px] text-ink-mute">语速</span>
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setRate(rate)}
                className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  Math.abs(state.rate - rate) < 0.01
                    ? "bg-ink text-paper"
                    : "border border-line text-ink-soft hover:text-ink"
                }`}
              >
                {rate}×
              </button>
            ))}
            {state.error && (
              <button
                type="button"
                onClick={() => retry(key)}
                className="ml-auto rounded-full bg-accent px-3 py-1 text-[11.5px] text-paper"
              >
                重试
              </button>
            )}
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
          音频由神经网络语音合成朗读真题原文，不是考场录音；换浏览器、换手机都能播。
        </p>

        {note && (
          <p className="mt-1.5 rounded-[6px] border-l-2 border-accent/40 bg-paper-deep/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-mute">
            {note}
          </p>
        )}

        <ListeningTranscript
          paperId={paperId}
          passageId={passageId}
          passageIndex={index}
          graded={graded}
        />

        <p className="mt-5 text-[11.5px] leading-relaxed text-ink-mute">
          做题建议：先完整听一遍，再作答。切到右边看题目时音频不会停；
          去做阅读、写作等别的板块才会暂停，切回来接着放，不会从头开始。
          听不清可以把语速降到 0.85×，或拖动进度条回到那一句。
        </p>
      </div>
    </div>
  );
}
