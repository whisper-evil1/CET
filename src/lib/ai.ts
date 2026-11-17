import type { PracticeQuestion } from "./types";

/**
 * AI 答疑：OpenAI 兼容协议，默认 DeepSeek。
 * 换厂商只改 .env 三行：AI_BASE_URL / AI_MODEL / AI_API_KEY。
 * 没有配置 Key 时走 mock 流式（保证交互和演示可用，绝不白屏）。
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  dashscope: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  moonshot: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
};

export type AiConfig = {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export function aiConfig(): AiConfig {
  const provider = (process.env.AI_PROVIDER ?? "deepseek").toLowerCase();
  const preset = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.deepseek;
  const apiKey = process.env.AI_API_KEY?.trim() ?? "";
  return {
    enabled: apiKey.length > 0,
    provider,
    baseUrl: process.env.AI_BASE_URL?.trim() || preset.baseUrl,
    model: process.env.AI_MODEL?.trim() || preset.model,
    apiKey,
  };
}

/* ---------------- 上下文注入 ---------------- */

export type AiContextInput = {
  paperTitle: string;
  passageTitle: string | null;
  paragraphs: { label: string; text: string }[];
  question: PracticeQuestion;
  myChoice: string | null;
  correctAnswer: string | null;
  analysis: string | null;
  optionAnalysis: Record<string, string> | null;
};

export function buildSystemPrompt(ctx: AiContextInput): string {
  const article = ctx.paragraphs.map((p) => `[${p.label}] ${p.text}`).join("\n\n");
  const options = ctx.question.options.map((o) => `${o.key}. ${o.text}`).join("\n");
  const optionAnalysis = ctx.optionAnalysis
    ? Object.entries(ctx.optionAnalysis)
        .map(([k, v]) => `${k}. ${v}`)
        .join("\n")
    : "（暂无逐项分析）";

  return `你是一位耐心的四六级英语阅读老师，正在一对一辅导学生。请始终基于下面这篇【文章】和【当前题目】作答，不要编造文章里没有的信息。

【文章标题】${ctx.passageTitle ?? ctx.paperTitle}
【文章原文】
${article}

【当前题目】第 ${ctx.question.number} 题 ${ctx.question.stem}
${options}

【学生的选择】${ctx.myChoice ? `${ctx.myChoice}` : "还未作答"}
【正确答案】${ctx.correctAnswer ?? "（学生尚未提交，先不要直接公布答案，引导他定位原文）"}
【官方解析】${ctx.analysis ?? "（无）"}
【逐项分析】
${optionAnalysis}

回答要求：
1. 用中文解释，必要时引用英文原句，并标注它来自哪一段（如 [C]）。
2. 讲"为什么"，不要只给结论；如果学生问某个选项错在哪，要指出它偷换了原文的哪个词或逻辑。
3. 篇幅控制在 200 字以内，除非学生要求详细展开。
4. 不要使用一级标题，不使用表格。`;
}

/* ---------------- 流式：真实模型 ---------------- */

/** 连接超时（建立连接阶段），默认 20s */
const CONNECTION_TIMEOUT_MS = Number(process.env.AI_CONNECT_TIMEOUT_MS ?? "20000");
/** 每个数据块之间的最大间隔，默认 12s（上游连上但迟迟不吐字时触发） */
const CHUNK_TIMEOUT_MS = Number(process.env.AI_CHUNK_TIMEOUT_MS ?? "12000");

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function streamFromProvider(
  messages: ChatMessage[],
  config: AiConfig,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          temperature: 0.3,
          max_tokens: 900,
        }),
      },
      CONNECTION_TIMEOUT_MS,
    );
  } catch (error) {
    const msg =
      error instanceof Error && error.name === "AbortError"
        ? "模型接口连接超时"
        : `模型接口连接失败：${error instanceof Error ? error.message : "未知错误"}`;
    throw new Error(msg);
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`模型接口返回 ${response.status}: ${detail.slice(0, 200)}`);
  }

  const upstream = response.body;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // 把上游 SSE 转换成纯文本流，前端只管 append，不用解析协议
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      try {
        while (true) {
          // 每个 chunk 之间加超时，避免上游连上后一直不吐字把连接挂死
          const timer = setTimeout(() => reader.cancel("chunk-timeout"), CHUNK_TIMEOUT_MS);
          const { done, value } = await reader.read();
          clearTimeout(timer);
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: { delta?: { content?: string } }[];
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // 上游偶发心跳/注释行，忽略即可
            }
          }
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `\n\n> 连接中断：${error instanceof Error ? error.message : "未知错误"}，已切换为内置讲解。`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
}

/* ---------------- 流式：无 Key 时的模拟回答 ---------------- */

function mockAnswer(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const ask = lastUser.slice(0, 40);
  const wantsProductive = /批改|评分|打分|作文|写作|翻译|译文|范文/.test(lastUser);

  const head = `> 这次没能连上云端模型，下面是内置的通用讲解（换个网络再点一次通常就好了）。

你问的是「${ask}${lastUser.length > 40 ? "…" : ""}」。
`;

  if (wantsProductive) {
    return `${head}
**写作 / 翻译这类题的采分点**

1. **主干先立稳**：每个句子先确定主语和谓语，再把定语、状语挂上去。中文习惯把修饰堆在前面，直译过去最容易缺谓语。
2. **时态统一**：一段话里不要今天用过去时、明天用现在时。中文没有时态标记，这一步最容易丢分。
3. **数字、年代、专有名词必须落地**：题目里出现的数据、人名、地名一个都不能漏，这是硬采分点。
4. **标点换半角**：中文的，。；：出现在英文里会被直接判错。
5. **别用大词**：写不准的长难句不如写对的两三个短句，准确性优先于花哨。

想要逐句批改，回到写作/翻译页面点「AI 批改」，那里会按 15 分制给分并指出具体句子。`;
  }

  return `${head}
**阅读题按这个顺序走**

1. **先看题干定位关键词**：把题干里的人名、时间、专有名词当路标，回原文扫一遍，找到同一段。
2. **再看原文那句的主干**：四六级阅读的错误选项，多数是把原文某句话的主语、范围或程度偷偷换掉。
3. **逐项排除**：把四个选项和原文原句摆在一起对照，只要有一处跟原文不符，就可以直接划掉。

> 提示：提交答案后，题目下方会出现「答案与解析」，每条错项都写了具体错在哪个词。`;
}

export function streamMock(messages: ChatMessage[]): ReadableStream<Uint8Array> {
  return streamStaticText(mockAnswer(messages));
}

/**
 * 把一段固定文本按打字机节奏流式吐出。
 *
 * instant: 本地已经算好的内容（规则批改、数据归纳）用这个模式——整段一次吐出。
 * 这些内容是同步算出来的，再按 15-35ms/片滴出去，几百字就要白等七八秒，
 * 属于人为制造的延迟。只有真的要模拟"模型在生成"时才用默认节奏。
 */
export function streamStaticText(
  text: string,
  options: { instant?: boolean } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  if (options.instant) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= text.length) {
        controller.close();
        return;
      }
      const step = 2 + Math.floor(Math.random() * 3);
      const chunk = text.slice(index, index + step);
      index += step;
      controller.enqueue(encoder.encode(chunk));
      // 打字机节奏：15-35ms/片，模拟真实首字延迟之外的稳定输出
      await new Promise((resolve) => setTimeout(resolve, 15 + Math.random() * 20));
    },
  });
}
