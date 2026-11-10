"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cloud, cloudReady } from "@/lib/cloud";
import { streamCloudText, rankModels, describeCloudError, type StreamFactory } from "@/lib/cloud-stream";
import { withSharecode, isPlatformBlock } from "@/lib/share-code";
import { prepareMarkdown } from "@/lib/markdown";
import { buildGradePrompt, type GradeType } from "@/lib/writing-grade";
import type { PracticeSection, PracticePassage } from "@/lib/types";

type Props = {
  section: PracticeSection;
  passage: PracticePassage;
  paperId: string;
  level?: string | null;
  onNotice: (msg: string | null) => void;
};

type Mode = "live" | "local" | null;

/**
 * 写作 / 翻译 Section 的答题区。
 *
 * AI 批改通道（与 AI 答疑、错题分析保持一致）：
 *   1. 浏览器直连 WorkBuddy 云模型（cloud.llm），首字快、不过 Node 中转。
 *   2. 云不可用 → /api/ai/grade：配了 AI_API_KEY 走真实模型，
 *      否则返回服务端依据真实作答算出的规则批改。
 *
 * 以前这里直接打 /api/ai/chat，那个接口注入的是「阅读老师」的提示词，
 * 没配 Key 时还会吐「回原文扫一遍找到同一段」——对着翻译题答非所问。
 * 现在改用阅卷老师提示词（lib/writing-grade.ts），正文按 Markdown 渲染，
 * 不再出现裸露的 ** 星号。
 */
