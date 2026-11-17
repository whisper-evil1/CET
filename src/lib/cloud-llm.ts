/**
 * 云端 LLM 的共享调用层。
 *
 * 为什么单独抽出来：
 *   阅读/听力的 AI 答疑（ai-drawer）和写作/翻译的 AI 批改（writing-translation-pane）
 *   用的是同一个云服务 LLM，但后者原先只调服务端的 /api/ai/chat —— 那条路要自备
 *   AI_API_KEY，没配就永远是「演示模式」。把调用集中到这里后，两处走同一条真模型通道。
 *
 * 三个必须保留的工程约束（都是踩过坑换来的）：
 *   1. 路由别名（auto / default）返回 200 却不吐正文，必须排除，flash 系优先；
 *   2. 单个模型失败要能自动换下一个，但一旦已经吐过字就不能换（否则前半段答案被冲掉）；
 *   3. 流式迭代要自带超时竞速，不能只靠 AbortSignal —— SDK 未必把 signal 接到 socket 上，
 *      那样界面会永久停在「思考中」。
 */
import { cloud, cloudReady } from "./cloud";

export type CloudChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * 给异步迭代器加「不依赖底层实现」的超时：对每次 next() 竞速一个定时器。
 * 首字给 firstMs、后续给 nextMs，超时直接抛 AI_TIMEOUT，由调用方决定回退还是报错。
 */
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
 * 云端模型可用性排序。
 *
 * 依据 2026-11-01 对线上账号的实测（同一 prompt、同一直连）：
 *   deepseek-v4.1-flash  首字 958ms   ✅   deepseek-v4-flash 1162ms ✅
 *   kimi-k2.5            首字 1288ms  ✅   glm-5.3-flash     1359ms ✅
 *   kimi-k3-1            4584ms（带思考）✅  hy3 11429ms（思考 1456 字，体感像卡住）
 *   auto / default       200 但 30s 无正文 ❌（路由别名）
 *   hy4-preview          30s 无正文    ❌   minimax-m2.5 / glm-4.x / glm-5.x  400 ❌
 */
