import { currentUserId } from "@/lib/auth";
import { Errors, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfig, streamFromProvider, streamStaticText, type ChatMessage } from "@/lib/ai";
import { getUserMistakes, buildMistakeAnalysisPrompt, buildLocalMistakeAnalysis } from "@/lib/mistakes";

/**
 * POST /api/mistakes/analyze —— 基于错题数据生成分析（流式）。
 *
 * 两条通道：
 *   1. 配了 AI_API_KEY → 真实模型（服务端）。
 *   2. 没配 → 用 buildLocalMistakeAnalysis 依据该用户真实错题数据归纳，
 *      不再是“演示模式”的通用示例，首屏即可用、零外部依赖。
 * 前端若能直连云模型（WorkBuddy cloud），会优先走云端，本接口作为兜底。
 */
export const POST = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`mistake-ai:${userId}`, { windowMs: 10 * 60_000, max: 10 });
  if (!limited.allowed) {
    return Errors.tooMany(`分析太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const { summary, mistakes } = await getUserMistakes(userId);
  const config = aiConfig();
  const systemPrompt = buildMistakeAnalysisPrompt(summary, mistakes);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "请基于上面的数据，输出你的分析与建议。" },
  ];

  try {
    const stream = config.enabled
      ? await streamFromProvider(messages, config)
      : streamStaticText(buildLocalMistakeAnalysis(summary, mistakes), { instant: true });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-AI-Mode": config.enabled ? "live" : "local",
        "X-AI-Model": config.enabled ? config.model : "local-data",
      },
    });
  } catch (error) {
    console.error("[mistake-ai] provider error:", error);
    // 上游挂了也给一份基于真实数据的分析，而不是白屏
    const fallback = streamStaticText(buildLocalMistakeAnalysis(summary, mistakes), { instant: true });
    return new Response(fallback, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-AI-Mode": "local",
        "X-AI-Model": "local-data",
      },
    });
  }
});
