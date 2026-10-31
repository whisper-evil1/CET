import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/comments/[id]/like —— 公开留言点赞（简单 +1） */
export const POST = withApi(async (_request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id } = await ctx.params;

  if (!rateLimit(`like:${meId}:${id}`, { windowMs: 10_000, max: 3 }).allowed) {
    return Errors.tooMany("点太快了，休息一下");
  }

  const comment = await prisma.comment.findUnique({
    where: { id },
    select: { visibility: true },
  });
  if (!comment) return Errors.notFound("这条留言");
  if (comment.visibility !== "public") return Errors.forbidden();

  const updated = await prisma.comment.update({
    where: { id },
    data: { likes: { increment: 1 } },
    select: { id: true, likes: true },
  });

  return ok(updated);
});
