import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { registerSchema } from "@/lib/validators";
import { sanitizeName } from "@/lib/sanitize";
import { rateLimit } from "@/lib/rate-limit";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { saveAccountToVault } from "@/lib/account-vault";

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

  // 账号凭据同步到云数据库（公开邮箱 + bcrypt 摘要，非明文）。
  // 本地账号已落库就算注册成功，云侧失败不回滚、不影响这次注册。
  const mirrored = await syncAccountToCloud({
    localUserId: user.id,
    email: user.email,
    name: user.name,
    passwordHash: hashed,
    source: "register",
  });

  // 写一份加密凭据到账号保险库：本地库被重置后，这个账号还能用原密码登回来，
  // 而不是逼用户重开一个新号。失败不影响注册结果（保险库是旁路）。
  const vaulted = await saveAccountToVault({
    userId: user.id,
    email: user.email,
    name: user.name,
    passwordHash: hashed,
  });

  return ok({
    id: user.id,
    email: user.email,
    name: user.name,
    cloudSynced: mirrored.ok,
    vaultReady: vaulted,
  });
});
