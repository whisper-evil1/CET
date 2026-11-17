import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/create/[id] —— 删除自己的作品；别人的一律 404，不暴露存在性 */
export const DELETE = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const row = await prisma.creation.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== meId) return Errors.notFound("这件作品");

  await prisma.creation.delete({ where: { id } });
  return ok({ id });
});
