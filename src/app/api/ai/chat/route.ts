import { prisma } from "@/lib/prisma";
import { Errors, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { aiChatSchema } from "@/lib/validators";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfig, buildSystemPrompt, streamFromProvider, streamMock, type ChatMessage } from "@/lib/ai";
import { parseOptionAnalysis, parseParagraphs } from "@/lib/db-mappers";

/**
 * POST /api/ai/chat —— AI 答疑（流式）
 * 上下文由服务端注入：文章原文 + 题干 + 选项 + 我的选择 + 正确答案 + 解析，
 * 学生看不到这些拼装细节，AI 也不会答非所问。
 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  // 频率限制：单用户 20 次/10 分钟，防止刷额度
  const limited = rateLimit(`ai:${meId}`, { windowMs: 10 * 60_000, max: 20 });
  if (!limited.allowed) {
    return Errors.tooMany(`提问太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, aiChatSchema);

  const question = await prisma.question.findUnique({
    where: { id: body.questionId },
    include: {
      passage: {
        include: { section: { select: { paper: { select: { title: true } } } } },
      },
    },
  });
  if (!question) return Errors.notFound("这道题");

  const mine = await prisma.answer.findUnique({
    where: { userId_questionId: { userId: meId, questionId: body.questionId } },
    select: { choice: true },
  });

  // 学生没提交答案时不下发正确答案，避免直接剧透
  const revealAnswer = Boolean(mine);

  const systemPrompt = buildSystemPrompt({
    paperTitle: question.passage.section.paper.title,
    passageTitle: question.passage.title,
    paragraphs: parseParagraphs(question.passage.paragraphs),
    question: {
      id: question.id,
      number: question.number,
      stem: question.stem,
      options: JSON.parse(question.options) as { key: string; text: string }[],
      type: question.type,
    },
    myChoice: mine?.choice ?? null,
    correctAnswer: revealAnswer ? question.answer : null,
    analysis: revealAnswer ? question.analysis : null,
    optionAnalysis: revealAnswer ? parseOptionAnalysis(question.optionAnalysis) : null,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...body.messages.map<ChatMessage>((m) => ({ role: m.role, content: m.content })),
  ];

  const config = aiConfig();

  try {
    const stream = config.enabled
      ? await streamFromProvider(messages, config)
      : streamMock(messages);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-AI-Mode": config.enabled ? "live" : "mock",
        "X-AI-Model": config.enabled ? config.model : "builtin-mock",
      },
    });
  } catch (error) {
    console.error("[ai] provider error:", error);
    // 上游挂了也要给用户一个能读的回复，而不是白屏
    const fallback = streamMock(messages);
    return new Response(fallback, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-AI-Mode": "mock",
        "X-AI-Model": "builtin-mock",
      },
    });
  }
});
