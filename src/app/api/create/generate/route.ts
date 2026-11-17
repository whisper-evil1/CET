import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfig, type ChatMessage } from "@/lib/ai";
import { createGenSchema } from "@/lib/validators";
import {
  DEFAULT_NOVEL_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  buildNovelPrompt,
  buildVideoPrompt,
  offlineNovel,
  offlineVideo,
  parseNovelOutput,
  parseVideoOutput,
} from "@/lib/creation";

/**
 * POST /api/create/generate —— 创作平台的兜底生成通道。
 *
 * 为什么不是主通道：线上浏览器能直连 WorkBuddy 云模型（cloud.llm），
 * 首字更快、不占 Node 连接。前端优先走云，云不可用（本地开发 / 凭证与域名不匹配）
 * 才落到这里；这里再没有 AI_API_KEY 时才给离线骨架。
 *
 * 返回里带 mode，UI 必须如实显示「云模型 / 服务端模型 / 离线骨架」——
 * 不能让用户以为骨架是译文。
 */
export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 45_000;

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
        temperature: 0.65,
        max_tokens: 2200,
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

/**
 * 自动落库。
 *
 * 为什么放在服务端：浏览器一旦卸载组件（切页面、锁屏、切 App），
 * 前端的「生成完再保存」这一步就可能跑不到，用户回来作品库里是空的。
 * 服务端这条链路只要请求已经进来，结果就会写进去 —— 哪怕前端已经走了。
 * 客户端收到 savedId 就不再重复存一次，避免一条内容两条记录。
 */
async function autoSave(
  userId: string,
  kind: "novel" | "video",
  text: string,
  options: unknown,
  output: unknown,
): Promise<string | null> {
  try {
    const title =
      kind === "novel"
        ? String((output as { title?: string }).title ?? "未命名改编")
        : String((output as { title?: string }).title ?? "未命名短视频");
    const created = await prisma.creation.create({
      data: {
        userId,
        kind,
        title: title.slice(0, 150) || (kind === "novel" ? "未命名改编" : "未命名短视频"),
        sourceText: text,
        output: JSON.stringify(output),
        meta: JSON.stringify(options),
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // 落库失败不能吞掉生成结果：正文照常返回，客户端会再试一次保存
    console.warn("[create/generate] auto save failed:", error);
    return null;
  }
}

export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  // 生成比批改更贵（一次两三千 token），单用户 20 次/10 分钟
  const limited = rateLimit(`create-gen:${meId}`, { windowMs: 10 * 60_000, max: 20 });
  if (!limited.allowed) {
    return Errors.tooMany(`生成太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, createGenSchema);

  if (body.kind === "novel") {
    const options = body.novel ?? DEFAULT_NOVEL_OPTIONS;
    const prompt = buildNovelPrompt(body.text, options);
    const result = await chatOnce([
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ]);

    if ("text" in result) {
      const parsed = parseNovelOutput(result.text, body.text);
      if (parsed) {
        const savedId = await autoSave(meId, "novel", body.text, options, parsed);
        return ok({ mode: "server", output: parsed, note: "", savedId });
      }
      // 骨架不是真结果，不自动入库（否则作品库里会堆一堆占位内容），
      // 前端仍可用「保存」手动存
      return ok({
        mode: "offline",
        output: offlineNovel(body.text, options),
        note: "模型返回的格式没能解析，已退成结构骨架，可再试一次",
        savedId: null,
      });
    }
    return ok({
      mode: "offline",
      output: offlineNovel(body.text, options),
      note: result.error,
      savedId: null,
    });
  }

  const options = body.video ?? DEFAULT_VIDEO_OPTIONS;
  const prompt = buildVideoPrompt(body.text, options);
  const result = await chatOnce([
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ]);

  if ("text" in result) {
    const parsed = parseVideoOutput(result.text, options);
    if (parsed) {
      const savedId = await autoSave(meId, "video", body.text, options, parsed);
      return ok({ mode: "server", output: parsed, note: "", savedId });
    }
    return ok({
      mode: "offline",
      output: offlineVideo(body.text, options),
      note: "模型返回的格式没能解析，已退成结构骨架，可再试一次",
      savedId: null,
    });
  }
  return ok({
    mode: "offline",
    output: offlineVideo(body.text, options),
    note: result.error,
    savedId: null,
  });
});
