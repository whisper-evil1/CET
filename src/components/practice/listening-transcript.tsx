"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  fmtTime,
  getAudioState,
  playAt,
  subscribeAudio,
} from "@/lib/listening-audio-client";
import { apiFetch } from "@/lib/api-client";
import type { TranscriptLine } from "@/lib/types";

type Payload = {
  passageId: string;
  title: string | null;
  lines: TranscriptLine[];
  hasZh: boolean;
};

type Props = {
  paperId: string;
  /** 这一段在库里的 id（拉原文用） */
  passageId: string;
  /** 该套卷听力第几段（0 起），与播放器的 key 口径一致 */
  passageIndex: number;
  /** 本段是否已经交卷判分 —— 只影响提示文案，不锁功能 */
  graded: boolean;
};

/**
 * 听力原文（可折叠）。
 *
 * 三条设计线：
 *   1. **默认收起**。听力练习里原文等于答案，一进来就摊开，练的就变成「阅读」了。
 *      但收起的只是默认值，不是能力 —— 想核对的人随时能展开，不需要去别处找开关。
 *   2. **不进首屏**。原文走 /api/papers/[id]/transcript 按需拉，
 *      打开页面时浏览器里没有这段文字（详见刷题页 transcript: [] 的注释）。
 *   3. **对得上音频**。每一句都能点，点完整段会跳到那句开始放，
 *      正在播的那句高亮 —— 核对答案时要找的是「哪句话给了他这个答案」，
 *      只给一坨静态文本等于让人自己数句子。
 */
export function ListeningTranscript({ paperId, passageId, passageIndex, graded }: Props) {
  const key = `${paperId}#${passageIndex}`;
  const audio = useSyncExternalStore(subscribeAudio, getAudioState, getAudioState);

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showZh, setShowZh] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<Payload>(
        `/api/papers/${encodeURIComponent(paperId)}/transcript?passage=${encodeURIComponent(passageId)}`,
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "原文没能载入");
    } finally {
      setLoading(false);
    }
  }, [paperId, passageId]);

  /* 首次展开才请求：不做「进页面就预取」，否则首屏体积和不展开的承诺都白说了 */
  useEffect(() => {
    if (open && !data && !loading && !error) void load();
  }, [open, data, loading, error, load]);

  /* 换段：收起并清掉上一段的原文，避免翻段后看到的是上一段的话 */
  useEffect(() => {
    setOpen(false);
    setData(null);
    setError(null);
  }, [key]);

  /* 空数组也包一层 memo：否则每次渲染都是新引用，下面的 activeId 会白算 */
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const lastEnd = lines.length ? (lines[lines.length - 1]!.end || lines[lines.length - 1]!.start) : 0;

  /** 正在播的那一句：只在真的出声时高亮，暂停时停在哪儿不额外强调 */
  const activeId = useMemo(() => {
    if (!audio.playing || audio.key !== key || !lines.length) return -1;
    const idx = lines.findIndex((line) => {
      const end = line.end > line.start ? line.end : Number.POSITIVE_INFINITY;
      return audio.time >= line.start && audio.time < end;
    });
    return idx >= 0 ? lines[idx]!.id : -1;
  }, [audio.playing, audio.key, audio.time, key, lines]);

  const summary = loading
    ? "载入中…"
    : data
      ? lines.length
        ? `${lines.length} 句 · ${fmtTime(lastEnd)}`
        : "这一段没有可对照的原文"
      : "点开逐句对照";

  return (
    <section
      data-testid="listening-transcript"
      data-open={open ? "1" : "0"}
      data-lines={lines.length}
      className="mt-3 overflow-hidden rounded-[10px] border border-line bg-paper-deep/45"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`transcript-${passageIndex}`}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-paper-deep"
      >
        <span className="text-[12.5px] text-ink">原文</span>
        <span className="font-mono text-[10px] tracking-[0.14em] text-ink-mute uppercase">
          transcript
        </span>
        <span className="ml-auto truncate font-mono text-[11px] text-ink-mute">{summary}</span>
        <span className="shrink-0 font-mono text-[11px] text-accent">
          {open ? "收起 ▴" : "展开 ▾"}
        </span>
      </button>

      {open && (
        <div id={`transcript-${passageIndex}`} className="border-t border-line-soft">
          <p
            className={`px-3.5 py-2 text-[11.5px] leading-[1.7] ${
              graded ? "bg-correct-soft/40 text-ink-soft" : "bg-paper-deep text-ink-mute"
            }`}
          >
            {graded
              ? "本段已交，点任意一句可以直接跳到音频里那一句重听。"
              : "本段还没交：原文会把答案念给你听，建议先选完再展开核对。"}
          </p>

          {error ? (
            <div className="flex items-center gap-3 px-3.5 py-3 text-[12px] text-wrong">
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11.5px] text-ink-soft hover:border-accent hover:text-accent"
              >
                重试
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-2 px-3.5 py-3">
              <div className="h-3 w-3/4 animate-pulse rounded bg-line-soft" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-line-soft" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-line-soft" />
            </div>
          ) : !lines.length ? (
            <p className="px-3.5 py-3 text-[12px] leading-relaxed text-ink-mute">
              这一段暂时没有可对照的原文，音频照常可以听。
            </p>
          ) : (
            <>
              {data?.hasZh && (
                <div className="flex items-center justify-between gap-2 px-3.5 pt-2">
                  <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink-mute uppercase">
                    逐句对照
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowZh((v) => !v)}
                    aria-pressed={showZh}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                      showZh
                        ? "bg-ink text-paper"
                        : "border border-line text-ink-soft hover:text-ink"
                    }`}
                  >
                    中译
                  </button>
                </div>
              )}

              {/* 长段落（14 句以上）在这里内部滚，别把播放器顶出屏幕；
                  用站里统一的 scroll-pane，滚动条和右侧题目区一致，能看出「还有下文」 */}
              <ol className="scroll-pane max-h-[42vh] px-1.5 py-2">
                {lines.map((line) => {
                  const active = line.id === activeId;
                  return (
                    <li key={line.id}>
                      <button
                        type="button"
                        onClick={() => playAt(key, line.start)}
                        data-sentence={line.id}
                        title="点这一句，从音频里的这里开始放"
                        className={`group flex w-full items-baseline gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors ${
                          active ? "bg-accent-soft/60" : "hover:bg-paper-deep"
                        }`}
                      >
                        <span
                          className={`shrink-0 font-mono text-[10.5px] tabular-nums ${
                            active ? "text-accent" : "text-ink-mute"
                          }`}
                        >
                          {fmtTime(line.start)}
                        </span>
                        <span
                          className={`min-w-0 flex-1 text-[12.5px] leading-[1.75] ${
                            active ? "text-ink" : "text-ink-soft"
                          }`}
                        >
                          {line.text}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
                          ▶
                        </span>
                      </button>
                      {showZh && line.zh && (
                        <p
                          data-zh={line.id}
                          className="px-2 pb-1.5 pl-[46px] text-[11.5px] leading-[1.7] text-ink-mute"
                        >
                          {line.zh}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}
