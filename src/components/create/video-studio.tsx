"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { withSharecode } from "@/lib/share-code";
import { generateVideo, MODE_LABEL, warmUpCloud, type GenMode } from "@/lib/creation-client";
import { clearDraft, hasPending, loadDraft, markPending, saveDraft } from "@/lib/create-draft";
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
 * 产出的是英文「发布包」：3 个开场钩子、秒级分镜、字幕、话题标签、封面文案、
 * 发布描述。上传原视频后，可把字幕烧录进画面，直接导出可发布的 MP4（原声不变）。
 * 每条都有平台硬规则校验（标题 ≤60 字符、标签不能带空格、镜头必须写字幕），
 * 超了直接在界面上标出来，不用自己数。
 */

const SAMPLE = `很多人以为火锅就是辣，其实成都人吃火锅讲究的是香。
先炒料，牛油化开，下豆瓣、花椒、姜蒜，慢火四十分钟，香味才出得来。
涮的顺序也有讲究：毛肚七上八下，鸭肠十秒就好，牛肉最后放，汤才不浑。
来成都，别只拍照，坐下来吃一顿，你才知道什么叫热气腾腾的生活。`;

/**
 * 用浏览器自己读时长与分辨率。
 *
 * 服务端抽帧依赖 ffmpeg，容器里一旦跑不起来，上传就会整个失败——
 * 但「文件选好了、能不能预览」这件事浏览器本来就能做，不该被服务端拖累。
 * 所以本地先读一份元数据，服务端结果只用来补缩略图。
 */
