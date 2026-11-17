import { z } from "zod";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { BookError, addWordsToBook, bookWords, importExamWordsToBook, removeWordFromBook } from "@/lib/books";

/**
 * GET    /api/books/[id]/words —— 这本书的词（背单词与词表共用）
 * POST   /api/books/[id]/words —— 加词（单个或一批）
 * DELETE /api/books/[id]/words?word=xxx —— 移词
 *
 * POST 的 body 支持三种写法，都是为了少一次往返：
 *   { word: "abandon" }              单个单词（查词浮层用）
 *   { words: ["a","b"] }             一批
 *   { importExam: "cet4-core", count: 50 }  把内置词书的一段复制进来
 */
const schema = z.object({
  word: z.string().trim().max(48).optional(),
  words: z.array(z.string().trim().max(48)).max(200).optional(),
  importExam: z.string().trim().max(64).optional(),
  count: z.number().int().min(1).max(3000).optional(),
});

export const GET = withApi(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await context.params;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 200);

  const data = await bookWords(userId, decodeURIComponent(id), limit);
  if (!data.book) return Errors.notFound("词书");
  return ok(data);
});

export const POST = withApi(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await context.params;
  const bookId = decodeURIComponent(id);
  const body = await parseBody(request, schema);

  try {
    if (body.importExam) {
      const result = await importExamWordsToBook(userId, body.importExam, bookId, body.count ?? 50);
      return ok(result);
    }
    const list = body.words ?? (body.word ? [body.word] : []);
    if (list.length === 0) return Errors.badRequest("没有可加入的词");
    const result = await addWordsToBook(userId, bookId, list);
    return ok(result);
  } catch (error) {
    if (error instanceof BookError) return Errors.badRequest(error.message);
    throw error;
  }
});

export const DELETE = withApi(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await context.params;
  const url = new URL(request.url);
  const word = url.searchParams.get("word") ?? "";
  if (!word) return Errors.badRequest("缺少要移除的单词");

  try {
    await removeWordFromBook(userId, decodeURIComponent(id), word);
    return ok({ ok: true });
  } catch (error) {
    if (error instanceof BookError) return Errors.badRequest(error.message);
    throw error;
  }
});
