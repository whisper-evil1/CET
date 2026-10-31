import { prisma } from "@/lib/prisma";
import { Errors, fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { commentUpdateSchema } from "@/lib/validators";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/comments/[id]
 * 只允许作者本人操作，且只允许 private → public（公开后不可撤回为私密）。
 */
export const PATCH = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const body = await parseBody(request, commentUpdateSchema);

  const comment = await prisma.comment.findUnique({
    where: { id },
    select: { id: true, userId: true, visibility: true },
  });
  if (!comment) return Errors.notFound("这条留言");
  if (comment.userId !== meId) return Errors.forbidden();

  if (body.visibility === "public") {
    if (comment.visibility === "public") return ok({ id, visibility: "public" });
    const updated = await prisma.comment.update({
      where: { id },
      data: { visibility: "public" },
      select: { id: true, visibility: true },
    });
    return ok(updated);
  }

  return fail(4000, "只支持把私密留言改为公开，公开后不能撤回为私密", 400);
});

/** DELETE /api/comments/[id] —— 只能删自己的 */
export const DELETE = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const comment = await prisma.comment.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!comment) return Errors.notFound("这条留言");
  if (comment.userId !== meId) return Errors.forbidden();

  await prisma.comment.delete({ where: { id } });
  return ok({ id });
});
