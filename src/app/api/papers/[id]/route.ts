import { prisma } from "@/lib/prisma";
import { Errors, withApi, ok } from "@/lib/api-helpers";
import { parseOptions, parseParagraphs, parseTranscript } from "@/lib/db-mappers";
import type { PracticePaper, SectionType } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 试卷详情：返回完整题目结构，但只带题干与选项，不带 answer / analysis。
 * v1 数据是 Paper→Passage→Question，没有 Section 层级，
 * 这里把所有 passage 包装进一个 reading section，保持 PracticePaper 的 sections 结构兼容前端。
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
    sections: [
      {
        id: `reading-${paper.id}`,
        order: 0,
        type: "reading" as SectionType,
        title: "阅读",
        timeLimit: null,
        passages: paper.passages.map((passage) => ({
          id: passage.id,
          order: passage.order,
          title: passage.title,
          paragraphs: parseParagraphs(passage.paragraphs),
          audioUrl: passage.audioUrl,
          audioDuration: passage.audioDuration,
          transcript: parseTranscript(passage.transcript),
          questions: passage.questions.map((question) => ({
            id: question.id,
            number: question.number,
            stem: question.stem,
            options: parseOptions(question.options),
            type: question.type,
          })),
        })),
      },
    ],
  };

  return ok(data);
});