function readLocalMeta(file: File): Promise<{ durationSec: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: { durationSec: number; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish({
        durationSec: Math.round((Number.isFinite(video.duration) ? video.duration : 0) * 10) / 10,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    video.onerror = () => finish(null);
    // 有些编码浏览器也解不动，别让上传卡在这里
    window.setTimeout(() => finish(null), 8000);
    video.src = url;
  });
}

type SavedWork = {
  id: string;
  kind: string;
  title: string;
  sourceText: string;
  output: VideoOutput | null;
  meta: VideoOptions | null;  createdAt: string;
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
  const [interrupted, setInterrupted] = useState(false);
  const [copied, setCopied] = useState(false);
  // 视频上传与需求描述（最小闭环：视频抽帧预览，口播稿仍手动填）
  const [needText, setNeedText] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [resultVideoUrl, setResultVideoUrl] = useState("");
  const [resultVideoName, setResultVideoName] = useState("");
  const [videoPreviewKind, setVideoPreviewKind] = useState<"source" | "result" | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoMeta, setVideoMeta] = useState<{
    durationSec: number; width: number; height: number; format: string; frames: string[];
  } | null>(null);
  const [probing, setProbing] = useState(false);
  /** 上传专属错误：就近显示在上传按钮下方，别让用户去表单底部找 */
  const [uploadError, setUploadError] = useState("");
  /** 上传成功但服务端增强项失败（抽帧），只提示不阻断 */
  const [uploadWarn, setUploadWarn] = useState("");
  const [exporting, setExporting] = useState(false);
  const [muxing, setMuxing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const objectUrls = useRef<string[]>([]);
  const trackUrl = (url: string) => {
    objectUrls.current.push(url);
    return url;
  };

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
    if (workId) {
      void loadSaved(workId);
      return;
    }
    // 新建工作台：从草稿恢复上次未保存的输入，并检查是否有中断的生成任务
    const draft = loadDraft<VideoOptions>("video");
    if (draft) {
      setSource(draft.source);
      if (draft.options) setOptions((prev) => ({ ...prev, ...draft.options }));
    }
    setInterrupted(hasPending("video"));
  }, [workId, loadSaved]);

  // 输入 / 参数变化后防抖写入草稿：切走页面、关标签再回来，内容还在
  useEffect(() => {
    if (workId) return;
    if (!source.trim()) return;
    const timer = window.setTimeout(() => saveDraft("video", source, options), 400);
    return () => window.clearTimeout(timer);
  }, [source, options, workId]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!videoPreviewKind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVideoPreviewKind(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoPreviewKind]);

  /** 上传视频：浏览器先本地预览 + 读元数据，服务端抽帧只作增强 */
  const probe = async (file: File | undefined) => {
    if (!file) return;
    setProbing(true);
    setError("");
    setUploadError("");
    setUploadWarn("");
    setVideoMeta(null);
    setVideoFile(file);
    setVideoName(file.name);
    setVideoUrl(trackUrl(URL.createObjectURL(file)));

    // 1) 本地读取：不依赖服务端，文件选对了就一定能看到画面
    const local = await readLocalMeta(file);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (local) {
      setVideoMeta({ ...local, format: ext, frames: [] });
    }

    // 2) 服务端抽帧：拿得到缩略图更好，拿不到也不该让上传失败
    let serverOk = false;
    try {
      const form = new FormData();
      form.append("video", file);
      const meta = await apiFetch<{
        durationSec: number; width: number; height: number; format: string; frames: string[];
      }>("/api/create/video-probe", { method: "POST", body: form });
      setVideoMeta(meta);
      serverOk = true;
    } catch (err) {
      setUploadWarn(err instanceof Error ? err.message : "服务端读取失败");
    } finally {
      setProbing(false);
      if (videoFileRef.current) videoFileRef.current.value = "";
    }

    if (!local && !serverOk) {
      setUploadError("这个文件浏览器也读不出画面，可能不是视频或编码不受支持");
      setVideoMeta(null);
      setVideoFile(null);
      setVideoName("");
      setVideoUrl("");
    }
  };

  /** 通用：把接口返回的二进制流存成文件下载 */
  const saveBlob = (blob: Blob, fileName: string) => {
    if (typeof window === "undefined") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 英文字幕导出：从分镜 caption 生成 SRT/VTT，时间码按视频真实时长均分 */
  const exportSubs = async (format: "srt" | "vtt") => {
    if (!output) return;
    const lines = output.scenes.map((s) => s.caption).filter(Boolean);
    if (lines.length === 0) {
      setError("没有可导出的字幕，请先生成发布包");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const res = await fetch(withSharecode("/api/create/export-subs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          lines,
          durationSec: videoMeta?.durationSec ?? options.seconds,
          title: output.title,
        }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.message ?? `导出失败（HTTP ${res.status}）`);
      }
      const safe = (output.title || "captions").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
      saveBlob(await res.blob(), `${safe}.${format}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "字幕导出失败");
    } finally {
      setExporting(false);
    }
  };

  /** 视频输出：burn 烧字幕留原声 / soft 软字幕 / dub 英文配音替换原声并逐句对齐 */
  const exportMp4 = async (mode: "burn" | "soft" | "dub" = "burn") => {
    if (!output) return;
    if (!videoFile) {
      setError("请先在左侧上传视频原件，再导出视频");
      return;
    }
    const lines = output.scenes.map((s) => s.caption).filter(Boolean);
    if (lines.length === 0) {
      setError("没有可封装的字幕，请先生成发布包");
      return;
    }
    setMuxing(true);
    setError("");
    try {
      const form = new FormData();
      form.append("video", videoFile);
      form.append("lines", JSON.stringify(lines));
      form.append("durationSec", String(videoMeta?.durationSec ?? options.seconds));
      form.append("height", String(videoMeta?.height ?? 360));
      form.append("mode", mode);
      form.append("title", output.title);
      const res = await fetch(withSharecode("/api/create/export-video-file"), {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.message ?? `导出失败（HTTP ${res.status}）`);
      }
      // 先给预览，不偷偷下载：用户看完再决定要不要保存
      const blob = await res.blob();
      const safe = (output.title || "video-package").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
      const suffix = mode === "dub" ? "en-dubbed" : mode === "soft" ? "with-en-subs" : "en-burned";
      setResultVideoName(`${safe}.${suffix}.mp4`);
      setResultVideoUrl(trackUrl(URL.createObjectURL(blob)));
      setVideoPreviewKind("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频封装失败");
    } finally {
      setMuxing(false);
    }
  };

  /** 报告导出：Word(.docx) */
  const exportReport = async () => {
    if (!output) return;
    setExporting(true);
    setError("");
    try {
      const res = await fetch(withSharecode("/api/create/export-video"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output,
          needText,
          videoMeta: videoMeta
            ? { durationSec: videoMeta.durationSec, width: videoMeta.width, height: videoMeta.height, format: videoMeta.format }
            : undefined,
        }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.message ?? `导出失败（HTTP ${res.status}）`);
      }
      const safe = (output.title || "video-package").replace(/[\\/:*?"<>|]/g, "").slice(0, 40);
      saveBlob(await res.blob(), `${safe}.docx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告导出失败");
    } finally {
      setExporting(false);
    }
  };

  const chars = source.replace(/\s/g, "").length;

  /** 保存到作品库；生成成功后自动调用，也可手动「保存」再存一次 */
  const persist = async (out: VideoOutput): Promise<void> => {
    try {
      const created = await apiFetch<{ id: string }>("/api/create", {
        method: "POST",
        body: JSON.stringify({
          kind: "video",
          title: out.title.slice(0, 150) || "未命名短视频",
          sourceText: source,
          output: JSON.stringify(out),
          meta: JSON.stringify(options),
        }),
      });
      setSavedTip(`已保存到作品库（${created.id.slice(0, 6)}…）`);
      clearDraft("video");
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动保存失败，可点「保存」重试");
    }
  };

  const run = async () => {
    if (source.trim().length < 20) {
      setError("至少写一段口播稿（20 字以上）再生成");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    setSavedTip("");
    setInterrupted(false);
    markPending("video", true);
    try {
      const result = await generateVideo(source, options);
      setOutput(result.output);
      setMode(result.mode);
      setNote(result.note);
      // 生成成功立即入库：解决「做了一版但网页端没有记录」
      // 服务端通道会自己落库（哪怕前端已经切走），拿到 savedId 就不再重复存
      if (result.savedId) {
        setSavedTip(`已保存到作品库（${result.savedId.slice(0, 6)}…）`);
        clearDraft("video");
      } else if (result.mode !== "offline") {
        await persist(result.output);
      }
      markPending("video", false);
      // 窄屏是上下堆叠，结果在输入卡下面一屏之外，不滚一下用户会以为没反应
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        window.setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (err) {
      markPending("video", false);
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!output) return;
    await persist(output);
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
        {interrupted && (
          <div className="mb-3 rounded-[10px] border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[11.5px] leading-[1.7] text-ink-soft">
            上次生成似乎被中断了，输入已从草稿恢复，可以重新生成。
            <button
              type="button"
              onClick={() => void run()}
              className="ml-1 text-accent underline-offset-2 hover:underline"
            >
              重新生成 →
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium text-ink">中文口播稿</p>
          <span className="font-mono text-[11px] text-ink-mute">
            {chars}/{MAX_SOURCE_CHARS}
          </span>
        </div>

        {/* 视频上传（抽帧预览；改编仍以手填口播稿为准，不做语音识别） */}
        <input
          ref={videoFileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska"
          className="hidden"
          onChange={(e) => void probe(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => videoFileRef.current?.click()}
          disabled={probing}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-line bg-paper/50 px-3 py-2.5 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <span aria-hidden>▶</span>
          {probing ? "正在读取视频…" : "上传视频（抽帧预览 · MP4/MOV/WebM ≤100MB）"}
        </button>
        {/* 上传的结果必须就近说清楚：成功给正向确认，失败给原因，
            否则用户只看到一句飘在底部的报错，以为"没反应" */}
        {videoMeta && !uploadError && (
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[#2f6b4f]">
            <span aria-hidden>✓</span> 已上传：{videoName}
            {videoMeta.durationSec
              ? `（${videoMeta.durationSec}s${videoMeta.width ? ` · ${videoMeta.width}×${videoMeta.height}` : ""}）`
              : ""}
          </p>
        )}
        {uploadWarn && !uploadError && (
          <p className="mt-1 text-[10.5px] leading-[1.6] text-ink-mute">
            缩略图未生成：{uploadWarn}。不影响生成与保存。
          </p>
        )}
        {uploadError && (
          <div className="mt-1.5 rounded-[9px] border border-accent/30 bg-accent/[0.04] px-2.5 py-2">
            <p className="text-[11px] leading-[1.7] text-accent">上传失败：{uploadError}</p>
            <p className="mt-1 text-[10.5px] leading-[1.6] text-ink-mute">
              请换 MP4 / MOV / WebM 再试，单文件不超过 100MB。
            </p>
          </div>
        )}
        {videoMeta && (
          <div className="mt-2 rounded-[10px] border border-line bg-paper/50 p-2.5">
            <p className="truncate text-[11px] text-ink-soft" title={videoName}>
              {videoName} · {videoMeta.durationSec}s · {videoMeta.width}×{videoMeta.height}
            </p>
            {videoMeta.frames.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {videoMeta.frames.map((frame, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={frame} alt={`视频关键帧 ${i + 1}`} className="w-full rounded border border-line object-cover" />
                ))}
              </div>
            )}
            {videoUrl && (
              <>
                <video
                  controls
                  playsInline
                  preload="auto"
                  src={`${videoUrl}#t=0.1`}
                  className="mt-2 max-h-[220px] w-full rounded-[10px] border border-line bg-black"
                />
                <button
                  type="button"
                  onClick={() => setVideoPreviewKind("source")}
                  className="mt-2 w-full rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  放大预览原片
                </button>
              </>
            )}
          </div>
        )}

        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value.slice(0, MAX_SOURCE_CHARS))}
          rows={9}
          placeholder="粘贴一条中文口播稿/文案，一次建议 100–600 字。"
          className="mt-2 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-3 text-[13.5px] leading-[1.85] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
        />

        {/* 需求描述：随报告一起导出，供剪辑时对照 */}
        <label htmlFor="video-need" className="mt-3 block text-[11px] tracking-[0.14em] text-ink-mute uppercase">
          需求描述（可选，写进报告）
        </label>
        <textarea
          id="video-need"
          value={needText}
          onChange={(e) => setNeedText(e.target.value.slice(0, 2000))}
          rows={2}
          placeholder="例如：面向海外美食博主，突出成都火锅的仪式感，避免夸张承诺"
          className="mt-1.5 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-2.5 text-[12.5px] leading-[1.75] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
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
              上传原视频后，还能把英文字幕烧录进画面，直接导出视频。
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
                  onClick={() => setPreviewOpen(true)}
                  className="rounded-full border border-accent px-3 py-1.5 text-[11.5px] text-accent transition-colors hover:bg-accent-soft"
                >
                  预览 / 存 PDF
                </button>
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
                  onClick={() => void exportMp4("dub")}
                  disabled={muxing || exporting}
                  title="英文字幕逐句合成英文配音，替换中文原声，字幕随配音对齐——最接近可直接发布的出海视频"
                  className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {muxing ? "配音渲染中…（可能需要几分钟）" : "英文配音成片"}
                </button>
                <button
                  type="button"
                  onClick={() => void exportMp4()}
                  disabled={muxing || exporting}
                  title="把英文字幕烧录进画面，保留原声"
                  className="rounded-full bg-accent px-3 py-1.5 text-[11.5px] text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  字幕视频 MP4
                </button>
                <button
                  type="button"
                  onClick={() => void exportMp4("soft")}
                  disabled={muxing || exporting}
                  title="无损封装软字幕轨，播放器可开关字幕"
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  软字幕版
                </button>
                <button
                  type="button"
                  onClick={() => void exportReport()}
                  disabled={exporting}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {exporting ? "导出中…" : "导出报告 Word"}
                </button>
                <button
                  type="button"
                  onClick={() => void exportSubs("srt")}
                  disabled={exporting}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  字幕 .srt
                </button>
                <button
                  type="button"
                  onClick={() => void exportSubs("vtt")}
                  disabled={exporting}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  字幕 .vtt
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

            {resultVideoUrl && (
              <div className="mt-4 rounded-[11px] border border-line bg-paper/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">
                    输出视频 · {resultVideoName.includes("dubbed")
                      ? "英文配音 + 字幕逐句对齐"
                      : resultVideoName.includes("with-en-subs")
                        ? "软字幕轨 · 可开关"
                        : "字幕已烧录进画面 · 保留原声"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setVideoPreviewKind("result")}
                    className="rounded-full border border-accent px-3 py-1 text-[11px] text-accent transition-colors hover:bg-accent-soft"
                  >
                    大窗预览成片
                  </button>
                </div>
                <video
                  controls
                  playsInline
                  preload="auto"
                  src={`${resultVideoUrl}#t=0.1`}
                  className="mt-2 max-h-[360px] w-full rounded-[10px] border border-line bg-black"
                />
                <p className="mt-2 text-[11px] leading-[1.7] text-ink-mute">
                  {resultVideoName.includes("dubbed")
                    ? "中文原声已替换为英文配音，字幕按配音时长逐句对齐；画面里的中文界面仍需人工本地化。"
                    : "看完再下载发布；字幕是初稿，发布前请按实际剪辑校对时间码。"}
                </p>
              </div>
            )}

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

            <p className="mt-4 text-[11px] leading-[1.7] text-ink-mute">
              字幕时间码按{videoMeta ? `视频真实时长 ${videoMeta.durationSec}s` : "目标时长"}自动均分，
              仅作初稿，请按实际剪辑逐句校对。
              {videoName && " 「英文配音成片」会替换中文原声并让字幕逐句对齐，最接近可直接发布；画面中文界面仍需人工本地化。"}
            </p>
            <p className="mt-3 text-[11px] text-ink-mute">
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

      {/* 预览弹窗：所见即所得，浏览器打印存 PDF */}
      {previewOpen && output && (
        <div className="novel-preview-overlay" role="dialog" aria-modal="true" aria-label="发布包预览">
          <div className="novel-preview-bar no-print">
            <span className="text-[12px] text-ink-soft">预览 · 排版即报告导出样式</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-full bg-ink px-4 py-1.5 text-[12px] text-paper"
              >
                打印 / 存为 PDF
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-full border border-line px-4 py-1.5 text-[12px] text-ink-soft"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="novel-preview-scroll">
            <article className="novel-preview-paper">
              <h1>{output.title}</h1>
              <p className="np-subtitle">{VIDEO_PLATFORM_LABEL[output.platform]} · 英文发布包</p>
              <p className="np-meta">
                {output.scenes.length} 个镜头 · 标题 {output.title.length}/60 字符
              </p>

              <h2>开场钩子</h2>
              <ul className="np-notes">
                {output.hooks.map((h, i) => <li key={i}>{h}</li>)}
              </ul>

              <h2>分镜脚本</h2>
              <table className="np-table">
                <thead>
                  <tr><th>时间</th><th>画面</th><th>英文口播</th><th>字幕</th></tr>
                </thead>
                <tbody>
                  {output.scenes.map((s, i) => (
                    <tr key={i}>
                      <td className="np-term">{s.sec}</td>
                      <td>{s.visual}</td>
                      <td>{s.voiceover}</td>
                      <td>{s.caption}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {output.hashtags.length > 0 && (
                <>
                  <h2>话题标签</h2>
                  <p className="np-en">{output.hashtags.join(" ")}</p>
                </>
              )}
              {output.coverText && (
                <>
                  <h2>封面文案</h2>
                  <p className="np-en">{output.coverText}</p>
                </>
              )}
              {output.description && (
                <>
                  <h2>发布描述</h2>
                  <p className="np-zh">{output.description}</p>
                </>
              )}
            </article>
          </div>
        </div>
      )}

      {/* 视频大窗预览：导出完成自动弹出，也可从成片卡片再次打开 */}
      {videoPreviewKind && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/90 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={videoPreviewKind === "result" ? "成片预览" : "原片预览"}
          onClick={(e) => {
            if (e.target === e.currentTarget) setVideoPreviewKind(null);
          }}
        >
          <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-3 text-paper">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">
                {videoPreviewKind === "result"
                  ? resultVideoName.includes("dubbed")
                    ? "成片预览 · 英文配音 + 逐句对齐字幕"
                    : "成片预览 · 字幕已烧录进画面"
                  : "原片预览"}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-paper/60">
                {videoPreviewKind === "result" ? resultVideoName : videoName}
              </p>
            </div>
            <div className="flex gap-2">
              {videoPreviewKind === "result" && resultVideoUrl && (
                <a
                  href={resultVideoUrl}
                  download={resultVideoName}
                  className="rounded-full bg-accent px-4 py-1.5 text-[12px] text-paper transition-opacity hover:opacity-90"
                >
                  下载 MP4
                </a>
              )}
              <button
                type="button"
                onClick={() => setVideoPreviewKind(null)}
                className="rounded-full border border-paper/40 px-4 py-1.5 text-[12px] text-paper transition-colors hover:bg-paper/10"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="mx-auto mt-3 flex min-h-0 w-full max-w-[1100px] flex-1 items-center justify-center">
            <video
              key={videoPreviewKind}
              controls
              playsInline
              preload="auto"
              src={`${videoPreviewKind === "result" ? resultVideoUrl : videoUrl}#t=0.1`}
              className="max-h-full w-full rounded-[12px] bg-black"
            />
          </div>
          <p className="mx-auto mt-2 text-[11px] text-paper/50">
            {videoPreviewKind === "result"
              ? "预览无误后再下载发布；字幕已经烧进画面，不需要播放器额外开启。"
              : "原片只用于抽帧和生成发布包，不会被改动。"}
            （按 Esc 关闭）
          </p>
        </div>
      )}
    </div>
  );
}
