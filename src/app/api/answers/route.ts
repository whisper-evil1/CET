import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { answerSchema } from "@/lib/validators";
import { parseOptionAnalysis, parseEvidenceSentences } from "@/lib/db-mappers";
import { syncUserStats } from "@/lib/stats-sync";
import type { AnswerResult } from "@/lib/types";

/** GET /api/answers?paperId=xxx —— 恢复该试卷下我的作答状态 */
export const GET = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const paperId = new URL(request.url).searchParams.get("paperId");
  if (!paperId) return Errors.badRequest("缺少 paperId");

  // Passage.paperId 是必填外键（v2.0 增量迁移保留），sectionId 可选。
  // 按 paperId 过滤：既覆盖有 section 的新数据，也覆盖 sectionId 为空的老数据，避免漏查。
  const answers = await prisma.answer.findMany({
    where: { userId, question: { passage: { paperId } } },
    select: {
      questionId: true,
      choice: true,
      isCorrect: true,
      viewedAnalysis: true,
    },
  });

  return ok(answers);
});

/** POST /api/answers —— 提交答案，返回判题结果与解析 */
export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const body = await parseBody(request, answerSchema);

  const question = await prisma.question.findUnique({
    where: { id: body.questionId },
    select: {
      id: true,
      answer: true,
      analysis: true,
      optionAnalysis: true,
      evidencePara: true,
      evidenceText: true,
      evidenceSentences: true,
      type: true,
      passage: { select: { paper: { select: { level: true } } } },
    },
  });
  if (!question) return Errors.notFound("这道题");

  const isCorrect = body.choice === question.answer;

  await prisma.answer.upsert({
    where: { userId_questionId: { userId, questionId: question.id } },
    create: {
      userId,
      questionId: question.id,
      choice: body.choice,
      isCorrect,
      viewedAnalysis: false,
    },
    update: {
      choice: body.choice,
      isCorrect,
    },
  });

  // 同步排行榜统计与打卡，失败不影响答题结果返回
  try {
    await syncUserStats(userId, question.passage.paper.level);
  } catch (err) {
    console.error("[stats-sync]", err);
  }

  const data: AnswerResult = {
    questionId: question.id,
    choice: body.choice,
    isCorrect,
    answer: question.answer,
    analysis: question.analysis,
    optionAnalysis: parseOptionAnalysis(question.optionAnalysis),
    evidencePara: question.evidencePara,
    evidenceText: question.evidenceText,
    evidenceSentences: parseEvidenceSentences(question.evidenceSentences),
    type: question.type,
  };

  return ok(data);
});
