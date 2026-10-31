import { prisma } from "@/lib/prisma";
import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import type { PaperSummary } from "@/lib/types";

/** 试卷列表 + 当前用户的作答进度 */
export const GET = withApi(async () => {
  const userId = await currentUserId();

  const papers = await prisma.paper.findMany({
    orderBy: [{ sort: "asc" }],
    include: {
      passages: {
        select: {
          id: true,
          _count: { select: { questions: true } },
        },
      },
    },
  });

  const answers = userId
    ? await prisma.answer.findMany({
        where: { userId },
        select: {
          isCorrect: true,
          question: { select: { passage: { select: { paperId: true } } } },
        },
      })
    : [];

  const byPaper = new Map<string, { answered: number; correct: number }>();
  for (const answer of answers) {
    const paperId = answer.question.passage.paperId;
    const stat = byPaper.get(paperId) ?? { answered: 0, correct: 0 };
    stat.answered += 1;
    if (answer.isCorrect) stat.correct += 1;
    byPaper.set(paperId, stat);
  }

  const data: PaperSummary[] = papers.map((paper) => {
    const stat = byPaper.get(paper.id) ?? { answered: 0, correct: 0 };
    return {
      id: paper.id,
      title: paper.title,
      level: paper.level,
      year: paper.year,
      month: paper.month,
      passageCount: paper.passages.length,
      questionCount: paper.passages.reduce((sum, p) => sum + p._count.questions, 0),
      answeredCount: stat.answered,
      correctCount: stat.correct,
    };
  });

  return ok(data);
});
