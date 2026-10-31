"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  questionId: string;
  quickPrompts: string[];
  onClose: () => void;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * AI 答疑抽屉。
 * 服务端负责把「文章 + 题干 + 选项 + 我的选择 + 正确答案 + 解析」拼进 system prompt，
 * 前端只发对话内容，避免上下文靠前端拼装导致答非所问。
 * 切题时抽屉随题目卸载（shell 里用 key 控制），会话自然重置。
 */
export function AiDrawer({ questionId, quickPrompts, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          questionId,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const headerMode = response.headers.get("X-AI-Mode");
      setMode(headerMode === "live" ? "live" : "mock");

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(payload?.message ?? `请求失败（HTTP ${response.status}）`);
      }
      if (!response.body) throw new Error("浏览器不支持流式响应");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "AI 暂时不可用");
      setMessages((prev) => {
        const copy = [...prev];
        if (copy.at(-1)?.content === "") copy.pop();
        return copy;
      });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const regenerate = () => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((prev) => prev.slice(0, Math.max(0, prev.length - 1)));
    void send(lastUser.content);
  };

  return (
    <aside className="drawer-in fixed top-0 right-0 z-40 flex h-full w-full max-w-[440px] flex-col border-l border-line bg-surface shadow-[-16px_0_40px_-24px_rgba(40,30,10,0.25)]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-5">
        <h3 className="text-[13px] font-medium text-ink">问 AI</h3>
        {mode === "mock" && (
          <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[10px] text-ink-mute">
            演示模式（未配置 Key）
          </span>
        )}
        {mode === "live" && (
          <span className="rounded-full bg-correct-soft px-2 py-0.5 text-[10px] text-correct">
            已接入模型
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto text-[13px] text-ink-mute hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="scroll-pane min-h-0 flex-1 px-5 py-4">
        {messages.length === 0 && (
          <div className="pt-2">
            <p className="text-[12.5px] leading-[1.8] text-ink-mute">
              已经把这篇文章、这道题的题干和四个选项一起给了 AI，
              它会基于原文回答，不会凭空编。先挑一个问题试试：
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => send(prompt)}
                  className="rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        <ul className="space-y-4">
          {messages.map((message, index) => (
            <li key={index}>
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-[10px] rounded-br-[2px] bg-ink px-3.5 py-2 text-[13px] leading-[1.7] text-paper">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div className="prose-tight">
                  {message.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  ) : (
                    <span className="caret text-[12.5px] text-ink-mute">思考中</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {error && (
          <p className="mt-3 rounded-[8px] border border-line bg-paper px-3 py-2 text-[12px] text-wrong">
            {error}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-line px-4 py-3">
        {messages.length > 0 && !streaming && (
          <button
            type="button"
            onClick={regenerate}
            className="mb-2 text-[11.5px] text-ink-mute hover:text-ink"
          >
            ↻ 重新生成
          </button>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
              event.stopPropagation();
            }}
            rows={2}
            placeholder="继续追问，例如：C 选项错在哪？"
            className="min-w-0 flex-1 resize-none rounded-[8px] border border-line bg-paper px-3 py-2 text-[13px] leading-[1.6] outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={streaming || !input.trim()}
            className="h-9 rounded-full bg-accent px-4 text-[12.5px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {streaming ? "…" : "发送"}
          </button>
        </div>
      </div>
    </aside>
  );
}
