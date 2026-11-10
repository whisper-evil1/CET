"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cloud, cloudReady } from "@/lib/cloud";
import { withSharecode } from "@/lib/share-code";
import { prepareMarkdown } from "@/lib/markdown";

type Props = {
  questionId: string;
  quickPrompts: string[];
  onClose: () => void;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * 给异步迭代器加「不依赖底层实现」的超时。
 *
 * 为什么需要：云端 LLM 的 create() 会先返回 200 再慢慢吐 chunk。
 * 如果上游接了但一直不吐字，单靠 controller.abort() 未必生效 ——
 * SDK 没有把 signal 接到 socket 上时，for await 既不抛错也不返回，
 * 界面就永久停在「思考中…」。这里对每次 next() 竞速一个超时，
 * 首字 15s、后续 12s，超时直接抛错，让调用方走服务端回退。
 */
async function* withChunkTimeout<T>(
  source: AsyncIterable<T>,
  firstMs: number,
  nextMs: number,
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let isFirst = true;
  try {
    while (true) {
      const ms = isFirst ? firstMs : nextMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI_TIMEOUT")), ms);
      });
      // 迭代先完成时，避免这个 promise 的 reject 变成未处理拒绝
      timeout.catch(() => {});

      let result: IteratorResult<T>;
      try {
        result = await Promise.race([iterator.next(), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (result.done) return;
      isFirst = false;
      yield result.value;
    }
  } finally {
    await iterator.return?.(undefined);
  }
}

/**
 * AI 答疑抽屉。
 *
 * 上下文（文章 + 题干 + 选项 + 我的作答 + 解析）由服务端 /api/questions/[id]/ai-context 拼好，
 * 前端拿到 system prompt 后直接调云服务 LLM（cloud.llm），逐 token 流式渲染。
 * 云服务未就绪或模型调用失败时，回退到服务端 /api/ai/chat（内置演示流式），保证不白屏。
 * 切题时抽屉随题目卸载（shell 里用 key 控制），会话自然重置。
 */
/**
 * 给云端返回的模型列表排个可用性顺序。
 *
 * 依据 2026-11-01 对线上账号实测（同一 prompt、同一直连）：
 *   deepseek-v4.1-flash  首字 958ms   ✅
 *   deepseek-v4-flash    首字 1162ms  ✅
 *   glm-5.3-flash        首字 1359ms  ✅
 *   kimi-k2.5            首字 1288ms  ✅
 *   kimi-k3-1            首字 4584ms  ✅（带思考）
 *   hy3                  首字 11429ms ✅（思考 1456 字，用户体感像卡住）
 *   auto / default       200 但 30s 无正文 ❌（它们是路由别名）
 *   hy4-preview          30s 无正文     ❌
 *   minimax-m2.5 / glm-4.x / glm-5.x  400 参数无效 ❌
 *
 * 所以：排除路由别名、flash 优先、其余靠后，运行期再按顺序逐个重试。
 */
function rankModels(models: ReadonlyArray<{ id: string; disabled?: boolean }>): string[] {
  const usable = models.filter((m) => m.disabled !== true && !/^(auto|default)$/i.test(m.id));
  const score = (id: string) => {
    if (/flash/i.test(id)) return 0;
    if (/^deepseek/i.test(id)) return 1;
    if (/^(kimi|glm)/i.test(id)) return 2;
    return 3;
  };
  return [...usable].sort((a, b) => score(a.id) - score(b.id)).map((m) => m.id);
}

/**
 * 把云服务错误翻译成用户能看懂的一句话。
 *
 * 依据 SDK 的 CloudOpenAIError 公共字段（error.code / status / requestId），
 * 按 code 前缀归类，不读 SDK 私有字段：
 *   auth_     凭证或 Origin 不匹配（最常见：发布域名换了，产物里的 endpoint 没跟着换）
 *   quota_    创作者额度用尽或限流
 *   request_  参数或模型不被接受，重试无意义
 *   gateway_ / model_  模型服务暂时不可用，可重试
 *   internal_ 服务内部错误，需要 requestId 才能查
 * 没有 error 字段的（本地超时、空响应）按自定义 Error 处理。
 */
function describeCloudError(error: unknown): string {
  const err = error as { name?: string; message?: string; error?: { code?: string | null } };
  const code = err?.error?.code ?? "";

  if (err?.message === "AI_TIMEOUT") return "云模型超时未出字，已切到演示回答";
  if (err?.message === "AI_EMPTY_RESPONSE") return "云模型只思考不出正文，已切到演示回答";
  if (code.startsWith("auth_")) return "云服务凭证与当前域名不匹配，已切到演示回答";
  if (code.startsWith("quota_")) return "云模型额度已用尽或被限流，已切到演示回答";
  if (code.startsWith("request_")) return "云模型不接受本次请求参数，已切到演示回答";
  if (code.startsWith("gateway_") || code.startsWith("model_")) return "云模型暂时不可用，已切到演示回答";
  if (code.startsWith("internal_")) return "云服务内部错误，已切到演示回答";
  return err?.message ? `云模型调用失败：${err.message}` : "云模型调用失败，已切到演示回答";
}

export function AiDrawer({ questionId, quickPrompts, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 从云模型回退到演示模式时，说明回退原因（不让失败静默发生）
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 服务端拼好的 system prompt（含文章与题目上下文）
  const systemPromptRef = useRef<string>("");
  // 云服务候选模型（按实测可用性排序），首个失败会自动换下一个
  const modelsRef = useRef<string[]>([]);
  // 云 LLM 调用是否已失败过，失败后本轮回退到服务端演示流式
  const cloudFailedRef = useRef(false);

  // 挂载时拉取上下文 + 云模型列表（只跑一次）
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(withSharecode(`/api/questions/${questionId}/ai-context`), { cache: "no-store" });
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
        if (!cancelled) modelsRef.current = rankModels(models);
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

    const canUseCloud = Boolean(
      cloud && modelsRef.current.length > 0 && systemPromptRef.current && !cloudFailedRef.current,
    );

    try {
      if (canUseCloud) {
        setMode("live");
        const messages_: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: systemPromptRef.current },
          ...nextMessages.map((m) => ({ role: m.role, content: m.content })),
        ];

        let acc = "";
        let lastError: unknown = null;

        // 逐个候选模型试（最多 3 个）：路由别名和部分推理模型会「200 但不吐正文」，
        // 只试第一个就等于把用户按在「思考中…」上干等。第一个能出字就停。
        for (const model of modelsRef.current.slice(0, 3)) {
          let local = "";
          try {
            const stream = cloud!.llm.chat.completions.create({
              model,
              messages: messages_,
              stream: true,
              temperature: 0.3,
              signal: controller.signal,
            });

            for await (const chunk of withChunkTimeout(stream, 12000, 12000)) {
              // 该接口是标准 SSE 流式，正文只从 delta.content 来；
              // 推理模型的 reasoning_content 是思考过程，不计入正文
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                local += delta;
                acc = local;
                appendAssistant(acc);
              }
            }

            if (!local.trim()) throw new Error("AI_EMPTY_RESPONSE");
            lastError = null;
            break;
          } catch (err) {
            if ((err as Error).name === "AbortError") throw err;
            // 已经吐过字就别换模型了，否则会把前半段答案冲掉
            if (local.trim()) {
              lastError = null;
              break;
            }
            lastError = err;
            acc = "";
          }
        }

        if (lastError) throw lastError;
      } else {
        // 回退：服务端演示流式
        setMode("mock");
        await streamFromServer(questionId, nextMessages, controller, appendAssistant);
      }
    } catch (err) {
      // 超时（AI_TIMEOUT / AI_EMPTY_RESPONSE）走普通 Error 分支，
      // 只有用户主动点停止才是 AbortError，不该触发回退
      const isUserAbort = (err as Error).name === "AbortError";
      if (isUserAbort) return;

      // 云 LLM 失败/超时时自动回退一次到服务端演示流式
      if (canUseCloud) {
        cloudFailedRef.current = true;
        setMode("mock");
        setFallbackNote(describeCloudError(err));
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
        // 不用 copy.at(-1)：Array.prototype.at 是 ES2022，老内核（Chrome<92 / iOS<15.4）没有
        const last = copy[copy.length - 1];
        if (last && last.content === "") copy.pop();
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{prepareMarkdown(message.content)}</ReactMarkdown>
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
        {mode === "mock" && fallbackNote && (
          <p className="mb-2 text-[11px] leading-[1.6] text-ink-mute">{fallbackNote}</p>
        )}
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
    const response = await fetch(withSharecode("/api/ai/chat"), {
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
