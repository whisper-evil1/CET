import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { parseEmail } from "@/lib/email-rules";
import { normalizeEmail, verifyCode } from "@/lib/email-code";
import { passwordIssue } from "@/lib/password-policy";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { saveAccountToVault } from "@/lib/account-vault";

/**
 * POST /api/auth/reset-password
 *
 * 忘记密码的第二步：凭邮箱验证码重设密码，**不需要登录**。
 *
 * 为什么不复用 /api/account/password：
 *   那个接口的前提是「会话里有 uid」，忘记密码的人恰恰进不来，
 *   要求先登录才能改密码等于没有这个功能。两条路径的凭证不同，
 *   混在一个路由里，权限判断会变成「有 uid 或有 code 就放行」——
 *   这种「或」是越权的经典写法，宁可分成两个文件。
 *
 * 校验顺序（顺序本身就是防刷设计）：
 *   1. 限流         —— 先挡住脚本，别让后面的 bcrypt 成为放大器
 *   2. 邮箱结构     —— 结构都不对，连查库都省了
 *   3. 新密码强度   —— 放在验码之前：密码不合规不该消耗验证码的试错次数，
 *                     否则用户改三次格式就把码试废了，还得重新等一封
 *   4. 验证码       —— 一次性，验过即作废
 *   5. 账号是否存在 —— 放在验码之后：没拿到码的人不该能探测「这个邮箱注册没有」
 *
 * 密码只存 bcrypt 摘要，和注册、改密码两条路径完全一致（绝不明文落库）。
 * 重置同时会把 passwordSet 置 true：验证码账号（从没设过密码）重置一次就有了密码，
 * 之后用邮箱密码也能登。
 */

const schema = z.object({
  email: z.string().trim().min(1).max(120),
  /** 值里可能带空格或短横线（从邮件复制粘贴），下面统一去非数字 */
  code: z.string().trim().max(12),
  newPassword: z.string().max(64),
});

export const POST = withApi(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  // 一分钟 5 次：正常用户重置一次密码用不到 3 次；脚本连打会在这里被拦下
  if (!rateLimit(`reset-pwd:${ip}`, { windowMs: 60_000, max: 5 }).allowed) {
    return fail(4029, "操作太频繁了，请一分钟后再试", 429);
  }

  const body = await parseBody(request, schema);

  /*
   * 这里用 parseEmail（只判结构）而不是 checkEmail（结构 + 域名白名单）。
   * 白名单的作用是「别给发不到信的域名发码」，那件事已经由发码接口把关了；
   * 到了换密码这一步，手里有码就证明能收到那个邮箱的信，
   * 再用白名单卡一次，只会把「域名后来被移出白名单」的老账号锁死在门外。
   */
  const checked = parseEmail(body.email);
  if (!checked.ok) return fail(4000, checked.message);

  const issue = passwordIssue(body.newPassword);
  if (issue) return fail(4000, issue);

  const email = normalizeEmail(checked.email);
  const code = body.code.replace(/\D/g, "");

  if (!code) return fail(4000, "请填写邮箱收到的 6 位验证码");

  const verified = verifyCode(email, "reset", code);
  if (!verified.ok) {
    // 过期 / 错太多次这两种情况本身就是「需要重新发码」，用 400 而不是 401：
    // 401 会被前端统一改写成「请先登录」，把真实原因盖掉。
    return fail(4000, verified.message);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return fail(4004, "这个邮箱下没有账号，先确认是不是注册时用的那个邮箱", 404);
  }

  const hashed = await bcrypt.hash(body.newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, passwordSet: true },
  });

  /*
   * 两条旁路，都不影响「密码已经改了」这个事实：
   *   - 云镜像：换设备后靠它认回账号。接口是 append-only + 进程内去重，
   *     同一账号本进程内可能跳过（返回 alreadyExists），这时云端可能仍是旧摘要，
   *     属于既有策略的已知边界，不阻断本次重置。
   *   - 保险库：force=true 绕过进程内去重，写出一条新记录；
   *     恢复时取最近一条，所以这条路径拿到的一定是新密码。
   */
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
    email: updated.email,
    passwordSet: true,
    /** 云端镜像 / 加密备份是否写成功；false 只影响换设备恢复，当前密码已生效 */
    mirrored: mirrored.ok,
    vaultReady: vaulted,
  });
});
