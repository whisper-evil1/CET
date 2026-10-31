"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cloud, cloudReady } from "@/lib/cloud";

type Props = {
  questionId: string;
  quickPrompts: string[];
  onClose: () => void;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * AI 答疑抽屉。
 *
 * 上下文（文章 + 题干 + 选项 + 我的作答 + 解析）由服务端 /api/questions/[id]/ai-context 拼好，
 * 前端拿到 system prompt 后直接调云服务 LLM（cloud.llm），逐 token 流式渲染。
 * 云服务未就绪或模型调用失败时，回退到服务端 /api/ai/chat（内置演示流式），保证不白屏。
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

  // 服务端拼好的 system prompt（含文章与题目上下文）
  const systemPromptRef = useRef<string>("");
  // 云服务模型 id，首次 list 后缓存
  const modelRef = useRef<string | null>(null);
  // 云 LLM 调用是否已失败过，失败后本轮回退到服务端演示流式
  const cloudFailedRef = useRef(false);

  // 挂载时拉取上下文 + 云模型列表（只跑一次）
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/questions/${questionId}/ai-context`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { data?: { systemPrompt?: string } };
          if (!cancelled && json.data?.systemPrompt) {
            systemPromptRef.current = json.data.systemPrompt;
          }
        }
      } catch {
        // 拉取失败时 send() 会走服务端回退
      }

      if (!cloudReady || !cloud || cloudFailedRef.current) return;
      try {
        const models = await cloud.llm.models.list();
        // 选第一个未被禁用的模型；空列表视为不可用
        const picked = models.find((m) => m.disabled !== true);
        if (!cancelled && picked) modelRef.current = picked.id;
      } catch {
        // 模型列表拉取失败，send() 走回退
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [questionId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, streaming]);

  const appendAssistant = (acc: string) => {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", content: acc };
      return copy;
    });
  };

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

    const canUseCloud =
      Boolean(cloud && modelRef.current && systemPromptRef.current && !cloudFailedRef.current);

    // 云 LLM 兜底超时：15s 没拿到第一个 chunk 就放弃，快速回退到服务端演示流
    let cloudTimedOut = false;
    const cloudTimer = setTimeout(() => {
      cloudTimedOut = true;
      controller.abort();
    }, 15000);

    try {
      if (canUseCloud) {
        setMode("live");
        // 云服务 LLM：前端直调，流式拼 token
        const stream = cloud!.llm.chat.completions.create({
          model: modelRef.current!,
          messages: [
            { role: "system", content: systemPromptRef.current },
            ...nextMessages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          ],
          stream: true,
          temperature: 0.3,
          signal: controller.signal,
        });

        let acc = "";
        for await (const chunk of stream) {
          clearTimeout(cloudTimer); // 第一个 chunk 到达即取消超时
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            acc += delta;
            appendAssistant(acc);
          }
        }
      } else {
        // 回退：服务端演示流式
        setMode("mock");
        await streamFromServer(questionId, nextMessages, controller, appendAssistant);
      }
    } catch (err) {
      // 超时触发的 abort 不算用户主动停止，需要走回退流程
      const isUserAbort =
        (err as Error).name === "AbortError" && !cloudTimedOut;
      if (isUserAbort) return;

      // 云 LLM 失败/超时时自动回退一次到服务端演示流式
      if (canUseCloud) {
        cloudFailedRef.current = true;
        setMode("mock");
        try {
          // 回退时新建一个 controller，因为原 controller 可能已被超时 abort
          const fbController = new AbortController();
          abortRef.current = fbController;
          await streamFromServer(questionId, nextMessages, fbController, appendAssistant);
          return;
        } catch (e2) {
          if ((e2 as Error).name === "AbortError") return;
          setError(e2 instanceof Error ? e2.message : "AI 暂时不可用");
        }
      } else {
        setError(err instanceof Error ? err.message : "AI 暂时不可用");
      }

      setMessages((prev) => {
        const copy = [...prev];
        if (copy.at(-1)?.content === "") copy.pop();
        return copy;
      });
    } finally {
      clearTimeout(cloudTimer);
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
            演示模式（云模型未就绪）
          </span>
        )}
        {mode === "live" && (
          <span className="rounded-full bg-correct-soft px-2 py-0.5 text-[10px] text-correct">
            云模型已接入
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

/**
 * 服务端回退流式：云模型不可用时走 /api/ai/chat（内置演示流式）。
 * 读 plain text 流，逐片累加并回调渲染。
 */
async function streamFromServer(
  questionId: string,
  messages: ChatMessage[],
  controller: AbortController,
  onChunk: (acc: string) => void,
): Promise<void> {
  // 客户端兜底超时：服务端已加超时，这里再兜一层，30s 没拿完就报错，绝不无限挂起
  let timedOut = false;
  const clientTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30000);

  try {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        questionId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
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
      onChunk(acc);
    }
  } catch (err) {
    if (timedOut) throw new Error("AI 响应超时（30s），请重试");
    throw err;
  } finally {
    clearTimeout(clientTimer);
  }
}
