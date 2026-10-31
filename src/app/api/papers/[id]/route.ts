import { prisma } from "@/lib/prisma";
import { Errors, withApi, ok } from "@/lib/api-helpers";
import { parseOptions, parseParagraphs } from "@/lib/db-mappers";
import type { PracticePaper } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 试卷详情：只返回题干与选项，不带 answer / analysis。
 * 答案与解析必须通过提交答案的接口换取，避免答案出现在首屏 payload 里。
 */
export const GET = withApi(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;

  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      passages: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!paper) return Errors.notFound("这套试卷");

  const data: PracticePaper = {
    id: paper.id,
    title: paper.title,
    level: paper.level,
    year: paper.year,
    month: paper.month,
    passages: paper.passages.map((passage) => ({
      id: passage.id,
      order: passage.order,
      title: passage.title,
      paragraphs: parseParagraphs(passage.paragraphs),
      questions: passage.questions.map((question) => ({
        id: question.id,
        number: question.number,
        stem: question.stem,
        options: parseOptions(question.options),
        type: question.type,
      })),
    })),
  };

  return ok(data);
});
