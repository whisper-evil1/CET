import { prisma } from "@/lib/prisma";
import { Errors, withApi, ok } from "@/lib/api-helpers";
import { parseOptions, parseParagraphs, parseTranscript } from "@/lib/db-mappers";
import type { PracticePaper, SectionType } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 试卷详情：返回完整题目结构，但只带题干与选项，不带 answer / analysis。
 *
 * 与刷题页同一套取数规则：有真实 Section 层级（v2.0 起导入的卷）就用 Section，
 * 老数据（Paper→Passage 直接挂）包装成一个 reading section 保持结构兼容。
 * 之前这里只读 paper.passages，把 Section 类型丢了，闯关就没法区分
 * Section A/B/C 与写作、翻译，只能靠「有没有选项」猜。
 *
 * draft 卷（结构已建、正文待补）一律按不存在处理：放进闯关就是一张空题面。
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
      passages: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!paper) return Errors.notFound("这套试卷");
  if (paper.status !== "ready") return Errors.notFound("这套试卷的正文（还没补齐，暂不可练）");

  const toPassage = (passage: (typeof paper.passages)[number]) => ({
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
      // 写作/翻译的参考要点可直接展示；阅读/听力解析在提交答案后由 /api/answers 返回，避免首屏泄露
      analysis:
        question.type === "writing" || question.type === "translation" ? question.analysis : "",
    })),
  });

  const sections: PracticePaper["sections"] =
    paper.sections.length > 0
      ? paper.sections.map((section) => ({
          id: section.id,
          order: section.order,
          type: section.type as SectionType,
          title: section.title,
          timeLimit: section.timeLimit,
          passages: section.passages.map(toPassage),
        }))
      : [
          {
            id: `reading-${paper.id}`,
            order: 0,
            type: "reading" as SectionType,
            title: "阅读",
            timeLimit: null,
            passages: paper.passages.map(toPassage),
          },
        ];

  const data: PracticePaper = {
    id: paper.id,
    title: paper.title,
    level: paper.level,
    year: paper.year,
    month: paper.month,
    sections,
  };

  return ok(data);
});