export function WritingTranslationPane({ section, passage, paperId, level, onNotice }: Props) {
  // 取第一道题（写作/翻译每套卷通常只有一道大题）
  const question = passage.questions[0];
  const isTranslation = section.type === "translation";
  const gradeType: GradeType = isTranslation ? "translation" : "writing";

  // 用户作答文本，按 questionId 存在 localStorage 防刷新丢失
  const storageKey = `cet:writing:${paperId}:${section.type}`;
  const [answer, setAnswer] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? "";
  });

  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const timedOutRef = useRef(false);
  const modelsRef = useRef<string[]>([]);
  const cloudFailedRef = useRef(false);

  // 挂载即预取云模型列表，点击批改时零等待
  useEffect(() => {
    let cancelled = false;
    if (!cloudReady || !cloud) return;
    void (async () => {
      try {
        const models = await cloud.llm.models.list();
        if (!cancelled) modelsRef.current = rankModels(models);
      } catch {
        /* 取不到就走服务端兜底，不打扰用户 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 作答实时存 localStorage
  const handleChange = (value: string) => {
    setAnswer(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, value);
    }
  };

  const promptInput = () => ({
    type: gradeType,
    stem: question?.stem ?? "",
    reference: question?.analysis || null,
    answer,
    level: level ?? null,
  });

  /** 服务端兜底通道：/api/ai/grade 自己重建提示词，前端只交题目 id 与作答 */
  const streamFromServer = async (controller: AbortController) => {
    const response = await fetch(withSharecode("/api/ai/grade"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ questionId: question?.id ?? "", answer }),
    });
    if (isPlatformBlock(response, response.headers.get("content-type"))) {
      throw new Error("分享链接不完整，请从群里的分享链接重新进入本页");
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`);
    }
    if (!response.body) throw new Error("当前浏览器不支持流式响应");
    setMode(response.headers.get("X-AI-Mode") === "live" ? "live" : "local");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setFeedback(acc);
    }
  };

  const handleGrade = async () => {
    if (!answer.trim()) {
      onNotice("请先写下你的作答再让 AI 批改");
      return;
    }
    if (grading) return;

    setGrading(true);
    setFeedback("");
    setMode(null);
    setError(null);
    setFallbackNote(null);
    onNotice(null);
    stoppedRef.current = false;
    timedOutRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, 60_000);

    const canUseCloud = Boolean(cloud && modelsRef.current.length > 0 && !cloudFailedRef.current);
    const built = promptInput();
    let acc = "";

    try {
      if (canUseCloud) {
        setMode("live");
        const messages = [
          { role: "system" as const, content: buildGradePrompt(built) },
          {
            role: "user" as const,
            content: `这是我的${isTranslation ? "译文" : "作文"}，请批改：\n\n${answer}`,
          },
        ];
        const factory: StreamFactory = (model, msgs) =>
          cloud!.llm.chat.completions.create({
            model,
            messages: msgs as { role: "system" | "user" | "assistant"; content: string }[],
            stream: true,
            temperature: 0.3,
            signal: controller.signal,
          }) as AsyncIterable<{ choices: ReadonlyArray<{ delta?: { content?: string | null } }> }>;

        for await (const delta of streamCloudText(factory, { models: modelsRef.current, messages })) {
          acc += delta;
          setFeedback(acc);
        }
      } else {
        await streamFromServer(controller);
      }
    } catch (err) {
      if (stoppedRef.current) {
        // 用户主动停止：保留已生成内容
      } else if (timedOutRef.current || (err as Error).name === "AbortError") {
        setError("批改超时，已保留已生成的部分，可以再点一次重试");
      } else if (canUseCloud && !acc.trim()) {
        // 云模型一个字都没吐出来 → 走一次服务端兜底（本地规则批改保底有内容）
        cloudFailedRef.current = true;
        setFallbackNote(describeCloudError(err, "本地规则批改"));
        try {
          const fb = new AbortController();
          abortRef.current = fb;
          await streamFromServer(fb);
        } catch (e2) {
          if ((e2 as Error).name === "AbortError") return;
          setError(e2 instanceof Error ? e2.message : "批改失败，请重试");
        }
      } else if (canUseCloud) {
        setFallbackNote(describeCloudError(err, "保留已生成内容"));
      } else {
        setFeedback("");
        setError(err instanceof Error ? err.message : "批改失败，请稍后再试");
      }
    } finally {
      clearTimeout(timer);
      setGrading(false);
      abortRef.current = null;
    }
  };

  const stopGrading = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setGrading(false);
  };

  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        {/* 题干 */}
        <div className="rounded-xl border border-line bg-paper-deep p-6">
          <div className="flex flex-wrap items-center justify-between gap-y-2">
            <h2 className="font-serif text-[18px] text-ink">{section.title}</h2>
            <span className="text-[12px] text-ink-mute">
              限时 {section.timeLimit ?? "—"} 分钟
            </span>
          </div>
          <div className="mt-4 whitespace-pre-wrap text-[14.5px] leading-[1.9] text-ink-soft">
            {question?.stem ?? "暂无题目"}
          </div>
        </div>

        {/* 作答区 */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-[13px] text-ink">
              你的{isTranslation ? "译文" : "作文"}
            </label>
            <span className="font-mono text-[11px] text-ink-mute">{wordCount} 词</span>
          </div>
          <textarea
            value={answer}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={isTranslation ? "在此输入你的英文译文…" : "在此输入你的作文…"}
            className="h-56 w-full resize-y rounded-lg border border-line bg-surface p-4 font-serif text-[14px] leading-[1.8] text-ink outline-none transition-colors focus:border-accent"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {grading ? (
              <button
                type="button"
                onClick={stopGrading}
                className="rounded-full bg-wrong px-5 py-2 text-[13px] text-white transition-opacity hover:opacity-90"
              >
                停止批改
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleGrade()}
                disabled={!answer.trim()}
                className="rounded-full bg-accent px-5 py-2 text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
              >
                🤖 AI 批改
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowReference((v) => !v)}
              className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
            >
              {showReference ? "收起参考要点" : "📖 参考要点"}
            </button>

            <button
              type="button"
              onClick={() => handleChange("")}
              className="ml-auto text-[12px] text-ink-mute underline-offset-2 hover:text-wrong hover:underline"
            >
              清空作答
            </button>
          </div>
        </div>

        {/* AI 批改结果 */}
        {(feedback || grading) && (
          <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-serif text-[15px] text-ink">AI 批改反馈</h3>
              {mode === "live" && (
                <span className="rounded-full bg-correct-soft px-2 py-0.5 text-[10px] text-correct">
                  云模型已接入
                </span>
              )}
              {mode === "local" && (
                <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[10px] text-ink-mute">
                  本地规则批改
                </span>
              )}
            </div>

            {feedback ? (
              <div className="prose-tight text-[13.5px] leading-[1.85] text-ink-soft">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{prepareMarkdown(feedback)}</ReactMarkdown>
                {grading && <span className="ml-1 animate-pulse">▋</span>}
              </div>
            ) : (
              <p className="caret text-[12.5px] text-ink-mute">批改中</p>
            )}

            {fallbackNote && (
              <p className="mt-3 text-[11px] leading-[1.6] text-ink-mute">{fallbackNote}</p>
            )}

            {error && (
              <p className="mt-3 rounded-[8px] border border-line bg-paper px-3 py-2 text-[12px] text-wrong">
                {error}
              </p>
            )}
          </div>
        )}

        {/* 参考要点 */}
        {showReference && (
          <div className="mt-6 rounded-xl border border-line bg-paper-deep p-5">
            <h3 className="mb-2 font-serif text-[15px] text-ink">参考要点</h3>
            <p className="whitespace-pre-wrap text-[13.5px] leading-[1.85] text-ink-soft">
              {question?.analysis || "暂无参考要点。"}
            </p>
            <p className="mt-3 text-[11.5px] text-ink-mute">
              提示：
              {isTranslation
                ? "翻译没有唯一标准答案，重点看关键信息是否准确传达、语言是否通顺。"
                : "写作没有唯一范文，重点看是否切题、结构是否清晰、语言是否准确多样。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
