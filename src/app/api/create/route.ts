import { prisma } from "@/lib/prisma";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { creationSchema } from "@/lib/validators";

/**
 * GET  /api/create?kind=novel|video —— 我的作品列表（最近 30 件）
 * POST /api/create                   —— 保存一件作品
 *
 * 作品是「创作平台」的产物，和生词本、错题一样属于个人数据：
 * 所有查询都带 userId，删除也校验归属，越权一律 404（不暴露存在性）。
 */
export const GET = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const kind = new URL(request.url).searchParams.get("kind");
  const rows = await prisma.creation.findMany({
    where: {
      userId: meId,
      ...(kind === "novel" || kind === "video" ? { kind } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  return ok(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      sourceText: row.sourceText,
      output: safeParse(row.output),
      meta: safeParse(row.meta),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  );
});

function safeParse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const body = await parseBody(request, creationSchema);

  const created = await prisma.creation.create({
    data: {
      userId: meId,
      kind: body.kind,
      title: body.title,
      sourceText: body.sourceText,
      output: body.output,
      meta: body.meta ?? null,
    },
    select: { id: true, kind: true, title: true, createdAt: true },
  });

  return ok({ id: created.id, kind: created.kind, title: created.title, createdAt: created.createdAt.toISOString() });
});
