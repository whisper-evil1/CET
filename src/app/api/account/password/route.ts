import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { saveAccountToVault } from "@/lib/account-vault";

const schema = z.object({
  currentPassword: z.string().max(64).optional(),
  newPassword: z
    .string()
    .min(8, "新密码至少 8 位")
    .max(64, "新密码最多 64 位")
    .regex(/[a-zA-Z]/, "新密码要包含字母")
    .regex(/\d/, "新密码要包含数字"),
});

/**
 * 自助改密码。
 *
 * 两种账号走两条路：
 *   - 设过密码的：必须验旧密码，避免手机被人临时借走就能改密码；
 *   - 验证码账号（passwordSet=false）：本来就没有密码，登录态本身就是凭证，
 *     允许直接设一个 —— 否则这类账号永远只能用验证码登录。
 *
 * 改完立刻刷新保险库与云镜像：老密码在任何一条恢复路径上都不该再有效。
 */
export const POST = withApi(async (request: Request) => {
  const uid = await currentUserId();
  if (!uid) return Errors.unauthorized();

  if (!rateLimit(`pwd:${uid}`, { windowMs: 60_000, max: 5 }).allowed) {
    return Errors.tooMany("操作太频繁了，请稍后再试");
  }

  const body = await parseBody(request, schema);
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user) return Errors.unauthorized();

  if (body.newPassword === body.currentPassword) {
    return Errors.badRequest("新密码不能和旧密码一样");
  }

  if (user.passwordSet) {
    if (!body.currentPassword) return Errors.badRequest("请先输入当前密码");
    const okOld = await bcrypt.compare(body.currentPassword, user.password);
    if (!okOld) return Errors.badRequest("当前密码不对");
  }

  const hashed = await bcrypt.hash(body.newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: uid },
    data: { password: hashed, passwordSet: true },
  });

  const mirrored = await syncAccountToCloud({
    localUserId: updated.id,
    email: updated.email,
    name: updated.name,
    passwordHash: hashed,
    source: "login",
  });

  const vaulted = await saveAccountToVault(
    {
      userId: updated.id,
      email: updated.email,
      phone: updated.phone,
      name: updated.name,
      passwordHash: hashed,
    },
    { force: true },
  );

  return ok({
    passwordSet: true,
    /** 云端镜像与加密备份是否都写成功；失败只影响「换设备恢复」，当前密码已经生效 */
    mirrored: mirrored.ok,
    vaultReady: vaulted,
  });
});
