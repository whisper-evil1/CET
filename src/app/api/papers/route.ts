import { prisma } from "@/lib/prisma";
import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import type { PaperSummary } from "@/lib/types";

/** 试卷列表 + 当前用户的作答进度，支持按 level 过滤；status=ready 只返回正文齐备的卷 */
export const GET = withApi(async (request: Request) => {
  const userId = await currentUserId();
  const params = new URL(request.url).searchParams;
  const level = params.get("level"); // CET4 | CET6
  const status = params.get("status"); // ready | draft

  const papers = await prisma.paper.findMany({
    where: {
      hidden: false,
      ...(level ? { level } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ sort: "asc" }],
    include: {
      passages: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          _count: { select: { questions: true } },
        },
      },
    },
  });

  // 作答进度：通过 passage.paperId 反查试卷
  const answers = userId
    ? await prisma.answer.findMany({
        where: { userId },
        select: {
          isCorrect: true,
          question: {
            select: { passage: { select: { paperId: true } } },
          },
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
    const passageCount = paper.passages.length;
    const questionCount = paper.passages.reduce(
      (sum, p) => sum + p._count.questions,
      0,
    );
    return {
      id: paper.id,
      title: paper.title,
      level: paper.level,
      year: paper.year,
      month: paper.month,
      setNo: paper.setNo,
      origin: paper.origin,
      status: paper.status,
      passageCount,
      questionCount,
      answeredCount: stat.answered,
      correctCount: stat.correct,
    };
  });

  return ok(data);
});
