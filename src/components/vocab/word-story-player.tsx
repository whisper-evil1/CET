"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { cloud, cloudReady } from "@/lib/cloud";
import { streamCloudChat } from "@/lib/cloud-llm";
import {
  buildStoryPrompt,
  injectGlosses,
  parseStory,
  shortGloss,
  storyToRuns,
  validateMarked,
  type StoryWord,
} from "@/lib/word-story";
import type { VocabItem } from "@/lib/types";

type Props = {
  words: VocabItem[];
  onExit: () => void;
  /** 选词页传入的指定词（按勾选顺序）；不传则从生词本随机抽一组 */
  givenWords?: StoryWord[];
};

type Mode = "ai" | "offline";

const RATE_OPTIONS = [0.75, 1, 1.25, 1.5] as const;
/** 一篇故事串多少个词（参考图一屏的量） */
const STORY_LEN = 8;
/** 云模型写故事的整体超时：超时就快速回服务端兜底，别让用户干等 30 秒+ */
const CLOUD_STORY_TIMEOUT_MS = 15_000;

/** 云模型写故事的系统提示（与 /api/vocab/story 服务端保持一致） */
const CLOUD_STORY_SYSTEM =
  "你是英语词汇故事写手，专为中国大学生（四六级水平）把单词串成便于记忆的英文小故事。严格按用户给的顺序用词，每个词只用一次，输出格式必须符合要求。";

/**
 * 优先用浏览器直连云模型生成故事（和 AI 答疑同一通道，线上无需服务端密钥）。
 * 拿到「按序、带星号」的合规故事就返回；任何失败返回 null，交给服务端兜底。
 */
