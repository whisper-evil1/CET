/**
 * 云模型流式调用的公共件。
 *
 * 错题 AI 分析与写作/翻译批改都要做同样几件事：挑模型、给每个 chunk 加超时、
 * 把 SDK 抛出的错误翻译成人话。抽出来一份，两边行为才不会慢慢跑偏。
 *
 * 说明：不 import cloud，只接收模型 id 与 messages，调用方自己传 stream 工厂，
 * 这样这个文件在客户端和服务端都能安全引用。
 */

/** 给异步迭代器加超时：首块宽一些（等模型起手），之后收紧（防挂死） */
export async function* withChunkTimeout<T>(
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

/** 模型排序：优先首字快的 flash，其次 deepseek，最后才是其它 */
export function rankModels(models: ReadonlyArray<{ id: string; disabled?: boolean }>): string[] {
  const usable = models.filter((m) => m.disabled !== true && !/^(auto|default)$/i.test(m.id));
  const score = (id: string) => {
    if (/flash/i.test(id)) return 0;
    if (/^deepseek/i.test(id)) return 1;
    if (/^(kimi|glm)/i.test(id)) return 2;
    return 3;
  };
  return [...usable].sort((a, b) => score(a.id) - score(b.id)).map((m) => m.id);
}

/** 把云 SDK 的错误码翻译成学生能读懂的一句话；label 是被兜底的那条路的名称 */
export function describeCloudError(error: unknown, label = "本地兜底"): string {
  const err = error as { name?: string; message?: string; error?: { code?: string | null } };
  const code = err?.error?.code ?? "";
  if (err?.message === "AI_TIMEOUT") return `云模型超时，已切换到${label}`;
  if (err?.message === "AI_EMPTY_RESPONSE") return `云模型未出正文，已切换到${label}`;
  if (code.startsWith("auth_")) return `云服务凭证与域名不匹配，已切换到${label}`;
  if (code.startsWith("quota_")) return `云模型额度用尽，已切换到${label}`;
  if (code.startsWith("gateway_") || code.startsWith("model_")) return `云模型暂时不可用，已切换到${label}`;
  return `云模型调用失败，已切换到${label}`;
}

export type StreamFactory = (
  model: string,
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>,
) => AsyncIterable<{ choices: ReadonlyArray<{ delta?: { content?: string | null } }> }>;

/**
 * 依次尝试最多 3 个模型，逐字 yield 正文。
 *
 * 语义要点：某个模型已经吐出过正文再失败时，保留这部分内容并正常结束，
 * 不切下一个模型重来——否则用户会看到前半段凭空消失、从头再写一遍。
 * 只有「一个字都没出来」才换模型；全挂则抛出最后一个错误，交调用方兜底。
 */
export async function* streamCloudText(
  factory: StreamFactory,
  opts: {
    models: string[];
    messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
    firstMs?: number;
    nextMs?: number;
    maxModels?: number;
  },
): AsyncGenerator<string> {
  const { models, messages, firstMs = 15_000, nextMs = 12_000, maxModels = 3 } = opts;
  let lastError: unknown = null;

  for (const model of models.slice(0, maxModels)) {
    let local = "";
    try {
      for await (const chunk of withChunkTimeout(factory(model, messages), firstMs, nextMs)) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          local += delta;
          yield delta;
        }
      }
      if (!local.trim()) throw new Error("AI_EMPTY_RESPONSE");
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      if (local.trim()) return; // 已出正文：保留，不重来
      lastError = err;
    }
  }

  throw lastError ?? new Error("AI_EMPTY_RESPONSE");
}
