import { prisma } from "@/lib/prisma";
import { Errors, withApi, ok } from "@/lib/api-helpers";
import { parseOptions, parseParagraphs, parseTranscript } from "@/lib/db-mappers";
import type { PracticePaper, SectionType } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 试卷详情：返回完整 Section 结构，但只带题干与选项，不带 answer / analysis。
 * 听力 passage 会额外返回 audioUrl 和 transcript（原文逐句）。
 */
export const GET = withApi(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;

  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          passages: {
            orderBy: { order: "asc" },
            include: { questions: { orderBy: { order: "asc" } } },
          },
        },
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
    totalTime: paper.totalTime,
    sections: paper.sections.map((section) => ({
      id: section.id,
      order: section.order,
      type: section.type as SectionType,
      title: section.title,
      timeLimit: section.timeLimit,
      passages: section.passages.map((passage) => ({
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
    })),
  };

  return ok(data);
});
