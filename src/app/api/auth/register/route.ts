import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { registerSchema } from "@/lib/validators";
import { sanitizeName } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limit";

/** 注册：邮箱唯一 + 密码 bcrypt 哈希，绝不明文落库 */
export const POST = withApi(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  if (!rateLimit(`register:${ip}`, { windowMs: 60_000, max: 5 }).allowed) {
    return fail(4029, "注册太频繁了，请一分钟后再试", 429);
  }

  const body = await parseBody(request, registerSchema);

  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) return fail(4009, "这个邮箱已经注册过了，直接登录吧", 409);

  const hashed = await bcrypt.hash(body.password, 10);
  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: hashed,
      name: body.name ? sanitizeName(body.name) : (body.email.split("@")[0] ?? "同学"),
    },
  });

  return ok({ id: user.id, email: user.email, name: user.name });
});
