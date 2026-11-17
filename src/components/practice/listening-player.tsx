"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getSnapshot, speech, subscribe, type SpeechLine } from "@/lib/speech";

/** 做题目板与闯关游戏共用：读同一份播放状态，才能做到「还在播就别切题」 */
export function useSpeech() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const fmt = (sec: number) => {
  const s = Math.max(1, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const RATES = [0.85, 1, 1.25];

type Props = {
  /** 段落唯一 id：播放状态按它归属，换段就停 */
  passageId: string;
  lines: SpeechLine[];
  audioUrl: string | null;
  /** 进入本段自动朗读一次（浏览器可能拦截，失败不报错，显示播放按钮即可） */
  autoPlay?: boolean;
  compact?: boolean;
  /** 把「是否正在出声」交给外壳，用于约束切题按钮 */
  onPlayingChange?: (playing: boolean) => void;
};

/**
 * 听力播放器。
 * - 有真实音频文件时优先用 <audio>（将来接入授权音频即可直接生效）
 * - 没有音频时用系统朗读按句播放，带逐句高亮、变速、重播，播放进度按句推进
 */
export function ListeningPlayer({
  passageId,
  lines,
  audioUrl,
  autoPlay = true,
  compact = false,
  onPlayingChange,
}: Props) {
  const state = useSpeech();
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTime, setAudioTime] = useState(0);

  const mine = state.passageId === passageId;
  const playing = mine && state.playing && !state.paused;

  useEffect(() => {
    onPlayingChange?.(audioUrl ? audioPlaying : playing);
  }, [audioPlaying, playing, audioUrl, onPlayingChange]);

  useEffect(() => {
    speech.init();
    return () => speech.stop();
  }, []);

  // 换段：先停上一段，再决定要不要自动读
  useEffect(() => {
    speech.stop();
    if (!audioUrl && autoPlay && lines.length) {
      const timer = window.setTimeout(() => speech.play(passageId, lines, 0), 260);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passageId]);

  const estimate = useMemo(() => {
    const words = lines.reduce((a, l) => a + (l.text?.trim().split(/\s+/).length ?? 0), 0);
    return words / (2.5 * state.rate);
  }, [lines, state.rate]);

  if (audioUrl) {
    return (
      <div className="rounded-[10px] border border-line bg-paper-deep p-4">
        <p className="mb-2 text-[12px] text-ink-mute">听力录音（可拖动进度条）</p>
        <audio
          ref={(node) => {
            if (node) {
              // 用 ref 回调挂事件，避免每次渲染重绑
              node.onplay = () => setAudioPlaying(true);
              node.onpause = () => setAudioPlaying(false);
              node.onended = () => setAudioPlaying(false);
              node.ontimeupdate = () => setAudioTime(node.currentTime);
              node.onloadedmetadata = () => setAudioDuration(node.duration || 0);
            }
          }}
          src={audioUrl}
          controls
          preload="metadata"
          className="w-full"
        />
        <p className="mt-2 text-[11px] text-ink-mute">
          {audioDuration ? `全长 ${fmt(audioDuration)} · 已听 ${fmt(audioTime)}` : "加载中…"}
        </p>
      </div>
    );
  }

  const done = mine ? state.doneLines : 0;
  const pct = lines.length ? Math.min(100, Math.round((done / lines.length) * 100)) : 0;

  return (
    <div className="rounded-[10px] border border-line bg-paper-deep p-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (playing) speech.pause();
            else if (mine && state.paused) speech.resume();
            else speech.play(passageId, lines, 0);
          }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-[15px] text-paper transition-opacity hover:opacity-85"
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] text-ink">
              {playing
                ? `第 ${Math.max(1, state.lineIndex + 1)} / ${lines.length} 句`
                : mine && state.paused
                  ? "已暂停"
                  : `全文 ${lines.length} 句 · 约 ${fmt(estimate)}`}
            </span>
            <span className="font-mono text-[11px] text-ink-mute">
              {playing ? `${fmt(estimate)} · ` : ""}
              {state.rate.toFixed(2)}×
            </span>
          </div>
          <div className="mt-1.5 h-[4px] w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => speech.play(passageId, lines, 0)}
          className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
        >
          从头整段
        </button>
      </div>

      {/* 正在读的那一句：让「整段在播」这件事看得见，不用展开原文也能跟读 */}
      <p className="mt-3 min-h-[34px] rounded-[8px] bg-paper px-3 py-2 text-[12.5px] leading-[1.7] text-ink-soft">
        <span className="mr-1.5 font-mono text-[10px] text-ink-mute">NOW</span>
        {playing && lines[state.lineIndex]?.text
          ? lines[state.lineIndex]!.text
          : "点左侧播放键，从第 1 句连读到本段最后一句。"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-mute">语速</span>
        {RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            onClick={() => speech.setRate(rate)}
            className={`rounded-full px-2 py-0.5 font-mono text-[11px] transition-colors ${
              Math.abs(state.rate - rate) < 0.01
                ? "bg-ink text-paper"
                : "border border-line text-ink-soft hover:text-ink"
            }`}
          >
            {rate}×
          </button>
        ))}
        {!compact && (
          <span className="ml-auto text-[10.5px] text-ink-mute">
            系统朗读 · 非官方录音，原文见下方
          </span>
        )}
      </div>

      {!state.supported && (
        <p className="mt-2 text-[11.5px] text-wrong">当前浏览器不支持语音朗读，请用 Chrome / Edge 打开。</p>
      )}
      {state.error && <p className="mt-2 text-[11.5px] text-wrong">{state.error}</p>}
    </div>
  );
}
