import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { parseTranscript } from "@/lib/db-mappers";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/papers/[id]/transcript?passage=<passageId>
 *
 * 听力原文：**按需拉取**，不随刷题页首屏下发。
 *
 * 这和刷题页里 `transcript: []` 是同一个取舍的两半：
 *   - 首屏不带原文 —— 打开页面时浏览器里根本没有这段文字，
 *     顺手「查看源码」看不到答案，也不用为一段长对话白白多传几 KB；
 *   - 用户真的点开「原文」时才来这里取 —— 想看的人一定看得到，不想看的人不会被塞。
 *
 * 权限只卡「登录」与「这段属于这套卷」：
 * 原文是公开的听力材料，不是答案，没必要为它加更严的门槛；
 * 真正防的是「一进来就顺手看到」（首屏不下发），不是「登录用户不许看」。
 */
export const GET = withApi(async (request: Request, ctx: Ctx) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { id } = await ctx.params;
  const passageId = new URL(request.url).searchParams.get("passage")?.trim();
  if (!passageId) return Errors.badRequest("缺少 passage（要看哪一段的原文）");

  /*
   * 用 findFirst 同时校验「段存在」与「段属于这套卷」：
   * 只按 passageId 查的话，换个 paperId 就能读到别套卷的原文，
   * 虽然原文本身不算秘密，但接口边界不清迟早会被别处依赖上。
   */
  const passage = await prisma.passage.findFirst({
    where: { id: passageId, paperId: id },
    select: { id: true, title: true, transcript: true },
  });
  if (!passage) return Errors.notFound("这一段听力");

  const lines = parseTranscript(passage.transcript);

  return ok({
    passageId: passage.id,
    title: passage.title,
    lines,
    /** 有没有逐句中译：前端据此决定要不要显示「中译」开关 */
    hasZh: lines.some((line) => Boolean(line.zh)),
  });
});
