import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { answerSchema } from "@/lib/validators";
import { parseOptionAnalysis } from "@/lib/db-mappers";
import type { AnswerResult } from "@/lib/types";



/** GET /api/answers?paperId=xxx —— 恢复该试卷下我的作答状态 */
export const GET = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const paperId = new URL(request.url).searchParams.get("paperId");
  if (!paperId) return Errors.badRequest("缺少 paperId");

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

/** POST /api/answers —— 提交答案，返回判题结果与解析（解析由此才下发） */
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
      type: true,
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
      // 同一题重做时，解析是否看过要按本轮重新计
      viewedAnalysis: false,
    },
    update: {
      choice: body.choice,
      isCorrect,
    },
  });

  const data: AnswerResult = {
    questionId: question.id,
    choice: body.choice,
    isCorrect,
    answer: question.answer,
    analysis: question.analysis,
    optionAnalysis: parseOptionAnalysis(question.optionAnalysis),
    evidencePara: question.evidencePara,
    evidenceText: question.evidenceText,
    type: question.type,
  };

  return ok(data);
});
