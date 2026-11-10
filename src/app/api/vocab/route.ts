import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { vocabCreateSchema } from "@/lib/validators";
import { toJsonText } from "@/lib/db-mappers";
import { toVocabItem } from "@/lib/vocab-view";
import { lookupOffline } from "@/lib/offline-dict";
import { findInWordbooks } from "@/lib/wordbook";

/**
 * GET /api/vocab?status=learning|mastered&sort=recent|priority
 * 返回词表；每条都现算优先级与到期状态。
 */
export const GET = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const sort = params.get("sort");

  const rows = await prisma.vocabWord.findMany({
    where: {
      userId: meId,
      ...(status === "learning" || status === "mastered" ? { status } : {}),
    },
    orderBy: { updatedAt: "desc" },
  });

  const now = Date.now();
  const data = rows.map((row) => toVocabItem(row, now));
  if (sort === "priority") {
    // 同分时按到期先后：逾期更久的排前面
    data.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
    });
  }

  return ok(data);
});

/**
 * 存储侧的长度上限（字符）。
 * 注意：校验层故意放宽，裁剪只在这里做——「先收下再截断」，
 * 避免长句语境 / 长释义让整条请求 400，表现成"点了加入生词本没反应"。
 */
const LIMIT = {
  phonetic: 120,
  pos: 20,
  zh: 200,
  example: 500,
  exampleZh: 500,
  sourceContext: 500,
} as const;

function clampTo(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * POST /api/vocab —— 加入生词库
 * 唯一约束 userId+word：重复加入只刷新释义与时间，不新建记录。
 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const body = await parseBody(request, vocabCreateSchema);
  const word = body.word.trim().toLowerCase().slice(0, 64);

  const definitions = body.definitions
    .map((item) => ({
      pos: clampTo(item.pos, LIMIT.pos) ?? "",
      zh: clampTo(item.zh, LIMIT.zh) ?? "",
    }))
    .filter((item) => item.zh.length > 0);

  const phonetic = clampTo(body.phonetic, LIMIT.phonetic);
  const example = clampTo(body.example, LIMIT.example);
  const exampleZh = clampTo(body.exampleZh, LIMIT.exampleZh);
  const sourceContext = clampTo(body.sourceContext, LIMIT.sourceContext);

  // 优先级算法的两个输入：考纲标签（离线词库）+ 词频排名（词书索引）
  const offline = lookupOffline(word);
  const inBook = findInWordbooks(word);

  const row = await prisma.vocabWord.upsert({
    where: { userId_word: { userId: meId, word } },
    create: {
      userId: meId,
      word,
      phonetic,
      definitions: toJsonText(definitions),
      example,
      exampleZh,
      sourceContext,
      sourcePassageId: body.sourcePassageId ?? null,
      reviewCount: 0,
      status: "learning",
      examTags: offline && offline.tags && offline.tags.length > 0 ? offline.tags.join(",") : null,
      examRank: inBook ? inBook.rank : null,
      wordbookId: inBook ? inBook.bookId : null,
      source: inBook ? "wordbook" : "lookup",
    },
    update: {
      // 只在新释义非空时才覆盖，避免重复加入（这次没查到释义）把旧释义清空
      ...(phonetic ? { phonetic } : {}),
      ...(definitions.length > 0 ? { definitions: toJsonText(definitions) } : {}),
      ...(example ? { example } : {}),
      ...(exampleZh ? { exampleZh } : {}),
      ...(sourceContext ? { sourceContext } : {}),
      // 元信息只补不清：老数据可能是 null，补上后优先级才准
      ...(inBook ? { examRank: inBook.rank, wordbookId: inBook.bookId } : {}),
      ...(offline && offline.tags && offline.tags.length > 0
        ? { examTags: offline.tags.join(",") }
        : {}),
    },
  });

  return ok(toVocabItem(row));
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
