"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cloud, cloudReady } from "@/lib/cloud";
import { withSharecode, isPlatformBlock } from "@/lib/share-code";
import { prepareMarkdown } from "@/lib/markdown";

/**
 * 错题 AI 薄弱点分析面板。
 *
 * 通道优先级（与 AI 答疑一致）：
 *   1. 浏览器直连 WorkBuddy 云模型（cloud.llm）——线上真实模型，首字快。
 *   2. 云不可用 → 服务端 /api/mistakes/analyze（配了 AI_API_KEY 走真实模型，
 *      否则用 buildLocalMistakeAnalysis 依据真实错题数据归纳）。
 *
 * 系统提示词由 /api/mistakes/context 在挂载时预取，点击时零等待。
 * 正文按 Markdown 渲染，不再出现裸露的 ** 星号。
 */
type Mode = "live" | "local" | null;

async function* withChunkTimeout<T>(source: AsyncIterable<T>, firstMs: number, nextMs: number): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let isFirst = true;
  try {
    while (true) {
      const ms = isFirst ? firstMs : nextMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI_TIMEOUT")), ms);
      });
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

function describeCloudError(error: unknown): string {
  const err = error as { name?: string; message?: string; error?: { code?: string | null } };
  const code = err?.error?.code ?? "";
  if (err?.message === "AI_TIMEOUT") return "云模型超时，已切换到本地归纳";
  if (err?.message === "AI_EMPTY_RESPONSE") return "云模型未出正文，已切换到本地归纳";
  if (code.startsWith("auth_")) return "云服务凭证与域名不匹配，已切换到本地归纳";
  if (code.startsWith("quota_")) return "云模型额度用尽，已切换到本地归纳";
  if (code.startsWith("gateway_") || code.startsWith("model_")) return "云模型暂时不可用，已切换到本地归纳";
  return "云模型调用失败，已切换到本地归纳";
}

export function MistakeAiPanel({ hasMistakes }: { hasMistakes: boolean }) {
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const timedOutRef = useRef(false);
  const systemPromptRef = useRef("");
  const modelsRef = useRef<string[]>([]);
  const cloudFailedRef = useRef(false);

  // 挂载即预取提示词与云模型列表
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(withSharecode("/api/mistakes/context"), { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { data?: { systemPrompt?: string } };
          if (!cancelled && json.data?.systemPrompt) systemPromptRef.current = json.data.systemPrompt;
        }
      } catch {
        /* 取不到就走服务端兜底 */
      }
      if (!cloudReady || !cloud || cloudFailedRef.current) return;
      try {
        const models = await cloud.llm.models.list();
        if (!cancelled) modelsRef.current = rankModels(models);
      } catch {
        /* 模型列表失败，run() 走兜底 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const streamFromServer = async (controller: AbortController) => {
    const response = await fetch(withSharecode("/api/mistakes/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({}),
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
      setText(acc);
    }
  };

  const run = async () => {
    if (streaming) return;
    setStreaming(true);
    setError(null);
    setFallbackNote(null);
    setText("");
    setMode(null);
    stoppedRef.current = false;
    timedOutRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, 45_000);

    const canUseCloud = Boolean(
      cloud && modelsRef.current.length > 0 && systemPromptRef.current && !cloudFailedRef.current,
    );

    try {
      if (canUseCloud) {
        setMode("live");
        const messages = [
          { role: "system" as const, content: systemPromptRef.current },
          { role: "user" as const, content: "请基于上面的数据，输出你的分析与建议。" },
        ];
        let acc = "";
        let lastError: unknown = null;
        for (const model of modelsRef.current.slice(0, 3)) {
          let local = "";
          try {
            const stream = cloud!.llm.chat.completions.create({
              model,
              messages,
              stream: true,
              temperature: 0.3,
              signal: controller.signal,
            });
            for await (const chunk of withChunkTimeout(stream, 15_000, 12_000)) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                local += delta;
                acc = local;
                setText(acc);
              }
            }
            if (!local.trim()) throw new Error("AI_EMPTY_RESPONSE");
            lastError = null;
            break;
          } catch (err) {
            if ((err as Error).name === "AbortError") throw err;
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
        await streamFromServer(controller);
      }
    } catch (err) {
      if (stoppedRef.current) {
        // 用户主动停止：保留已生成内容
      } else if (timedOutRef.current || (err as Error).name === "AbortError") {
        setError("生成超时，已保留已生成的部分，可重试");
      } else if (canUseCloud) {
        // 云失败 → 一次服务端兜底
        cloudFailedRef.current = true;
        setFallbackNote(describeCloudError(err));
        try {
          const fb = new AbortController();
          abortRef.current = fb;
          await streamFromServer(fb);
        } catch (e2) {
          if ((e2 as Error).name === "AbortError") return;
          setError(e2 instanceof Error ? e2.message : "生成失败，请重试");
        }
      } else {
        setText("");
        setError(err instanceof Error ? err.message : "生成失败，请重试");
      }
    } finally {
      clearTimeout(timer);
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    stoppedRef.current = true;
    abortRef.current?.abort();
    setStreaming(false);
  };

  if (!hasMistakes) {
    return (
      <div className="card-in rounded-[10px] border border-line bg-surface px-5 py-8 text-center">
        <p className="font-serif text-[16px] text-ink">还没有错题</p>
        <p className="mt-2 text-[12.5px] leading-[1.8] text-ink-mute">
          答错的题目会自动进到这里。先去挑一套卷子练练手，分析才有依据。
        </p>
      </div>
    );
  }

  return (
    <div className="card-in rounded-[10px] border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h3 className="text-[13px] font-medium text-ink">AI 薄弱点分析</h3>
        {mode === "live" && (
          <span className="rounded-full bg-correct-soft px-2 py-0.5 text-[10px] text-correct">云模型已接入</span>
        )}
        {mode === "local" && (
          <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[10px] text-ink-mute">本地数据归纳</span>
        )}
      </div>

      <div className="px-5 py-4">
        {text ? (
          <div className="prose-tight text-[13.5px] leading-[1.9] text-ink-soft">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{prepareMarkdown(text)}</ReactMarkdown>
          </div>
        ) : (
          !streaming && (
            <p className="text-[12.5px] leading-[1.8] text-ink-mute">
              点击下面按钮，会读取你目前为止的错题分布（题型、易误选选项、出错最多的卷子），
              指出最突出的薄弱点，并给出几条可操作的建议。
            </p>
          )
        )}

        {streaming && !text && <p className="caret text-[12.5px] text-ink-mute">分析中</p>}

        {fallbackNote && <p className="mt-3 text-[11px] leading-[1.6] text-ink-mute">{fallbackNote}</p>}

        {error && (
          <p className="mt-3 rounded-[8px] border border-line bg-paper px-3 py-2 text-[12px] text-wrong">{error}</p>
        )}

        <div className="mt-4 flex items-center gap-3">
          {!streaming ? (
            <button
              type="button"
              onClick={run}
              className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] text-white transition-opacity hover:opacity-90"
            >
              {text ? "重新分析" : "让 AI 分析我的薄弱点"}
            </button>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
            >
              停止
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
