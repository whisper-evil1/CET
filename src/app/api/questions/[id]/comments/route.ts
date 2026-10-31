import { prisma } from "@/lib/prisma";
import { Errors, fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { commentCreateSchema } from "@/lib/validators";
import { looksSuspicious, sanitizePlainText } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limit";
import type { CommentItem } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

const MAX_REPLY_DEPTH = 1; // 只做一级回复

function toItem(
  row: {
    id: string;
    content: string;
    visibility: string;
    likes: number;
    createdAt: Date;
    userId: string;
    parentId: string | null;
    user: { id: string; name: string | null; avatar: string | null };
  },
  meId: string,
): CommentItem {
  return {
    id: row.id,
    content: row.content,
    visibility: row.visibility === "public" ? "public" : "private",
    likes: row.likes,
    createdAt: row.createdAt.toISOString(),
    canEdit: row.userId === meId,
    isMine: row.userId === meId,
    author: { id: row.user.id, name: row.user.name, avatar: row.user.avatar },
    replies: [],
  };
}

/**
 * GET /api/questions/[id]/comments?scope=all|private|public
 *
 * 权限硬约束（服务端强制，不依赖前端过滤）：
 *   - private 留言只可能返回 userId = 当前登录用户 的记录
 *   - public 留言对所有登录用户可见
 */
export const GET = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id: questionId } = await ctx.params;
  const scope = new URL(request.url).searchParams.get("scope") ?? "all";

  // scope=all：自己的私密笔记 + 所有人的公开讨论
  const scopeFilter =
    scope === "private"
      ? { visibility: "private", userId: meId }
      : scope === "public"
        ? { visibility: "public" }
        : { OR: [{ visibility: "public" }, { visibility: "private", userId: meId }] };

  const rows = await prisma.comment.findMany({
    where: {
      questionId,
      parentId: null,
      ...scopeFilter,
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, avatar: true } },
      replies: {
        where: { visibility: "public" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, avatar: true } } },
      },
    },
  });

  const items = rows.map((row) => {
    const item = toItem(row, meId);
    item.replies = row.replies.map((reply) => toItem(reply, meId));
    return item;
  });

  return ok(items);
});

/** POST /api/questions/[id]/comments —— 发表留言（默认私密） */
export const POST = withApi(async (request: Request, ctx: Ctx) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const { id: questionId } = await ctx.params;

  if (!rateLimit(`comment:${meId}`, { windowMs: 60_000, max: 12 }).allowed) {
    return fail(4029, "留言发得太快了，歇一会儿再发", 429);
  }

  const body = await parseBody(request, commentCreateSchema);
  const content = sanitizePlainText(body.content, 500);

  if (!content) return fail(4000, "留言内容为空，或者含有不支持的标签", 400);
  if (looksSuspicious(body.content) && !content) {
    return fail(4000, "留言里包含可疑脚本内容，已被拦截", 400);
  }

  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { id: true } });
  if (!question) return Errors.notFound("这道题");

  // 回复只能挂在一级公开留言下，且不能回复别人的私密留言
  let parentId: string | null = null;
  if (body.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: body.parentId },
      select: { id: true, parentId: true, visibility: true, user: { select: { id: true } } },
    });
    if (!parent || parent.parentId) return fail(4000, "回复目标不存在或层级过深", 400);
    if (parent.visibility !== "public" && parent.user.id !== meId) {
      return Errors.forbidden();
    }
    if (parent.visibility !== "public") {
      // 私密笔记下不允许开公开回复，避免语义混乱
      return fail(4000, "私密笔记不支持回复，可以改成公开后再讨论", 400);
    }
    parentId = parent.id;
    if (MAX_REPLY_DEPTH < 1) return fail(4000, "回复层级受限", 400);
  }

  const created = await prisma.comment.create({
    data: {
      userId: meId,
      questionId,
      content,
      visibility: body.visibility,
      parentId,
    },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });

  return ok(toItem(created, meId));
});
