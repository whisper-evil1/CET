import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { parseOptionAnalysis, parseEvidenceSentences } from "@/lib/db-mappers";
import type { AnswerResult } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/questions/[id]/analysis
 * 回看解析：用于已作答的题目重新打开解析面板，同时把 viewedAnalysis 记为 true。
 */
export const GET = withApi(async (_request: Request, ctx: Ctx) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await ctx.params;

  const question = await prisma.question.findUnique({
    where: { id },
    select: {
      id: true,
      answer: true,
      analysis: true,
      optionAnalysis: true,
      evidencePara: true,
      evidenceText: true,
      evidenceSentences: true,
      type: true,
    },
  });
  if (!question) return Errors.notFound("这道题");

  const mine = await prisma.answer.findUnique({
    where: { userId_questionId: { userId, questionId: id } },
    select: { choice: true },
  });

  if (mine && !(await isViewed(userId, id))) {
    await prisma.answer.update({
      where: { userId_questionId: { userId, questionId: id } },
      data: { viewedAnalysis: true },
    });
  }

  const data: AnswerResult = {
    questionId: question.id,
    choice: mine?.choice ?? "",
    isCorrect: mine ? mine.choice === question.answer : false,
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

async function isViewed(userId: string, questionId: string): Promise<boolean> {
  const row = await prisma.answer.findUnique({
    where: { userId_questionId: { userId, questionId } },
    select: { viewedAnalysis: true },
  });
  return row?.viewedAnalysis ?? false;
}
