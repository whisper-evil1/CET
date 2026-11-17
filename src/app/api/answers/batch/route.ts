import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { batchAnswerSchema } from "@/lib/validators";
import { parseOptionAnalysis, parseEvidenceSentences } from "@/lib/db-mappers";
import { syncUserStats } from "@/lib/stats-sync";
import type { AnswerResult } from "@/lib/types";

type BatchResult = {
  results: AnswerResult[];
  correctCount: number;
  total: number;
};

/**
 * POST /api/answers/batch —— 交卷判分。
 *
 * 为什么需要它：选词填空是「一篇短文 + 10 个空 + 15 个词」的整体，段落匹配是
 * 「10 个陈述找 10 个段落」，判分天然是按篇而不是按题。逐题 POST 会造成
 * 10 次 stats 同步、10 次排行榜重算，而且中途失败会留下半套成绩。
 *
 * 这里一次取齐题目、一次事务落库、只同步一次统计；返回每一题的判分与解析，
 * 前端拿到的仍然是和单题提交完全一致的 AnswerResult。
 */
export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const body = await parseBody(request, batchAnswerSchema);

  // 同一题重复提交以最后一条为准，避免 upsert 互相覆盖
  const byQuestion = new Map<string, string>();
  for (const item of body.answers) byQuestion.set(item.questionId, item.choice);
  const ids = [...byQuestion.keys()];

  const questions = await prisma.question.findMany({
    where: { id: { in: ids } },
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
  if (questions.length === 0) return Errors.notFound("题目");

  const level = questions[0]?.passage.paper.level;

  const results: AnswerResult[] = questions.map((question) => {
    const choice = byQuestion.get(question.id) ?? "";
    return {
      questionId: question.id,
      choice,
      isCorrect: choice === question.answer,
      answer: question.answer,
      analysis: question.analysis,
      optionAnalysis: parseOptionAnalysis(question.optionAnalysis),
      evidencePara: question.evidencePara,
      evidenceText: question.evidenceText,
      evidenceSentences: parseEvidenceSentences(question.evidenceSentences),
      type: question.type,
    };
  });

  // 一次事务写完：要么整篇落库，要么一道都不落，不留半套成绩
  await prisma.$transaction(
    results.map((result) =>
      prisma.answer.upsert({
        where: { userId_questionId: { userId, questionId: result.questionId } },
        create: {
          userId,
          questionId: result.questionId,
          choice: result.choice,
          isCorrect: result.isCorrect,
          viewedAnalysis: false,
        },
        update: { choice: result.choice, isCorrect: result.isCorrect },
      }),
    ),
  );

  if (level) {
    try {
      await syncUserStats(userId, level);
    } catch (err) {
      console.error("[stats-sync]", err);
    }
  }

  const data: BatchResult = {
    results,
    correctCount: results.filter((r) => r.isCorrect).length,
    total: results.length,
  };

  return ok(data);
});
