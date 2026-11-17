import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUserId } from "@/lib/auth";
import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/rate-limit";
import { syncAccountToCloud } from "@/lib/cloud-account-sync";
import { saveAccountToVault } from "@/lib/account-vault";
import { isPhone, normalizePhone, samePhone } from "@/lib/phone";
import { probeCloudIdentity } from "@/lib/cloud-identity";

const schema = z.object({
  phone: z.string().trim().refine(isPhone, "请输入正确的 11 位手机号"),
  /** 云端验证码换来的 accessToken：证明这个号码确实在他手上 */
  accessToken: z.string().min(20).max(4096),
  originHint: z.string().max(200).optional(),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("请输入正确的邮箱"),
  accessToken: z.string().min(20).max(4096),
  originHint: z.string().max(200).optional(),
});

/**
 * 绑定手机号 / 邮箱。
 *
 * 安全性来自「云端验证码」：客户端先用云 SDK 完成发码与验码，拿到 accessToken，
 * 服务端再拿这个 token 去云端换身份，确认 token 里的手机号（或邮箱）就是请求里这个。
 * 客户端自报的号码一律不信 —— 否则任何人都能把别人的号绑到自己账号上。
 *
 * 绑定成功后，同一个账号同时能用「邮箱+密码」和「手机号验证码」登录。
 */
export const POST = withApi(async (request: Request) => {
  const uid = await currentUserId();
  if (!uid) return Errors.unauthorized();

  const raw = (await request.clone().json().catch(() => ({}))) as { kind?: string };
  const kind = raw.kind === "email" ? "email" : "phone";

  if (!rateLimit(`bind:${uid}`, { windowMs: 60_000, max: 6 }).allowed) {
    return Errors.tooMany("绑定太频繁了，请稍后再试");
  }

  const body = await parseBody(request, kind === "phone" ? schema : emailSchema);
  const claimed =
    kind === "phone" ? (body as z.infer<typeof schema>).phone : (body as z.infer<typeof emailSchema>).email;

  const verified = await probeCloudIdentity(body.accessToken, body.originHint);
  if (!verified.ok) {
    return Errors.badRequest(`云端身份校验未通过（${verified.status ?? verified.reason}），请重新获取验证码`);
  }

  /*
   * 比对手机号必须按「号码」比，不能按字符串比。
   *
   * 云端返回的是 `+86 13800138000`，请求里带的是 `13800138000`，
   * 用户明明填的是同一个号，字符串比较却判不等 —— 这就是之前
   * 「验证码与绑定手机号不一致」的原因。samePhone 会先把两边都收敛成
   * 11 位本地号码再比。
   */
  if (kind === "phone") {
    if (!verified.identity.phone) {
      return Errors.badRequest("云端没有返回这个账号的手机号，请重新获取验证码再试");
    }
    if (!samePhone(verified.identity.phone, claimed)) {
      return Errors.badRequest(
        `验证码对应的号码是 ${normalizePhone(verified.identity.phone)}，与要绑定的 ${normalizePhone(claimed)} 不一致`,
      );
    }
  } else if (
    !verified.identity.email ||
    verified.identity.email.trim().toLowerCase() !== claimed.trim().toLowerCase()
  ) {
    return Errors.badRequest("验证码对应的邮箱与要绑定的不一致");
  }

  // 落库永远是 11 位本地号码：唯一索引才有意义，同一个号不会被绑两次
  const normalized = kind === "phone" ? normalizePhone(claimed) : claimed.trim().toLowerCase();
  const owner =
    kind === "phone"
      ? await prisma.user.findUnique({ where: { phone: normalized } }).catch(() => null)
      : await prisma.user.findUnique({ where: { email: normalized } }).catch(() => null);
  if (owner && owner.id !== uid) {
    return Errors.badRequest(
      kind === "phone" ? "这个手机号已经绑在另一个账号上了" : "这个邮箱已经绑在另一个账号上了",
    );
  }

  const current = await prisma.user.findUnique({ where: { id: uid } });
  if (!current) return Errors.unauthorized();

  // 绑邮箱时如果当前是合成邮箱（138…@phone.local），直接换成真邮箱，不需要额外确认
  const data =
    kind === "phone"
      ? { phone: normalized }
      : { email: normalized.endsWith("@phone.local") ? current.email : normalized };

  const updated = await prisma.user.update({ where: { id: uid }, data });

  // 凭据镜像与保险库都刷新一份：手机号恢复路径要能按号找到这个账号
  await syncAccountToCloud({
    localUserId: updated.id,
    email: updated.email,
    name: updated.name,
    passwordHash: updated.password,
    source: "login",
  });
  const vaulted = await saveAccountToVault(
    {
      userId: updated.id,
      email: updated.email,
      phone: updated.phone,
      name: updated.name,
      passwordHash: updated.password,
    },
    { force: true },
  );

  return ok({
    phone: updated.phone,
    email: updated.email,
    syntheticEmail: updated.email.endsWith("@phone.local"),
    vaultReady: vaulted,
  });
});
