import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { checkEmail } from "@/lib/email-rules";
import { sendCodeTo } from "@/lib/email-code";

/**
 * POST /api/auth/email-code
 *
 * 发一枚 6 位邮箱验证码。登录和注册共用这个接口，用 purpose 区分：
 *   - purpose=register：邮箱必须**没注册过**，否则提示去登录（省得用户白等一封码）
 *   - purpose=login   ：邮箱必须**注册过**，否则提示先注册
 *
 * 这一层只做「该不该发」，不判断密码对不对 —— 密码是登录接口的事，
 * 两件事混在一起，报错文案就会含糊（用户分不清是码错了还是密码错了）。
 */

const schema = z.object({
  email: z.string().trim().min(1).max(120),
  purpose: z.enum(["login", "register"]),
});

export const POST = withApi(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  // 单 IP 一分钟最多 10 次：正常用户点不到这个数，脚本刷信会被拦在这里
  if (!rateLimit(`email-code:${ip}`, { windowMs: 60_000, max: 10 }).allowed) {
    return fail(4029, "发送太频繁了，请一分钟后再试", 429);
  }

  const body = await parseBody(request, schema);

  // 格式先拦一道：不合法就别浪费一次发信，也别让用户等 60 秒冷却
  const checked = checkEmail(body.email);
  if (!checked.ok) return fail(4000, checked.message);

  const existing = await prisma.user.findUnique({ where: { email: checked.email } });

  if (body.purpose === "register" && existing) {
    return fail(4009, "这个邮箱已经注册过了，直接登录吧", 409);
  }
  if (body.purpose === "login" && !existing) {
    return fail(4004, "这个邮箱还没注册过，先去注册一个", 404);
  }

  const sent = await sendCodeTo(checked.email, body.purpose);
  if (!sent.ok) {
    return fail(4029, sent.message, sent.retryAfterSec ? 429 : 400);
  }

  return ok({
    email: checked.email,
    purpose: body.purpose,
    ...sent.data,
  });
});
