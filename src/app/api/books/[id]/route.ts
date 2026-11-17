import { z } from "zod";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { BookError, deleteBook, renameBook, setDefaultBook } from "@/lib/books";

/**
 * PATCH  /api/books/[id] —— 改名 / 设为默认
 * DELETE /api/books/[id] —— 删掉自建词书
 *
 * 内置词书和「阅读生词」是虚拟的，改不了也删不掉，会返回一句解释。
 */
const schema = z.object({
  name: z.string().trim().min(1).max(24).optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = withApi(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await context.params;
  const body = await parseBody(request, schema);

  try {
    if (body.name) await renameBook(userId, id, body.name);
    if (body.isDefault) await setDefaultBook(userId, id);
    return ok({ ok: true });
  } catch (error) {
    if (error instanceof BookError) return Errors.badRequest(error.message);
    throw error;
  }
});

export const DELETE = withApi(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await context.params;
  try {
    await deleteBook(userId, id);
    return ok({ ok: true });
  } catch (error) {
    if (error instanceof BookError) return Errors.badRequest(error.message);
    throw error;
  }
});
