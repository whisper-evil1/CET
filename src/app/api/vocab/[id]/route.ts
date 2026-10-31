import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

const resetSchema = z.object({ action: z.literal("reset") });

/** PATCH /api/vocab/[id] —— 已掌握的词移回生词库（reviewCount 归零） */
export const PATCH = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  await parseBody(request, resetSchema);

  const row = await prisma.vocabWord.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!row) return Errors.notFound("这个单词");
  if (row.userId !== meId) return Errors.forbidden();

  const updated = await prisma.vocabWord.update({
    where: { id },
    data: { reviewCount: 0, correctStreak: 0, status: "learning" },
    select: { id: true, reviewCount: true, status: true },
  });

  return ok(updated);
});

/** DELETE /api/vocab/[id] —— 从生词库彻底移除 */
export const DELETE = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const row = await prisma.vocabWord.findUnique({ where: { id }, select: { userId: true } });
  if (!row) return Errors.notFound("这个单词");
  if (row.userId !== meId) return Errors.forbidden();

  await prisma.vocabWord.delete({ where: { id } });
  return ok({ id });
});
