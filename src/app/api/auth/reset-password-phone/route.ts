import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { passwordIssue } from "@/lib/password-policy";
import { isPhone, normalizePhone } from "@/lib/phone";
import { probeCloudIdentity } from "@/lib/cloud-identity";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { saveAccountToVault } from "@/lib/account-vault";

/**
 * POST /api/auth/reset-password-phone
 *
 * 忘记密码的手机号路径：短信验证码换新密码。
 *
 * 为什么必须单独一个路由，而不是给 /api/auth/reset-password 加个 kind：
 *   那条路的凭证是「服务端自己发的邮箱码」，一次性、存在本进程里；
 *   这条路的凭证是「云 SDK 签发的 accessToken」，由云端签发、由服务端回头
 *   向云端换身份。两种凭证的生命周期和校验方式完全不同，塞进一个函数里，
 *   就会变成「邮箱码对 或 token 对 就放行」——这是越权的经典写法。
 *
 * 安全边界只有一条，但必须是硬的：
 *   **手机号一律从 token 里的身份取，绝不采信请求体里自报的号码。**
 *   否则谁都能把别人的号填进来改别人的密码。请求体里的 phone 只用来做
 *   「你发的码和你要找回的号是不是同一个」的提示，对不上就直说，
 *   而不是默默拿 token 里的号把密码改掉（那才会让人一头雾水）。
 *
 * 和邮箱路径一样，密码强度在验身份之前判：密码不合规不该消耗一次验证。
 */

const schema = z.object({
  /** 云会话令牌：客户端已完成短信验证码校验 */
  accessToken: z.string().min(20).max(4096),
  /** 页面上显示的那个号码，仅用于一致性提示与报错措辞 */
  phone: z.string().trim().max(24).optional(),
  newPassword: z.string().max(64),
  originHint: z.string().max(200).optional(),
});

export const POST = withApi(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for") ?? "local";
  // 一分钟 5 次：短信验证码本身还有 60 秒冷却，这里只是兜住脚本连打
  if (!rateLimit(`reset-pwd-phone:${ip}`, { windowMs: 60_000, max: 5 }).allowed) {
    return fail(4029, "操作太频繁了，请一分钟后再试", 429);
  }

  const body = await parseBody(request, schema);

  // 1. 新密码强度：放在验身份之前，避免用户改三次格式就废掉一次验证
  const issue = passwordIssue(body.newPassword);
  if (issue) return fail(4000, issue);

  // 2. 拿 token 去云端换身份
  const verified = await probeCloudIdentity(body.accessToken, body.originHint);
  if (!verified.ok) {
    return fail(
      4000,
      `短信验证通过，但云端身份没换成（${verified.status ?? verified.reason}），请重新获取验证码`,
    );
  }

  const fromToken = verified.identity.phone ? normalizePhone(verified.identity.phone) : "";
  if (!isPhone(fromToken)) {
    return fail(4000, "这次验证的身份里没有手机号，请改用邮箱找回");
  }

  // 3. 自报号码与 token 里的号码必须一致：不一致说明用户发错号了，直说比默默改掉更好
  if (body.phone) {
    const claimed = normalizePhone(body.phone);
    if (isPhone(claimed) && claimed !== fromToken) {
      return fail(
        4000,
        `验证码是发到 ${fromToken.slice(0, 3)}****${fromToken.slice(-4)} 的，和要找回的号码不是同一个`,
      );
    }
  }

  // 4. 用 token 里的号码定位账号
  const user = await prisma.user.findUnique({ where: { phone: fromToken } });
  if (!user) {
    return fail(
      4004,
      `这个手机号（${fromToken.slice(0, 3)}****${fromToken.slice(-4)}）还没绑过账号，换邮箱找回试试`,
      404,
    );
  }

  /*
   * 5. 已登录场景（「我的」页）的归属校验。
   *
   * 人从「我的」进来，本意是改**自己这个**账号的密码。如果他验证的是另一个
   * 号码（比如顺手输了自己另一张卡上的号），照做会得到一个「改好了」的提示，
   * 而实际改的是另一个账号 —— 这种「成功但改错对象」比报错更难排查。
   * 未登录场景（登录页忘记密码）没有这个问题，跳过即可。
   */
  const uid = await currentUserId();
  if (uid && uid !== user.id) {
    return fail(
      4003,
      "这个手机号绑的是另一个账号。本页只能改当前登录账号的密码；要改那个账号，请退出登录后用「忘记密码」",
      403,
    );
  }

  const hashed = await bcrypt.hash(body.newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, passwordSet: true },
  });

  // 旁路：云镜像与保险库各刷一份，换设备后仍能按手机号 / 邮箱认回这个账号
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
    phone: updated.phone,
    email: updated.email,
    passwordSet: true,
    /** 只影响换设备恢复，当前密码已生效 */
    mirrored: mirrored.ok,
    vaultReady: vaulted,
  });
});
