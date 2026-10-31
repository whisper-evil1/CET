import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";

/** GET /api/favorites —— 我的收藏，按试卷分组 */
export const GET = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const rows = await prisma.favorite.findMany({
    where: { userId: meId },
    orderBy: { createdAt: "desc" },
    include: {
      question: {
        select: {
          id: true,
          number: true,
          stem: true,
          type: true,
          passage: {
            select: {
              id: true,
              title: true,
              order: true,
              paper: { select: { id: true, title: true, level: true } },
            },
          },
        },
      },
    },
  });

  const groups = new Map<
    string,
    {
      paperId: string;
      paperTitle: string;
      level: string;
      items: {
        questionId: string;
        number: number;
        stem: string;
        type: string | null;
        passageTitle: string | null;
        createdAt: string;
      }[];
    }
  >();

  for (const row of rows) {
    const paper = row.question.passage.paper;
    const group = groups.get(paper.id) ?? {
      paperId: paper.id,
      paperTitle: paper.title,
      level: paper.level,
      items: [],
    };
    group.items.push({
      questionId: row.question.id,
      number: row.question.number,
      stem: row.question.stem,
      type: row.question.type,
      passageTitle: row.question.passage.title,
      createdAt: row.createdAt.toISOString(),
    });
    groups.set(paper.id, group);
  }

  return ok([...groups.values()]);
});
