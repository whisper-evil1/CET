"use client";

import { useRef, useState } from "react";
import type { TranscriptLine } from "@/lib/types";

type Props = {
  title: string | null;
  transcript: TranscriptLine[];
  /** 音频地址；为 null 时显示"暂无音频"占位，用户可看原文做题 */
  audioUrl: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * 听力左栏：音频播放器 + 听力原文。
 * - 有 audioUrl 时显示原生 <audio>，手机浏览器可直接播放
 * - 无 audioUrl 时提示"录音待补"，但原文仍可阅读（方便先做题）
 * - 原文按句展示，后续可接逐句高亮（当前先静态展示）
 */
export function ListeningPane({ title, transcript, audioUrl, scrollRef }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-paper px-5 py-6 md:px-8">
      <div className="mx-auto max-w-[62ch]">
        {/* 标题 */}
        {title && (
          <h2 className="font-serif text-[17px] text-ink">{title}</h2>
        )}

        {/* 音频播放器 */}
        <div className="mt-4 rounded-xl border border-line bg-paper-deep p-4">
          {audioUrl ? (
            <>
              <p className="mb-2 text-[12px] text-ink-mute">听力音频（可拖动进度条）</p>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                preload="none"
                className="w-full"
              />
            </>
          ) : (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-mute">
              <span>🎧</span>
              <span>录音待补，当前可先阅读原文作答。音频文件准备好后会自动出现在这里。</span>
            </div>
          )}
        </div>

        {/* 原文展开/收起 */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="text-[12.5px] text-accent underline-offset-2 hover:underline"
          >
            {showTranscript ? "▼ 收起听力原文" : "▶ 展开听力原文"}
          </button>

          {showTranscript && transcript.length > 0 && (
            <div className="mt-3 space-y-2 rounded-lg bg-paper-deep/50 p-4">
              {transcript.map((line) => (
                <p
                  key={line.id}
                  className="text-[13.5px] leading-[1.85] text-ink-soft"
                >
                  <span className="mr-1.5 font-mono text-[10px] text-ink-mute">
                    {line.id}
                  </span>
                  {line.text}
                </p>
              ))}
            </div>
          )}

          {showTranscript && transcript.length === 0 && (
            <p className="mt-3 text-[12.5px] text-ink-mute">暂无听力原文。</p>
          )}
        </div>

        {/* 做题提示 */}
        <p className="mt-6 text-[11.5px] leading-relaxed text-ink-mute">
          做题建议：先完整听一遍音频再看题；真实考试中音频只播放一遍。
        </p>
      </div>
    </div>
  );
}
