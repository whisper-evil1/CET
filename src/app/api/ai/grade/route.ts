import { prisma } from "@/lib/prisma";
import { Errors, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { aiGradeSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfig, streamFromProvider, streamStaticText, type ChatMessage } from "@/lib/ai";
import { buildGradePrompt, buildLocalReview, type GradeType } from "@/lib/writing-grade";

/**
 * POST /api/ai/grade —— 写作 / 翻译批改（流式）。
 *
 * 为什么单独开一个接口：原来写作/翻译复用了阅读答疑的 /api/ai/chat，
 * 那个接口注入的是「阅读老师讲这篇阅读」的系统提示词，没配 Key 时还会吐
 * 「回原文扫一遍找到同一段」这类阅读技巧——对翻译题完全是答非所问。
 *
 * 两条通道：
 *   1. 配了 AI_API_KEY → 真实模型，按阅卷老师的要求批改。
 *   2. 没配 → buildLocalReview 依据学生真实作答逐项检查（字数、句长、衔接词、
 *      中文标点、数字与术语覆盖、模板套话），给分并指出具体句子，
 *      首屏即可用、零外部依赖，不再出现「演示模式」这种话。
 *
 * 前端若能直连云模型（WorkBuddy cloud），会优先走云端，本接口作为兜底。
 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  // 批改比答疑更耗额度，单用户 15 次/10 分钟
  const limited = rateLimit(`ai-grade:${meId}`, { windowMs: 10 * 60_000, max: 15 });
  if (!limited.allowed) {
    return Errors.tooMany(`批改太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, aiGradeSchema);

  const question = await prisma.question.findUnique({
    where: { id: body.questionId },
    select: {
      id: true,
      type: true,
      stem: true,
      analysis: true,
      passage: { select: { paper: { select: { title: true, level: true } } } },
    },
  });
  if (!question) return Errors.notFound("这道题");

  if (question.type !== "writing" && question.type !== "translation") {
    return Errors.badRequest("这道题不是写作或翻译，请使用题目下方的 AI 答疑");
  }

  const type = question.type as GradeType;
  const input = {
    type,
    stem: question.stem,
    // 写作/翻译的参考范文、参考译文存在 analysis 字段
    reference: question.analysis,
    answer: body.answer,
    paperTitle: question.passage.paper.title,
    level: question.passage.paper.level,
  };

  const config = aiConfig();
  const messages: ChatMessage[] = [
    { role: "system", content: buildGradePrompt(input) },
    { role: "user", content: `这是我的${type === "translation" ? "译文" : "作文"}，请批改：\n\n${body.answer}` },
  ];

  const headers = (mode: string, model: string) => ({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-AI-Mode": mode,
    "X-AI-Model": model,
  });

  try {
    const stream = config.enabled
      ? await streamFromProvider(messages, config)
      : streamStaticText(buildLocalReview(input), { instant: true });
    return new Response(stream, {
      headers: headers(config.enabled ? "live" : "local", config.enabled ? config.model : "local-rule"),
    });
  } catch (error) {
    console.error("[ai-grade] provider error:", error);
    // 上游挂了也要给一份逐项检查过的批改，而不是白屏或通用套话
    return new Response(streamStaticText(buildLocalReview(input), { instant: true }), {
      headers: headers("local", "local-rule"),
    });
  }
});
