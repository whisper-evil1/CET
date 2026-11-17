import { z } from "zod";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { BookError, createBook, ensureDefaultBook, listBooks } from "@/lib/books";

/**
 * GET  /api/books —— 我的书架
 * POST /api/books —— 新建一本
 *
 * 第一次进来会顺手把「默认词书」建好：加词总得有个默认落点，
 * 逼用户先点一次「新建」只会让人放弃。
 */
export const GET = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  await ensureDefaultBook(userId);
  const books = await listBooks(userId);
  return ok({ books });
});

const schema = z.object({ name: z.string().trim().min(1, "词书名字不能为空").max(24) });

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const body = await parseBody(request, schema);
  try {
    const book = await createBook(userId, body.name);
    return ok({ book });
  } catch (error) {
    if (error instanceof BookError) return Errors.badRequest(error.message);
    throw error;
  }
});
