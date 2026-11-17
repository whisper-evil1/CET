import { prisma } from "./prisma";
import type { CloudIdentity } from "./cloud-identity";
import { PHONE_RE, isPhone, normalizePhone, phoneEmail } from "./phone";

/**
 * 账号识别与绑定。
 *
 * 目标只有一个：**手机号和邮箱指向同一个账号**。
 *   - 用邮箱注册、在「我的」里绑了手机 → 以后手机号验证码登录，进的还是这个号；
 *   - 用手机号验证码注册、之后绑了邮箱 → 以后邮箱+密码登录，也是这个号。
 *
 * 历史包袱：验证码账号早期用 `${phone}@phone.local` 这种合成邮箱落库，
 * 认领时要把它也当成同一个人的候选，否则老用户会凭空多出一个空账号。
 *
 * 手机号在这一层一律先 normalizePhone：云端给的是 `+86 138…`，用户输入的是
 * `138…`，两种写法必须收敛成一种再去查库，否则「明明绑定了却找不到账号」。
 */

export { PHONE_RE, isPhone, phoneEmail };

/** 按「邮箱或手机号」找账号 */
export async function findUserByIdentifier(identifier: string) {
  const value = (identifier ?? "").trim().toLowerCase();
  if (!value) return null;
  // 用户可能手输 `+86 138…` 或带空格，先归一
  const asPhone = normalizePhone(value);
  if (isPhone(asPhone)) {
    return prisma.user.findUnique({ where: { phone: asPhone } });
  }
  return prisma.user.findUnique({ where: { email: value } });
}

/**
 * 验证码身份 → 本地账号。
 *
 * 顺序很重要：先手机号，再邮箱，最后才是历史合成邮箱。
 * 找到之后把缺的那一半补上，用户下次换个入口登录也能进同一个号。
 */
export async function resolveOtpAccount(identity: CloudIdentity) {
  // 云端手机号可能带 +86 前缀，入库前必须收敛成 11 位
  const phone = identity.phone ? normalizePhone(identity.phone) : null;
  const safePhone = phone && isPhone(phone) ? phone : null;
  const email = identity.email?.trim().toLowerCase() || null;

  let user = safePhone
    ? await prisma.user.findUnique({ where: { phone: safePhone } }).catch(() => null)
    : null;
  if (!user && email) user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (!user && safePhone) {
    // 老数据：只有合成邮箱，没有 phone 列
    user = await prisma.user.findUnique({ where: { email: phoneEmail(safePhone) } }).catch(() => null);
  }

  if (!user) return { user: null, created: false, linked: false };

  const patch: { phone?: string; email?: string } = {};
  if (safePhone && !user.phone) patch.phone = safePhone;
  // 合成邮箱可以被真邮箱替换；但绝不覆盖别的真邮箱
  if (email && user.email.endsWith("@phone.local")) patch.email = email;
  if (Object.keys(patch).length === 0) return { user, created: false, linked: false };

  try {
    const updated = await prisma.user.update({ where: { id: user.id }, data: patch });
    return { user: updated, created: false, linked: true };
  } catch {
    // 撞唯一约束：这个手机号/邮箱已经挂在别的账号上，保持原样，不要动数据
    return { user, created: false, linked: false };
  }
}

/**
 * 绑定前检查：这个手机号/邮箱是否已经被别人占用。
 * 自己已经绑着同一个值不算冲突。
 */
export async function assertBindable(
  userId: string,
  field: "phone" | "email",
  value: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const normalized = field === "phone" ? normalizePhone(value) : value.trim().toLowerCase();
  const owner =
    field === "phone"
      ? await prisma.user.findUnique({ where: { phone: normalized } }).catch(() => null)
      : await prisma.user.findUnique({ where: { email: normalized } }).catch(() => null);
  if (!owner || owner.id === userId) return { ok: true };
  return {
    ok: false,
    reason: field === "phone" ? "这个手机号已经绑在另一个账号上了" : "这个邮箱已经绑在另一个账号上了",
  };
}
