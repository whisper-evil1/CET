import { prisma } from "@/lib/prisma";
import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import type { PaperSummary } from "@/lib/types";

/** 试卷列表 + 当前用户的作答进度，支持按 level 过滤 */
export const GET = withApi(async (request: Request) => {
  const userId = await currentUserId();
  const level = new URL(request.url).searchParams.get("level"); // CET4 | CET6

  const papers = await prisma.paper.findMany({
    where: level ? { level } : undefined,
    orderBy: [{ sort: "asc" }],
    include: {
      sections: {
        select: {
          id: true,
          type: true,
          passages: { select: { _count: { select: { questions: true } } } },
        },
      },
    },
  });

  // Passage 不再有 paperId，通过 section 关联查
  const answers = userId
    ? await prisma.answer.findMany({
        where: { userId },
        select: {
          isCorrect: true,
          question: {
            select: { passage: { select: { section: { select: { paperId: true } } } } },
          },
        },
      })
    : [];

  const byPaper = new Map<string, { answered: number; correct: number }>();
  for (const answer of answers) {
    const paperId = answer.question.passage.section.paperId;
    const stat = byPaper.get(paperId) ?? { answered: 0, correct: 0 };
    stat.answered += 1;
    if (answer.isCorrect) stat.correct += 1;
    byPaper.set(paperId, stat);
  }

  const data: PaperSummary[] = papers.map((paper) => {
    const stat = byPaper.get(paper.id) ?? { answered: 0, correct: 0 };
    // 统计所有 section 下的 passage 和 question 总数
    const passageCount = paper.sections.reduce(
      (sum, s) => sum + s.passages.length,
      0,
    );
    const questionCount = paper.sections.reduce(
      (sum, s) => sum + s.passages.reduce((ps, p) => ps + p._count.questions, 0),
      0,
    );
    return {
      id: paper.id,
      title: paper.title,
      level: paper.level,
      year: paper.year,
      month: paper.month,
      passageCount,
      questionCount,
      answeredCount: stat.answered,
      correctCount: stat.correct,
    };
  });

  return ok(data);
});
