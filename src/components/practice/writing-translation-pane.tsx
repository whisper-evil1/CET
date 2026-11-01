"use client";

import { useRef, useState } from "react";
import type { PracticeSection, PracticePassage } from "@/lib/types";

type Props = {
  section: PracticeSection;
  passage: PracticePassage;
  paperId: string;
  onNotice: (msg: string | null) => void;
};

/**
 * 写作 / 翻译 Section 的答题区。
 * 左侧显示题干，右侧是文本框 + AI 批改 + 参考要点。
 * AI 批改复用 /api/ai/chat 流式接口，把用户作答发给 AI 请其点评。
 */
export function WritingTranslationPane({ section, passage, paperId, onNotice }: Props) {
  // 取第一道题（写作/翻译每套卷通常只有一道大题）
  const question = passage.questions[0];
  const isTranslation = section.type === "translation";

  // 用户作答文本，按 questionId 存在 localStorage 防刷新丢失
  const storageKey = `cet:writing:${paperId}:${section.type}`;
  const [answer, setAnswer] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(storageKey) ?? "";
  });

  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [showReference, setShowReference] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // 作答实时存 localStorage
  const handleChange = (value: string) => {
    setAnswer(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, value);
    }
  };

  /** 调用 AI 批改：把题干 + 用户作答发给 /api/ai/chat，流式接收点评 */
  const handleGrade = async () => {
    if (!answer.trim()) {
      onNotice("请先写下你的作答再让 AI 批改");
      return;
    }
    if (grading) return;

    setGrading(true);
    setFeedback("");
    onNotice(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const taskDesc = isTranslation ? "翻译" : "写作";
    const prompt = `请你作为四六级${taskDesc}阅卷老师，批改下面的${taskDesc}。

题目：${question?.stem ?? ""}

我的${taskDesc}：
${answer}

请从以下几个方面点评：
1. 总体评分（满分按考试标准）
2. 优点
3. 需要改进的地方（至少 3 点，指出具体句子）
4. 建议的高分表达或句型

请用中文回答。`;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          questionId: question?.id ?? "",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`请求失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error("浏览器不支持流式响应");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setFeedback(acc);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onNotice(err instanceof Error ? err.message : "AI 批改失败，请稍后再试");
    } finally {
      setGrading(false);
      abortRef.current = null;
    }
  };

  const stopGrading = () => {
    abortRef.current?.abort();
    setGrading(false);
  };

  const wordCount = answer.trim() ? answer.trim().split(/\s+/).length : 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper">
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        {/* 题干 */}
        <div className="rounded-xl border border-line bg-paper-deep p-6">
          <div className="flex items-center justify-between">
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
            <span className="font-mono text-[11px] text-ink-mute">
              {wordCount} 词
            </span>
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
        {feedback && (
          <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-5">
            <h3 className="mb-2 font-serif text-[15px] text-ink">AI 批改反馈</h3>
            <div className="whitespace-pre-wrap text-[13.5px] leading-[1.85] text-ink-soft">
              {feedback}
              {grading && <span className="ml-1 animate-pulse">▋</span>}
            </div>
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
              提示：{isTranslation ? "翻译没有唯一标准答案，重点看关键信息是否准确传达、语言是否通顺。" : "写作没有唯一范文，重点看是否切题、结构是否清晰、语言是否准确多样。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
