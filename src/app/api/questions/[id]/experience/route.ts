import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { parseOptionAnalysis, parseStringArray } from "@/lib/db-mappers";
import { generateExperience, type ExperienceInput } from "@/lib/experience";
import type { ExperiencePack } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

type PackRow = {
  pitfall: string;
  correctApproach: string;
  commonMistakes: string;
  keyVocab: string;
  basedOnCommentCount: number;
  generatedAt: Date;
};

function toPack(row: PackRow): ExperiencePack {
  return {
    pitfall: row.pitfall,
    correctApproach: row.correctApproach,
    commonMistakes: parseStringArray(row.commonMistakes),
    keyVocab: parseStringArray(row.keyVocab),
    basedOnCommentCount: row.basedOnCommentCount,
    generatedAt: row.generatedAt.toISOString(),
  };
}

/** 组装生成经验包所需的题目上下文（题干/选项/答案/解析/公开讨论） */
async function loadInput(questionId: string): Promise<{ input: ExperienceInput; commentCount: number } | null> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      stem: true,
      options: true,
      answer: true,
      analysis: true,
      optionAnalysis: true,
    },
  });
  if (!question) return null;

  const comments = await prisma.comment.findMany({
    where: { questionId, visibility: "public", parentId: null },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { content: true },
  });

  let options: { key: string; text: string }[] = [];
  try {
    const parsed = JSON.parse(question.options) as unknown;
    if (Array.isArray(parsed)) options = parsed as { key: string; text: string }[];
  } catch {
    options = [];
  }

  return {
    input: {
      stem: question.stem,
      options,
      answer: question.answer,
      analysis: question.analysis,
      optionAnalysis: parseOptionAnalysis(question.optionAnalysis),
      comments: comments.map((c) => c.content),
    },
    commentCount: comments.length,
  };
}

async function upsertPack(
  questionId: string,
  input: ExperienceInput,
  commentCount: number,
): Promise<ExperiencePack> {
  const draft = await generateExperience(input);
  const row = await prisma.experiencePack.upsert({
    where: { questionId },
    create: {
      questionId,
      pitfall: draft.pitfall,
      correctApproach: draft.correctApproach,
      commonMistakes: JSON.stringify(draft.commonMistakes),
      keyVocab: JSON.stringify(draft.keyVocab),
      basedOnCommentCount: commentCount,
    },
    update: {
      pitfall: draft.pitfall,
      correctApproach: draft.correctApproach,
      commonMistakes: JSON.stringify(draft.commonMistakes),
      keyVocab: JSON.stringify(draft.keyVocab),
      basedOnCommentCount: commentCount,
    },
  });
  return toPack(row);
}

/**
 * GET /api/questions/[id]/experience
 * 有缓存直接返回；没有则生成一次并落库。写作/翻译等无选项的题不生成，返回 pack=null。
 */
export const GET = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;

  const cached = await prisma.experiencePack.findUnique({ where: { questionId: id } });
  if (cached) return ok({ pack: toPack(cached) });

  const loaded = await loadInput(id);
  if (!loaded) return Errors.notFound("这道题");
  if (loaded.input.options.length === 0) return ok({ pack: null });

  const pack = await upsertPack(id, loaded.input, loaded.commentCount);
  return ok({ pack });
});

/**
 * POST /api/questions/[id]/experience
 * 强制重新生成（限频：每用户 5 分钟 5 次），用于讨论变多后刷新经验包。
 */
export const POST = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;

  const limited = rateLimit(`experience:${meId}`, { windowMs: 5 * 60_000, max: 5 });
  if (!limited.allowed) {
    return Errors.tooMany(`刷新太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const loaded = await loadInput(id);
  if (!loaded) return Errors.notFound("这道题");
  if (loaded.input.options.length === 0) return ok({ pack: null });

  const pack = await upsertPack(id, loaded.input, loaded.commentCount);
  return ok({ pack });
});
