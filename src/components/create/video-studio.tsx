"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { generateVideo, MODE_LABEL, warmUpCloud, type GenMode } from "@/lib/creation-client";
import {
  DEFAULT_VIDEO_OPTIONS,
  MAX_SOURCE_CHARS,
  VIDEO_PLATFORM_LABEL,
  VIDEO_TONE_LABEL,
  auditVideoOutput,
  videoToMarkdown,
  type VideoOptions,
  type VideoOutput,
  type VideoPlatform,
  type VideoTone,
} from "@/lib/creation";

/**
 * 短视频出海工作台。
 *
 * 产出的是「发布包」，不是视频文件：英文标题、3 个开场钩子、秒级分镜、字幕、
 * 话题标签、封面文案、发布描述。每条都有平台硬规则校验（标题 ≤60 字符、
 * 标签不能带空格、镜头必须写字幕），超了直接在界面上标出来，不用自己数。
 */

const SAMPLE = `很多人以为火锅就是辣，其实成都人吃火锅讲究的是香。
先炒料，牛油化开，下豆瓣、花椒、姜蒜，慢火四十分钟，香味才出得来。
涮的顺序也有讲究：毛肚七上八下，鸭肠十秒就好，牛肉最后放，汤才不浑。
来成都，别只拍照，坐下来吃一顿，你才知道什么叫热气腾腾的生活。`;

type SavedWork = {
  id: string;
  kind: string;
  title: string;
  sourceText: string;
  output: VideoOutput | null;
  meta: VideoOptions | null;
  createdAt: string;
};

