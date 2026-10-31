import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { buildSystemPrompt } from "@/lib/ai";
import { parseOptionAnalysis, parseParagraphs } from "@/lib/db-mappers";
import { rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/questions/[id]/ai-context
 *
 * AI 答疑的上下文由服务端拼装：文章原文 + 题干 + 选项 + 我的选择 + 正确答案 + 解析，
 * 拼成一段 system prompt 返回给前端。前端拿到后直接调云服务 LLM（cloud.llm），
 * 模型请求不再经 Node 侧中转——这是云服务 SDK 的约定，也避免了在浏览器持有任何模型密钥。
 *
 * 学生没提交答案时不下发正确答案，避免直接剧透。
 */
export const GET = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  // 拉上下文也算一次提问频次，按用户限流，防止刷模型额度
  const limited = rateLimit(`ai-ctx:${meId}`, { windowMs: 10 * 60_000, max: 40 });
  if (!limited.allowed) {
    return Errors.tooMany(`提问太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const { id } = await ctx.params;

  const question = await prisma.question.findUnique({
    where: { id },
    include: {
      passage: { include: { paper: { select: { title: true } } } },
    },
  });
  if (!question) return Errors.notFound("这道题");

  const mine = await prisma.answer.findUnique({
    where: { userId_questionId: { userId: meId, questionId: id } },
    select: { choice: true },
  });
  const revealAnswer = Boolean(mine);

  const systemPrompt = buildSystemPrompt({
    paperTitle: question.passage.paper.title,
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

  return ok({ systemPrompt });
});
