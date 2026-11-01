import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { parseDefinitions, parseOptions, parseParagraphs, parseTranscript } from "@/lib/db-mappers";
import type { PracticePaper, SectionType } from "@/lib/types";
import { PracticeShell } from "@/components/practice/practice-shell";

export const dynamic = "force-dynamic";

/** 刷题页：服务端把题目、作答、收藏、生词本状态准备好 */
export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ paperId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { paperId } = await params;
  const { q } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) redirect(`/login?next=/practice/${paperId}`);

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      // 优先查真实的 Section 层级（v2.0）
      sections: {
        orderBy: { order: "asc" },
        include: {
          passages: {
            orderBy: { order: "asc" },
            include: { questions: { orderBy: { order: "asc" } } },
          },
        },
      },
      // 兼容老数据：直接挂在 paper 下、没 Section 的 Passage
      passages: {
        orderBy: { order: "asc" },
        include: { questions: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!paper) notFound();

  // 有真实 Section 就用真实数据；否则把老 Passage 包装成单个 reading section
  const sections: PracticePaper["sections"] =
    paper.sections.length > 0
      ? paper.sections.map((section) => ({
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
              // 写作/翻译参考要点直接展示；阅读/听力解析提交后才返回，防泄露
              analysis:
                question.type === "writing" || question.type === "translation"
                  ? question.analysis
                  : "",
            })),
          })),
        }))
      : [
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
                analysis: "",
              })),
            })),
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

  // 作答/收藏按 passage.paperId 过滤（v1 关系）
  const [answers, favorites, vocab] = await Promise.all([
    prisma.answer.findMany({
      where: { userId, question: { passage: { paperId } } },
      select: { questionId: true, choice: true, isCorrect: true, viewedAnalysis: true },
    }),
    prisma.favorite.findMany({
      where: { userId, question: { passage: { paperId } } },
      select: { questionId: true },
    }),
    prisma.vocabWord.findMany({
      where: { userId },
      select: { word: true, definitions: true },
    }),
  ]);

  const initialAnswers: Record<string, { choice: string; isCorrect: boolean; viewedAnalysis: boolean }> =
    {};
  for (const answer of answers) {
    initialAnswers[answer.questionId] = {
      choice: answer.choice,
      isCorrect: answer.isCorrect,
      viewedAnalysis: answer.viewedAnalysis,
    };
  }

  const initialVocab: Record<string, string> = {};
  for (const word of vocab) {
    const definitions = parseDefinitions(word.definitions);
    initialVocab[word.word.toLowerCase()] = definitions[0]?.zh ?? "";
  }

  return (
    <PracticeShell
      paper={data}
      initialAnswers={initialAnswers}
      initialFavorites={favorites.map((f) => f.questionId)}
      initialVocab={initialVocab}
      startQuestionId={q}
    />
  );
}