export function VideoStudio({ workId }: { workId?: string }) {
  const [source, setSource] = useState("");
  const [options, setOptions] = useState<VideoOptions>(DEFAULT_VIDEO_OPTIONS);
  const [output, setOutput] = useState<VideoOutput | null>(null);
  const [mode, setMode] = useState<GenMode | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedTip, setSavedTip] = useState("");
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLElement | null>(null);

  const loadSaved = useCallback(async (id: string) => {
    try {
      const list = await apiFetch<SavedWork[]>("/api/create?kind=video");
      const hit = (list ?? []).find((item) => item.id === id);
      if (!hit) return;
      setSource(hit.sourceText);
      if (hit.meta) setOptions({ ...DEFAULT_VIDEO_OPTIONS, ...hit.meta });
      if (hit.output) {
        setOutput(hit.output);
        setMode("server");
      }
      setSavedTip(`已载入作品「${hit.title}」`);
    } catch {
      /* 载入失败不阻塞新建 */
    }
  }, []);

  useEffect(() => {
    warmUpCloud();
    if (workId) void loadSaved(workId);
  }, [workId, loadSaved]);

  const chars = source.replace(/\s/g, "").length;

  const run = async () => {
    if (source.trim().length < 20) {
      setError("至少写一段口播稿（20 字以上）再生成");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    setSavedTip("");
    try {
      const result = await generateVideo(source, options);
      setOutput(result.output);
      setMode(result.mode);
      setNote(result.note);
      // 窄屏是上下堆叠，结果在输入卡下面一屏之外，不滚一下用户会以为没反应
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        window.setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!output) return;
    try {
      const created = await apiFetch<{ id: string }>("/api/create", {
        method: "POST",
        body: JSON.stringify({
          kind: "video",
          title: output.title.slice(0, 150) || "未命名短视频",
          sourceText: source,
          output: JSON.stringify(output),
          meta: JSON.stringify(options),
        }),
      });
      setSavedTip(`已保存到作品库（${created.id.slice(0, 6)}…）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    }
  };

  const download = () => {
    if (!output || typeof window === "undefined") return;
    const blob = new Blob([videoToMarkdown(output)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(output.title || "short").replace(/[\\/:*?"<>|]/g, "").slice(0, 40)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyAll = async () => {
    if (!output || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(videoToMarkdown(output));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("浏览器不允许自动复制，请改用导出");
    }
  };

  const issues = output ? auditVideoOutput(output) : [];

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="card-soft h-fit p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium text-ink">中文口播稿</p>
          <span className="font-mono text-[11px] text-ink-mute">
            {chars}/{MAX_SOURCE_CHARS}
          </span>
        </div>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value.slice(0, MAX_SOURCE_CHARS))}
          rows={9}
          placeholder="粘贴一条中文口播稿/文案，一次建议 100–600 字。"
          className="mt-2 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-3 text-[13.5px] leading-[1.85] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSource(SAMPLE)}
            className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            填入示例（成都火锅）
          </button>
          <button
            type="button"
            onClick={() => {
              setSource("");
              setOutput(null);
              setMode(null);
              setNote("");
              setSavedTip("");
            }}
            className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-mute transition-colors hover:text-ink"
          >
            清空
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">发布平台</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(VIDEO_PLATFORM_LABEL) as VideoPlatform[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, platform: key }))}
                  className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                    options.platform === key
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-soft hover:border-accent"
                  }`}
                >
                  {VIDEO_PLATFORM_LABEL[key]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">时长</p>
            <div className="mt-1.5 flex gap-1.5">
              {[30, 60].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, seconds: sec === 60 ? 60 : 30 }))}
                  className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                    options.seconds === sec
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-soft hover:border-accent"
                  }`}
                >
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">语气</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(VIDEO_TONE_LABEL) as VideoTone[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, tone: key }))}
                  className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                    options.tone === key
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-soft hover:border-accent"
                  }`}
                >
                  {VIDEO_TONE_LABEL[key]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="mt-4 min-h-[46px] w-full rounded-[10px] bg-ink py-3 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "生成中…" : `生成${options.seconds}s 英文发布包`}
        </button>

        {error && <p className="mt-2 text-[12px] text-wrong">{error}</p>}
        {note && <p className="mt-2 text-[11.5px] text-ink-mute">{note}</p>}
        {savedTip && <p className="mt-2 text-[11.5px] text-correct">{savedTip}</p>}
      </section>

      <section className="min-w-0" ref={resultRef as React.RefObject<HTMLElement>}>
        {!output && (
          <div className="card-soft flex h-full min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <p className="font-serif text-[17px] text-ink">左边给稿，右边出可直接发布的英文包</p>
            <p className="mx-auto mt-2 max-w-[40ch] text-[12.5px] leading-[1.8] text-ink-mute">
              标题、钩子、分镜、字幕、标签、封面文案一次给全。
              不生成视频文件——那是拍摄和剪辑的事，这里负责把「说什么」变成英文。
            </p>
          </div>
        )}

        {output && (
          <div className="card-soft p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="tile-sky inline-block rounded-full px-2 py-0.5 text-[11px]">
                  {VIDEO_PLATFORM_LABEL[output.platform]}
                </p>
                <h2 className="mt-2 break-words font-serif text-[20px] leading-snug text-ink">
                  {output.title}
                </h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                  {mode && (
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        mode === "offline" ? "tile-amber" : "tile-jade"
                      }`}
                    >
                      {MODE_LABEL[mode]}
                    </span>
                  )}
                  <span className={output.title.length > 60 ? "text-wrong" : ""}>
                    标题 {output.title.length}/60 字符
                  </span>
                  <span>{output.scenes.length} 个镜头</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyAll()}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  {copied ? "已复制" : "复制全稿"}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] text-paper"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  导出 .md
                </button>
              </div>
            </div>

            {issues.length > 0 && (
              <div className="mt-3 rounded-[10px] border border-line bg-paper/60 px-3 py-2">
                <p className="text-[11px] text-ink-mute">发布前待修：</p>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {issues.map((issue) => (
                    <li key={issue} className="text-[11.5px] text-wrong">
                      · {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {output.hooks.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">开场钩子</p>
                <ul className="mt-2 space-y-1.5">
                  {output.hooks.map((hook, i) => (
                    <li
                      key={i}
                      className="rounded-[9px] border border-line bg-paper/50 px-3 py-2 text-[12.5px] leading-[1.7] text-ink-soft"
                    >
                      <span className="mr-2 font-mono text-[10.5px] text-accent">{i + 1}</span>
                      {hook}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">分镜</p>
              <div className="mt-2 space-y-2">
                {output.scenes.map((scene, i) => (
                  <div key={i} className="rounded-[10px] border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="rounded-full bg-paper-deep px-2 py-0.5 font-mono text-[10.5px] text-ink-soft">
                        {scene.sec || `#${i + 1}`}
                      </span>
                      <span className="text-[11.5px] text-ink-mute">{scene.visual}</span>
                    </div>
                    <p className="mt-1.5 font-serif text-[13px] leading-[1.75] text-ink">
                      {scene.voiceover || "（未写英文口播）"}
                    </p>
                    {scene.caption && (
                      <p className="mt-1 text-[11.5px] text-ink-mute">字幕：{scene.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-line bg-paper/50 p-3">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">话题标签</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {output.hashtags.length > 0 ? (
                    output.hashtags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-surface px-2 py-0.5 text-[11.5px] text-sky-ink"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11.5px] text-ink-mute">（还没有标签）</span>
                  )}
                </p>
              </div>
              <div className="rounded-[10px] border border-line bg-paper/50 p-3">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">封面文案</p>
                <p className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-soft">
                  {output.coverText || "（未给封面文案）"}
                </p>
              </div>
            </div>

            {output.description && (
              <div className="mt-3 rounded-[10px] border border-line bg-paper/50 p-3">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">发布描述</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-[1.8] text-ink-soft">
                  {output.description}
                </p>
              </div>
            )}

            <p className="mt-5 text-[11px] text-ink-mute">
              <Link href="/create" className="text-accent underline-offset-2 hover:underline">
                回作品库
              </Link>
              ，或者
              <Link href="/create/novel" className="mx-1 text-accent underline-offset-2 hover:underline">
                把同一段中文改成小说英译
              </Link>
              。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