async function tryCloudStory(words: StoryWord[]): Promise<string | null> {
  if (!cloudReady || !cloud) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_STORY_TIMEOUT_MS);
  try {
    const text = await streamCloudChat({
      systemPrompt: CLOUD_STORY_SYSTEM,
      messages: [{ role: "user", content: buildStoryPrompt(words) }],
      onDelta: () => {},
      temperature: 0.7,
      signal: controller.signal,
    });
    const marked = text.trim();
    if (!marked || !validateMarked(marked, words)) return null;
    return injectGlosses(marked, words);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 从生词本里抽一组词（有释义的优先），转成串故事用的词表 */
function pickWords(words: VocabItem[], count: number): StoryWord[] {
  const usable = words.filter((item) => item.word && item.definitions.length > 0);
  return shuffle(usable)
    .slice(0, count)
    .map((item) => ({
      word: item.word,
      zh: shortGloss(item.definitions.map((d) => d.zh).filter(Boolean)[0] ?? ""),
    }));
}

/**
 * 单词串联故事（对照用户参考图的形态）：
 *   一篇英文小故事，目标词加粗、紧跟（中文释义），按词序串完，看完能联想词义。
 *
 * 熄屏续听的关键设计：
 *   朗读走「服务端合成整篇 MP3 + <audio> 播放」，不是逐句 speechSynthesis ——
 *   安卓锁屏后 speechSynthesis 会被系统直接杀掉，而 <audio> 走系统媒体通道继续放；
 *   再挂 Media Session，锁屏界面也能暂停/继续/快进。
 *   这里刻意**不**监听 visibilitychange 暂停（随身听旧逻辑会，那是熄屏听不了的原因之一）。
 */
export function WordStoryPlayer({ words, onExit, givenWords }: Props) {
  const [picked, setPicked] = useState<StoryWord[]>([]);
  const [story, setStory] = useState("");
  const [mode, setMode] = useState<Mode>("offline");
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<"idle" | "generating" | "ready">("idle");

  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<"idle" | "loading" | "playing" | "paused" | "failed">(
    "idle",
  );
  const [rate, setRate] = useState<number>(1);
  const [withGloss, setWithGloss] = useState(true);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioNote, setAudioNote] = useState("");

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** 用户是否想让它响着（重试 play 时用来判断有没有被用户手动暂停） */
  const wantPlayRef = useRef(false);
  // 换词/换故事后旧请求不能覆盖新状态
  const genSeq = useRef(0);

  const generate = useCallback(
    async (source: StoryWord[]) => {
      if (source.length < 4) return;
      const seq = ++genSeq.current;
      setPhase("generating");
      setStory("");
      setNote("");
      try {
        // 先试云模型（线上主力，和 AI 答疑同通道）；不成功再回服务端兜底
        const cloudStory = await tryCloudStory(source);
        if (seq !== genSeq.current) return;
        if (cloudStory) {
          setPicked(source);
          setStory(cloudStory);
          setMode("ai");
          setNote("");
          setPhase("ready");
          return;
        }

        const res = await postJson<{ story: string | null; mode: Mode; note: string }>(
          "/api/vocab/story",
          { words: source },
        );
        if (seq !== genSeq.current) return;
        if (!res.story) {
          setNote(res.note || "生成失败，再试一次");
          setPhase("idle");
          return;
        }
        setPicked(source);
        setStory(res.story);
        setMode(res.mode);
        setNote(res.note ?? "");
        setPhase("ready");
      } catch (err) {
        if (seq !== genSeq.current) return;
        setNote(err instanceof Error ? err.message : "生成失败，再试一次");
        setPhase("idle");
      }
    },
    [],
  );

  /** 开始时生成：外部指定了词（选词页）就用指定的，否则从生词本随机抽一组 */
  useEffect(() => {
    if (givenWords && givenWords.length >= 4) {
      void generate(givenWords);
      return;
    }
    if (words.length === 0) return;
    const source = pickWords(words, Math.min(STORY_LEN, words.length));
    if (source.length >= 4) void generate(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 合成整篇 MP3 并播放 ---------- */
  const buildAudio = useCallback(
    async (text: string, gloss: boolean) => {
      // 旧的 blob URL 释放掉
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setAudioNote("");
      setAudioState("loading");
      try {
        const runs = storyToRuns(text, gloss);
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runs }),
        });
        if (!res.ok) throw new Error("音频合成失败");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioState("paused");
        return url;
      } catch (err) {
        setAudioState("failed");
        setAudioNote(err instanceof Error ? err.message : "音频合成失败");
        return null;
      }
    },
    [audioUrl],
  );

  /**
   * 设置源并起播。
   * 刚赋 src 时媒体还没就绪，play() 有一定概率被直接拒（NotSupportedError/AbortError），
   * 表现就是「点了没声」。这里在 loadedmetadata 后补一次，用户没手动暂停才补。
   */
  const playUrl = useCallback(
    (url: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = url;
      audio.playbackRate = rate;
      wantPlayRef.current = true;
      const retry = () => {
        audio.removeEventListener("loadedmetadata", retry);
        if (!wantPlayRef.current) return;
        void audio
          .play()
          .then(() => setAudioState("playing"))
          .catch(() => setAudioState("paused"));
      };
      void audio
        .play()
        .then(() => setAudioState("playing"))
        .catch(() => {
          audio.addEventListener("loadedmetadata", retry);
          setTimeout(retry, 500);
        });
    },
    [rate],
  );

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audioState === "playing") {
      wantPlayRef.current = false;
      audio.pause();
      setAudioState("paused");
      return;
    }
    let url = audioUrl;
    if (!url) {
      url = await buildAudio(story, withGloss);
      if (!url) return;
    }
    playUrl(url);
  }, [audioState, audioUrl, buildAudio, playUrl, story, withGloss]);

  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.currentTime = 0;
    wantPlayRef.current = true;
    void audio
      .play()
      .then(() => setAudioState("playing"))
      .catch(() => {});
  }, [audioUrl]);

  const seekTo = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = audio.duration * ratio;
    setProgress(ratio);
  }, []);

  /* 倍速：改了立刻作用到正在播的音频 */
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  /* 朗读是否带释义：已合成过就重新合成（缓存在服务端，二次秒出） */
  const toggleGloss = useCallback(async () => {
    const next = !withGloss;
    setWithGloss(next);
    if (phase === "ready" && story) {
      const url = await buildAudio(story, next);
      if (url && audioState === "playing") playUrl(url);
    }
  }, [withGloss, phase, story, buildAudio, audioState, playUrl]);

  /* Media Session：锁屏界面显示标题并可控 */
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "单词串联故事",
        artist: picked.map((item) => item.word).join(" · ") || "生词本词汇",
        album: "左文右题",
      });
      navigator.mediaSession.setActionHandler("play", () => void togglePlay());
      navigator.mediaSession.setActionHandler("pause", () => {
        wantPlayRef.current = false;
        audioRef.current?.pause();
        setAudioState("paused");
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10);
      });
    } catch {
      /* 旧内核没有 MediaMetadata / setActionHandler */
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);
      } catch {
        /* 忽略 */
      }
    };
  }, [picked, togglePlay]);

  /* 卸载时释放 blob */
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audio?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tokens = useMemo(() => (story ? parseStory(story) : []), [story]);

  if (!givenWords && words.length === 0) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-16 text-center">
        <button onClick={onExit} className="mb-8 text-[13px] text-ink-mute hover:text-ink">
          ← 返回词表
        </button>
        <p className="font-serif text-[20px] text-ink">生词本是空的</p>
        <p className="mt-3 text-[13px] text-ink-mute">先去刷题攒几个词，再来串故事。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-60px)] max-w-[720px] flex-col px-5 pb-10">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-line py-4">
        <button onClick={onExit} className="text-[13px] text-ink-mute hover:text-ink">
          ← {givenWords ? "返回选词" : "返回词表"}
        </button>
        <span className="font-serif text-[15px] text-ink">单词串联故事</span>
        <span className="text-[11.5px] text-ink-mute">
          {picked.length > 0 ? `${picked.length} 个词` : "…"}
        </span>
      </div>

      {/* 本篇用词 */}
      {picked.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {picked.map((item) => (
            <span
              key={item.word}
              className="rounded-full border border-line bg-paper-deep/40 px-2.5 py-1 text-[11.5px] text-ink-soft"
            >
              {item.word}
              <span className="ml-1 text-ink-mute">{item.zh}</span>
            </span>
          ))}
        </div>
      )}

      {/* 故事正文（高度按内容走，不在桌面端撑成一块空白） */}
      <div className="mt-4 min-h-[220px] rounded-[14px] border border-line bg-surface px-6 py-6">
        {phase === "generating" && (
          <p className="py-10 text-center text-[13.5px] text-ink-mute">
            正在把 {picked.length || ""} 个词串成故事…
          </p>
        )}
        {phase === "idle" && (
          <div className="py-10 text-center">
            <p className="text-[13.5px] text-ink-mute">{note || "点下面的按钮生成故事"}</p>
          </div>
        )}
        {phase === "ready" && (
          <>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-mute">
              {mode === "ai" ? "AI 串词故事" : "句架串联（AI 不可用时的兜底）"}
              {" · 目标词加粗并附中文释义，按词序串完"}
            </p>
            <p className="font-serif text-[17px] leading-[2.1] text-ink">
              {tokens.map((token, i) =>
                token.type === "word" ? (
                  <span key={i}>
                    <b className="font-semibold text-ink">{token.word}</b>
                    <span className="text-[13px] text-ink-mute">（{token.zh}）</span>{" "}
                  </span>
                ) : (
                  <span key={i}>{token.text}</span>
                ),
              )}
            </p>
          </>
        )}
        {note && phase === "ready" && (
          <p className="mt-3 text-[11.5px] text-ink-mute">{note}</p>
        )}
      </div>

      {/* 播放控制 */}
      <div className="mt-4 space-y-3.5">
        {/* 进度条 */}
        <div
          className="group h-[6px] w-full cursor-pointer rounded-full bg-line-soft"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
          }}
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex items-center justify-between font-mono text-[11px] text-ink-mute">
          <span>{formatTime(duration * progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        {/* 主按钮 */}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={replay}
            disabled={!audioUrl}
            className="h-11 w-11 rounded-full border border-line text-[15px] text-ink-soft transition-colors hover:border-ink-mute disabled:opacity-30"
            aria-label="从头重听"
          >
            ↺
          </button>
          <button
            type="button"
            onClick={() => void togglePlay()}
            disabled={phase !== "ready"}
            className="flex h-[60px] min-w-[168px] items-center justify-center gap-2 rounded-full bg-ink px-8 text-[15px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {audioState === "loading"
              ? "正在合成音频…"
              : audioState === "playing"
                ? "⏸ 暂停"
                : "▶ 听故事"}
          </button>
          <button
            type="button"
            onClick={() => {
              // 选词页进来时「换一组」退回选词重新勾选；随机模式则再抽一组
              if (givenWords) {
                onExit();
                return;
              }
              void generate(pickWords(words, Math.min(STORY_LEN, words.length)));
            }}
            disabled={phase === "generating"}
            className="h-11 w-11 rounded-full border border-line text-[15px] text-ink-soft transition-colors hover:border-ink-mute disabled:opacity-30"
            aria-label={givenWords ? "返回选词" : "换一组词重新串"}
          >
            ⟳
          </button>
        </div>

        {/* 选项行 */}
        <div className="flex flex-wrap items-center justify-center gap-4 text-[12px]">
          <div className="flex items-center gap-1">
            {RATE_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                className={`rounded-full px-2.5 py-1 transition-colors ${
                  rate === r ? "bg-ink text-paper" : "text-ink-mute hover:bg-paper-deep"
                }`}
              >
                {r}x
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void toggleGloss()}
            className={`rounded-full border px-3 py-1 transition-colors ${
              withGloss
                ? "border-accent/60 bg-accent/[0.08] text-accent"
                : "border-line text-ink-mute hover:border-ink-mute"
            }`}
          >
            朗读带中文释义 {withGloss ? "开" : "关"}
          </button>
        </div>

        {audioState === "failed" && (
          <p className="text-center text-[11.5px] text-wrong">
            {audioNote || "音频合成失败"}。可以点「听故事」重试，或换 Chrome / 微信再打开。
          </p>
        )}
        {audioState === "playing" && (
          <p className="text-center text-[11px] text-ink-mute">
            熄屏/锁屏后会继续播放，锁屏界面也能暂停和快进。
          </p>
        )}
      </div>

      {/* 真正出声的元素：整篇一个 MP3，锁屏后系统媒体通道继续放 */}
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration) && el.duration > 0) setProgress(el.currentTime / el.duration);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          wantPlayRef.current = false;
          setAudioState("paused");
          setProgress(1);
        }}
        onPause={() => setAudioState((s) => (s === "loading" ? s : "paused"))}
        onPlay={() => setAudioState("playing")}
      />
    </div>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
