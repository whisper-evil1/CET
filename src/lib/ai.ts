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

export async function streamFromProvider(
  messages: ChatMessage[],
  config: AiConfig,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  });

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
          const { done, value } = await reader.read();
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
          encoder.encode(`\n\n> 连接中断：${error instanceof Error ? error.message : "未知错误"}`),
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

  return `**当前是演示模式**：还没有配置 AI Key，所以下面是内置的示例讲解；在 \`.env\` 里填上 \`AI_API_KEY\` 之后，这里会换成 ${"DeepSeek"} 的真实回答。

你问的是「${ask}${lastUser.length > 40 ? "…" : ""}」，按这个思路走：

1. **先回到题干定位关键词**：把题干里的人名、时间、专有名词当路标，回到原文扫一遍，找到同一段。
2. **再看原文那句的主干**：四六级阅读的错误选项，多数是把原文某句话的主语、范围或程度偷偷换掉。
3. **逐项排除**：把四个选项和原文原句摆在一起对照，只要有一处跟原文不符，就可以直接划掉。

> 提示：点开题目下方的「答案与解析」，每条错项都写了具体错在哪个词，可以对照着看。

配置好 Key 后，我就能结合这篇文章和这道题，逐句给你讲清楚。`;
}

export function streamMock(messages: ChatMessage[]): ReadableStream<Uint8Array> {
  const text = mockAnswer(messages);
  const encoder = new TextEncoder();
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
