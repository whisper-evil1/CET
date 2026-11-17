import { z } from "zod";
import { ok, withApi } from "@/lib/api-helpers";
import { aiConfig, type ChatMessage } from "@/lib/ai";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildStoryPrompt,
  injectGlosses,
  offlineStory,
  shortGloss,
  validateMarked,
  type StoryWord,
} from "@/lib/word-story";

/**
 * POST /api/vocab/story —— 把一批单词串成英文故事（对照参考图的产品形态）。
 *
 * 请求：{ words: [{ word, zh }] }（4–16 个）
 * 返回：{ story, mode: "ai" | "offline", note? }
 *   story 是规范化格式：目标词写成 **word**（中文释义），其余纯英文。
 *
 * AI 不可用 / 格式不合规时退离线句架串联（词按序进故事、带释义标记），
 * mode 如实返回，前端不当成 AI 成果展示。
 */

export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 40_000;

const bodySchema = z.object({
  words: z
    .array(
      z.object({
        word: z.string().trim().min(1).max(48),
        zh: z.string().trim().min(1).max(120),
      }),
    )
    .min(4)
    .max(16),
});

type ProviderResult = { text: string } | { error: string };

async function chatOnce(messages: ChatMessage[]): Promise<ProviderResult> {
  const config = aiConfig();
  if (!config.enabled) return { error: "未配置模型" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { error: `模型接口返回 ${response.status}: ${detail.slice(0, 160)}` };
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return { error: "模型未返回正文" };
    return { text };
  } catch (error) {
    const msg =
      error instanceof Error && error.name === "AbortError"
        ? "模型响应超时"
        : `模型调用失败：${error instanceof Error ? error.message : "未知错误"}`;
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export const POST = withApi(async (request: Request) => {
  // 串故事一次一两千 token，限频防刷
  const limited = rateLimit("word-story", { windowMs: 10 * 60_000, max: 30 });
  if (!limited.allowed) {
    return ok(
      { story: null, mode: "offline", note: `生成太频繁了，${limited.retryAfterSec} 秒后再试` },
      "throttled",
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return ok({ story: null, mode: "offline", note: "参数不对：需要 4–16 个单词" }, "bad_request");
  }

  const words: StoryWord[] = parsed.data.words.map((item) => ({
    word: item.word,
    // 只用最短提示义项，长串释义塞进英文句子会读断（完整释义在词表里）
    zh: shortGloss(item.zh) || item.zh,
  }));

  const result = await chatOnce([
    {
      role: "system",
      content:
        "你是英语词汇故事写手，专为中国大学生（四六级水平）把单词串成便于记忆的英文小故事。严格按用户给的顺序用词，每个词只用一次，输出格式必须符合要求。",
    },
    { role: "user", content: buildStoryPrompt(words) },
  ]);

  if ("text" in result) {
    const marked = result.text.trim();
    if (validateMarked(marked, words)) {
      return ok({ story: injectGlosses(marked, words), mode: "ai", note: "" });
    }
    // 格式不合规（漏词/乱序/没打星号）：退离线串联，保证词和释义都对
    return ok({
      story: offlineStory(words),
      mode: "offline",
      note: "AI 返回的用词不完整或没按词序，已退成句架串联，可再试一次",
    });
  }

  return ok({ story: offlineStory(words), mode: "offline", note: friendlyNote(result.error) });
});

/** 把内部错误翻成用户能看懂的一句话（别把「未配置模型」这种实现细节露在界面上） */
function friendlyNote(reason: string): string {
  if (/未配置模型/.test(reason)) return "AI 还没接入，先用句架把词按序串起来，接上模型后故事会更自然。";
  if (/超时/.test(reason)) return "AI 响应超时了，先用句架兜底，等一下可以再点「换一组词重串」。";
  return "AI 暂时不可用，先用句架兜底串词，稍后再试一次。";
}