export function rankModels(
  models: ReadonlyArray<{ id: string; disabled?: boolean }>,
): string[] {
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
 * 把云服务错误翻译成一句中性短语（不含「已切到…」这类结论），
 * 由调用方拼成完整提示 —— 答疑叫「演示回答」，批改叫「备用通道」，措辞不同。
 */
export function describeCloudError(error: unknown): string {
  const err = error as { name?: string; message?: string; error?: { code?: string | null } };
  const code = err?.error?.code ?? "";

  if (err?.message === "AI_TIMEOUT") return "云端模型响应超时";
  if (err?.message === "AI_EMPTY_RESPONSE") return "云端模型只思考不出正文";
  if (code.startsWith("auth_")) return "云服务凭证与当前域名不匹配";
  if (code.startsWith("quota_")) return "云模型额度已用尽或被限流";
  if (code.startsWith("request_")) return "云模型不接受本次请求参数";
  if (code.startsWith("gateway_") || code.startsWith("model_")) return "云模型暂时不可用";
  if (code.startsWith("internal_")) return "云服务内部错误";
  if (err?.message === "CLOUD_NO_MODEL") return "没有取到可用模型";
  if (err?.message === "CLOUD_NOT_CONFIGURED") return "云服务未配置";
  return err?.message ? `云模型调用失败：${err.message}` : "云模型调用失败";
}

/** 模型列表缓存（10 分钟内不重复拉，避免每次开抽屉都打一次云） */
const MODELS_TTL_MS = 10 * 60 * 1000;
let cachedModels: string[] = [];
let cachedAt = 0;

/** 云服务是否配置可用 */
export function isCloudAvailable(): boolean {
  return Boolean(cloudReady && cloud);
}

/**
 * 取候选模型 id 列表（按可用性排序）。拿不到时返回空数组。
 * 不抛错：调用方拿到空数组就自动走服务端回退。
 */
export async function getCloudModels(force = false): Promise<string[]> {
  if (!isCloudAvailable()) return [];
  if (!force && cachedModels.length > 0 && Date.now() - cachedAt < MODELS_TTL_MS) {
    return cachedModels;
  }
  try {
    const models = await cloud!.llm.models.list();
    const ranked = rankModels(models);
    // 线上排查用：账号实际开了哪些模型，直接看控制台就知道有几个候选
    console.log(`[cloud-llm] 模型列表 ${models.length} 个 → 可用 ${ranked.length} 个`, ranked.join(", "));
    if (ranked.length > 0) {
      cachedModels = ranked;
      cachedAt = Date.now();
    }
    return ranked;
  } catch (err) {
    console.log("[cloud-llm] 拉模型列表失败", (err as Error)?.message);
    return cachedModels;
  }
}

export type StreamCloudOptions = {
  /** 服务端拼好的 system prompt（含文章/题目上下文）；写作批改可传一条简短的角色说明 */
  systemPrompt: string;
  /** 对话历史，最后一条是本次用户输入 */
  messages: CloudChatMessage[];
  /** 每收到一段正文回调一次，参数是累计全文（便于直接 setState） */
  onDelta: (accumulated: string) => void;
  /** 用户主动中断 */
  signal?: AbortSignal;
  temperature?: number;
  /** 首字超时：单次尝试里「一个正文增量都没收到」的最长等待，默认 12 秒 */
  attemptTimeoutMs?: number;
  /** 断流超时：首个增量之后，相邻两个增量之间的最长间隔，默认 15 秒 */
  chunkTimeoutMs?: number;
};

/**
 * 走云端 LLM 做流式对话。成功即返回累计全文；失败抛错（由调用方决定回退或提示）。
 * 内部最多尝试 3 个候选模型；任一模型吐过正文就不再换，避免答案被冲掉。
 *
 * 三层超时，各管一段，缺一个都会出问题：
 *   1. 首字护栏（attemptTimeoutMs）：只统计「一个字都还没来」的时间。云端在 Origin
 *      不匹配、网关异常时会「收了请求一直不回」，此时连可迭代对象都拿不到，
 *      withChunkTimeout 根本没机会启动，只有这层能兜住。**首字一到就撤销**，
 *      否则正常的长回答会被腰斩（这是上一版的真实缺陷）。
 *   2. 断流超时（chunkTimeoutMs，内层 withChunkTimeout）：流建立了但中途卡住。
 *   3. 用户中断（signal）：立即生效，且换模型时会把上一个残留的流 abort 掉。
 *
 * 时间取值依据：实测可用模型首字 958ms～4.6s，线上冷启动会到 8s 以上，
 * 所以首字给 12 秒；最坏情况（3 个候选都拿不到首字）约 36 秒回退到备用通道。
 */
export async function streamCloudChat(options: StreamCloudOptions): Promise<string> {
  const {
    systemPrompt,
    messages,
    onDelta,
    signal,
    temperature = 0.3,
    attemptTimeoutMs = 12000,
    chunkTimeoutMs = 15000,
  } = options;

  if (!isCloudAvailable()) throw new Error("CLOUD_NOT_CONFIGURED");
  if (!systemPrompt.trim()) throw new Error("CLOUD_NO_CONTEXT");

  const models = await getCloudModels();
  if (models.length === 0) throw new Error("CLOUD_NO_MODEL");

  const payload: CloudChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  let lastError: unknown = null;

  const candidates = models.slice(0, 3);
  console.log("[cloud-llm] 候选模型", candidates.join(", "));

  for (const model of candidates) {
    let local = "";
    // 每次尝试一个独立中断器：换模型时立刻掐掉上一个还挂着的流，
    // 否则旧流后到的增量会把新模型的答案冲掉
    const attempt = new AbortController();
    const forwardAbort = () => attempt.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });

    // 「首字护栏」：只有在**一个字都还没吐**的时候才计时。
    // 一旦首字到达就撤掉，让长回答正常流完 —— 早期版本把护栏套在整个流上，
    // 于是任何超过 attemptTimeoutMs 的正常回答都会被腰斩。
    let guardTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelGuard = () => {
      if (guardTimer) {
        clearTimeout(guardTimer);
        guardTimer = undefined;
      }
    };

    try {
      console.log("[cloud-llm] 尝试模型", model);
      const consume = (async () => {
        const stream = cloud!.llm.chat.completions.create({
          model,
          messages: payload,
          stream: true,
          temperature,
          signal: attempt.signal,
        });
        console.log("[cloud-llm] create 已返回", model, typeof stream, Boolean(stream));

        for await (const chunk of withChunkTimeout(stream, attemptTimeoutMs, chunkTimeoutMs)) {
          // 这个流已经被换掉（上一次尝试的残留），它的增量不能再往上写
          if (attempt.signal.aborted) return local;
          // 标准 SSE：正文只从 delta.content 来，推理模型的 reasoning_content 不计入
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            cancelGuard();
            local += delta;
            onDelta(local);
          }
        }
        return local;
      })();

      const guard = new Promise<never>((_, reject) => {
        guardTimer = setTimeout(() => reject(new Error("AI_TIMEOUT")), attemptTimeoutMs);
      });
      // 首字正常到达后 guard 会被撤销，这里的 reject 就永远不会发生，
      // 但 promise 本身还挂着，加个空 catch 免得变成未处理拒绝
      guard.catch(() => {});

      const acc = await Promise.race([consume, guard]);
      cancelGuard();
      console.log("[cloud-llm] 模型完成", model, "长度", acc.length);

      if (!acc.trim()) throw new Error("AI_EMPTY_RESPONSE");
      return acc;
    } catch (err) {
      cancelGuard();
      console.log("[cloud-llm] 模型失败", model, (err as Error)?.name, (err as Error)?.message);
      // 掐掉这次尝试残留的流，避免它在后台继续占着连接
      if (!attempt.signal.aborted) attempt.abort();
      const aborted = signal?.aborted || (err as Error).name === "AbortError";
      if (aborted) throw err;
      // 已经吐过字就别换模型了，否则会把前半段答案冲掉
      if (local.trim()) return local;
      lastError = err;
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  console.log("[cloud-llm] 全部模型失败", lastError);
  throw lastError ?? new Error("CLOUD_ALL_MODELS_FAILED");
}
