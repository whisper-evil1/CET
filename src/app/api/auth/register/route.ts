import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { registerSchema } from "@/lib/validators";
import { sanitizeName } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limit";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { verifyCode } from "@/lib/email-code";

/**
 * 注册：邮箱唯一 + 邮箱验证码 + 密码 bcrypt 哈希，绝不明文落库。
 *
 * 验证码的强制策略：
 *   - 配了 RESEND_API_KEY（能真发信）或显式 EMAIL_CODE_REQUIRED=1 → 没带码直接拒；
 *   - 否则允许不带码（历史脚本、第三方调用只传邮箱密码），但**一旦带了码就必须验对**。
 * 这样「用户从页面注册」永远是走过验证码的，而自动化脚本不会被一刀切打断。
 */
export const POST = withApi(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(`register:${ip}`, { windowMs: 60_000, max: 5 }).allowed) {
    return fail(4029, "注册太频繁了，请一分钟后再试", 429);
  }

  const body = await parseBody(request, registerSchema);

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) return fail(4009, "这个邮箱已经注册过了，直接登录吧", 409);

  const codeRequired = process.env.EMAIL_CODE_REQUIRED === "1" || Boolean(process.env.RESEND_API_KEY?.trim());
  if (body.code) {
    const verified = verifyCode(body.email, "register", body.code);
    if (!verified.ok) return fail(4010, verified.message, 400);
  } else if (codeRequired) {
    return fail(4010, "注册需要邮箱验证码，先点「发送验证码」", 400);
  }

  const hashed = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: hashed,
      name: body.name ? sanitizeName(body.name) : (body.email.split("@")[0] ?? "同学"),
    },
  });

  // 账号凭据同步到云数据库（公开邮箱 + bcrypt 摘要，非明文）。
  // 本地账号已落库就算注册成功，云侧失败不回滚、不影响这次注册。
  const mirrored = await syncAccountToCloud({
    localUserId: user.id,
    email: user.email,
    name: user.name,
    passwordHash: hashed,
    source: "register",
  });

  return ok({
    id: user.id,
    email: user.email,
    name: user.name,
    cloudSynced: mirrored.ok,
  });
});
