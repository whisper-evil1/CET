import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { vocabCreateSchema } from "@/lib/validators";
import { parseDefinitions, toJsonText } from "@/lib/db-mappers";
import type { VocabItem } from "@/lib/types";

/** GET /api/vocab?status=learning|mastered */
export const GET = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const status = new URL(request.url).searchParams.get("status");
  const rows = await prisma.vocabWord.findMany({
    where: {
      userId: meId,
      ...(status === "learning" || status === "mastered" ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  const data: VocabItem[] = rows.map((row) => ({
    id: row.id,
    word: row.word,
    phonetic: row.phonetic,
    definitions: parseDefinitions(row.definitions),
    example: row.example,
    exampleZh: row.exampleZh,
    sourceContext: row.sourceContext,
    reviewCount: row.reviewCount,
    status: row.status === "mastered" ? "mastered" : "learning",
    createdAt: row.createdAt.toISOString(),
  }));

  return ok(data);
});

/**
 * POST /api/vocab —— 加入生词库
 * 唯一约束 userId+word：重复加入只刷新释义与时间，不新建记录。
 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const body = await parseBody(request, vocabCreateSchema);
  const word = body.word.trim().toLowerCase();

  const row = await prisma.vocabWord.upsert({
    where: { userId_word: { userId: meId, word } },
    create: {
      userId: meId,
      word,
      phonetic: body.phonetic ?? null,
      definitions: toJsonText(body.definitions),
      example: body.example ?? null,
      exampleZh: body.exampleZh ?? null,
      sourceContext: body.sourceContext ?? null,
      sourcePassageId: body.sourcePassageId ?? null,
      reviewCount: 0,
      status: "learning",
    },
    update: {
      // 只在新释义非空时才覆盖，避免重复加入（这次没查到释义）把旧释义清空
      ...(body.phonetic ? { phonetic: body.phonetic } : {}),
      ...(body.definitions.length > 0 ? { definitions: toJsonText(body.definitions) } : {}),
      ...(body.example ? { example: body.example } : {}),
      ...(body.exampleZh ? { exampleZh: body.exampleZh } : {}),
      ...(body.sourceContext ? { sourceContext: body.sourceContext } : {}),
    },
  });

  const data: VocabItem = {
    id: row.id,
    word: row.word,
    phonetic: row.phonetic,
    definitions: parseDefinitions(row.definitions),
    example: row.example,
    exampleZh: row.exampleZh,
    sourceContext: row.sourceContext,
    reviewCount: row.reviewCount,
    status: row.status === "mastered" ? "mastered" : "learning",
    createdAt: row.createdAt.toISOString(),
  };

  return ok(data);
});

/**
 * DELETE /api/vocab —— 按单词从生词库移除（词卡取消收藏用）
 * body: { word: string }
 */
export const DELETE = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const body = await request.json().catch(() => ({}));
  const word = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
  if (!word) return Errors.badRequest("缺少 word");

  const row = await prisma.vocabWord.findUnique({
    where: { userId_word: { userId: meId, word } },
    select: { id: true },
  });
  if (!row) return ok({ id: null, removed: false });

  await prisma.vocabWord.delete({ where: { id: row.id } });
  return ok({ id: row.id, removed: true });
});
