import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "./prisma";
import { syncAccountToCloud } from "./cloud-account-sync";
import { probeCloudIdentity, type CloudIdentity } from "./cloud-identity";
import { logOtpEvent } from "./otp-log";
import { loadAccountFromVault, saveAccountToVault, type VaultRecord } from "./account-vault";
import { findUserByIdentifier, phoneEmail, resolveOtpAccount } from "./account-link";
import { normalizePhone } from "./phone";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(6).max(64),
});

/**
 * 验证码登录：客户端用云 SDK 完成「发码 → 验码」后拿到 accessToken，
 * 这里再用该 token 调云端 /v1/user/me 做**服务端**校验。
 *
 * 不能信任客户端自报的手机号/邮箱——那样任何人都能冒充任意号码登录。
 * token 由云端签发，校验通过才认为身份成立。
 */
const otpSchema = z.object({
  accessToken: z.string().min(20).max(4096),
  /** 浏览器当前来源，用于匹配 token 签发时的 Origin */
  originHint: z.string().max(200).optional(),
});

/** 验证码账号的本地邮箱键：有邮箱用邮箱，只有手机号则用合成邮箱保证唯一 */
function localEmailFor(identity: CloudIdentity): string {
  // 云端手机号带 +86，合成邮箱必须用归一后的 11 位，否则老账号认不回来
  const phone = identity.phone ? normalizePhone(identity.phone) : "";
  const email = identity.email ?? (phone ? phoneEmail(phone) : `${identity.id}@cloud.local`);
  return email.trim().toLowerCase();
}

/**
 * 认证：邮箱 + 密码。
 * 会话用 JWT（httpOnly cookie），所有服务端接口通过 auth() 拿 userId 做数据隔离，
 * 私密留言的权限判断只发生在服务端，前端拿不到别人的私密数据。
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? "dev-only-secret-change-me",
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "邮箱密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        /*
         * 账号栏可以填邮箱，也可以填手机号 —— 绑过手机号的账号两条路都通。
         * 用户记不住自己当初用哪个注册的，逼他猜「用哪种方式登录」是最没必要的摩擦。
         */
        const identifier = parsed.data.email;
        let user = await findUserByIdentifier(identifier);
        let matched = user ? await bcrypt.compare(parsed.data.password, user.password) : false;

        if (!matched) {
          /*
           * 本地库没有这个邮箱、或密码对不上时，去账号保险库捞一次。
           *
           * 「本地库没有」不等于「这个人没注册过」：发布沙箱重置运行时库之后，
           * 每个老用户都会走到这里。以前这里直接 return null，用户看到的是
           * 「邮箱或密码不对」，于是只能再注册一个新账号，旧的作答与生词全丢。
           * 现在用保险库里那份加密凭据校验，通过就地把账号重建回来（id 不变）。
           */
          user = await restoreAccountWithPassword(identifier, parsed.data.password);
          matched = Boolean(user);
        }

        if (!user || !matched) return null;

        // 老账号回填：云侧镜像只写不读，进程内用 Set 记住已同步的邮箱，
        // 同一个账号一个进程生命周期内最多打一次云，不会拖慢后续登录。
        await syncAccountToCloud({
          localUserId: user.id,
          email: user.email,
          name: user.name,
          passwordHash: user.password,
          source: "login",
        });

        // 保险库跟着密码一起更新：改过密码的账号也要能用新密码恢复
        void saveAccountToVault({
          userId: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          passwordHash: user.password,
        });

        return { id: user.id, email: user.email, name: user.name ?? null };
      },
    }),
    Credentials({
      id: "cloud-otp",
      name: "验证码登录",
      credentials: {
        accessToken: { label: "云会话令牌", type: "text" },
        originHint: { label: "来源", type: "text" },
      },
      async authorize(raw) {
        const parsed = otpSchema.safeParse(raw);
        if (!parsed.success) return null;

        const probe = await probeCloudIdentity(parsed.data.accessToken, parsed.data.originHint);
        logOtpEvent({
          stage: "provider",
          ok: probe.ok,
          status: probe.ok ? null : probe.status ?? null,
          reason: probe.ok ? null : probe.reason,
          origin: probe.ok ? probe.origin : parsed.data.originHint ?? null,
        });
        if (!probe.ok) return null;

        const identity = probe.identity;
        let user: Awaited<ReturnType<typeof prisma.user.findUnique>> = null;

        /*
         * 先按手机号/邮箱认领已有账号：绑过手机号的邮箱账号会在这里被找到，
         * 于是「验证码登录」和「邮箱密码登录」进的是同一个号，数据不分裂。
         */
        const resolved = await resolveOtpAccount(identity);
        if (resolved.user) {
          user = resolved.user;
          logOtpEvent({ stage: "db", ok: true, reason: resolved.linked ? "linked" : "found" });
        }

        if (!user) {
          // 验证码账号没有可用密码：写入随机 32 字节哈希，使密码登录不可能成功，
          // 但本地表结构（email + password 必填）无需改动。
          const unusablePassword = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
          const displayName =
            identity.name ?? (identity.phone ? `同学${identity.phone.slice(-4)}` : undefined);
          try {
            user = await prisma.user.create({
              data: {
                email: localEmailFor(identity),
                phone: identity.phone ? normalizePhone(identity.phone) : null,
                password: unusablePassword,
                // 验证码账号一开始没有密码，进「我的」可以自己设一个
                passwordSet: false,
                name: displayName,
              },
            });
            logOtpEvent({ stage: "db", ok: true, reason: "created" });
          } catch (error) {
            // 并发注册时可能撞唯一约束，回查一次即可
            user = await prisma.user.findUnique({ where: { email: localEmailFor(identity) } });
            if (!user) {
              logOtpEvent({
                stage: "db",
                ok: false,
                reason: error instanceof Error ? error.message.slice(0, 200) : "create_failed",
              });
            }
          }
        }

        if (!user) return null;

        // 验证码账号同样写一份云端镜像，否则云端只有密码登录的账号，
        // 表现为「后端一直没数据」。旁路执行，不阻塞登录。
        void syncAccountToCloud({
          localUserId: user.id,
          email: user.email,
          name: user.name,
          passwordHash: user.password,
          source: "login",
        });

        return { id: user.id, email: user.email, name: user.name ?? null };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});

/**
 * 会话是 JWT（无状态），所以「token 有效」并不等于「用户还在」。
 *
 * 这个区别曾经造成一整类线上故障：题库换版时运行时库被重建，User 表清空，
 * 但用户浏览器里 30 天有效期的 JWT 依然通过校验，于是 currentUserId() 返回了一个
 * 数据库里不存在的 id —— 后续所有写操作（提交答案、加入生词本）都因外键约束失败，
 * 对外表现为「页面正常显示，但一点操作就报服务器开小差」。
 *
 * 现在的约定：能拿到 uid 之后必须确认这行还在，不在就等同于未登录，
 * 让用户走一次重新登录（登录会自动补建/匹配账号），而不是把外键错误抛成 500。
 *
 * 校验结果缓存 60 秒：JWT 每个请求都要验，一次点开练习页会并发十几个接口，
 * 不缓存就等于每次操作多打十几次库。60 秒足够覆盖一次页面加载的全部并发，
 * 又短到「用户被删除」这种低频事件不会长期被忽略。
 * 排查问题时可设 CET_USER_CACHE_MS=0 关掉缓存。
 */
const USER_TTL_MS = Number(process.env.CET_USER_CACHE_MS ?? 60_000);
const verifiedUsers = new Map<string, number>();

async function userStillExists(uid: string): Promise<boolean> {
  if (USER_TTL_MS <= 0) {
    const row = await prisma.user
      .findUnique({ where: { id: uid }, select: { id: true } })
      .catch(() => null);
    return Boolean(row);
  }

  const expireAt = verifiedUsers.get(uid);
  if (expireAt && expireAt > Date.now()) return true;

  const row = await prisma.user
    .findUnique({ where: { id: uid }, select: { id: true } })
    .catch(() => null);

  if (!row) return false;

  // 只缓存「存在」的结果；不存在的每次都会重查，避免刚注册的账号被误判后长期锁死
  if (verifiedUsers.size > 2000) verifiedUsers.clear();
  verifiedUsers.set(uid, Date.now() + USER_TTL_MS);
  return true;
}

/** 服务端取当前用户 id；未登录、或会话指向的用户已不存在，都返回 null */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  if (!uid) return null;

  if (await userStillExists(uid)) return uid;

  /*
   * 走到这里说明会话还在、账号行没了 —— 发布沙箱重置运行时库后的典型状态。
   * 以前这里直接返回 null，用户会被踢回登录页（而且往往登不上，只能重注册）。
   * 现在拿会话里的邮箱去保险库认领一次：id 与邮箱都对得上才重建，
   * 重建后旧 JWT 依旧指向同一个人，作答与生词本跟着回来，用户完全无感。
   */
  const email = session?.user?.email;
  if (email) {
    const revived = await reviveAccount({ id: uid, email });
    if (revived) return revived.id;
  }
  return null;
}

/**
 * 用邮箱 + 密码从保险库恢复账号。
 *
 * 只在「本地库没有这个人」或「本地密码对不上」时调用。两个分支都要求
 * 保险库里的 bcrypt 摘要能通过校验 —— 恢复不等于绕过密码。
 */
async function restoreAccountWithPassword(identifier: string, password: string) {
  const record = await loadAccountFromVault(identifier);
  if (!record) return null;
  if (!(await bcrypt.compare(password, record.passwordHash))) return null;

  const key = identifier.trim().toLowerCase();
  // 保险库里存的手机号可能带 +86（老记录），查库前统一收敛
  const vaultPhone = record.phone ? normalizePhone(record.phone) : null;
  const existing =
    (await prisma.user.findUnique({ where: { email: key } }).catch(() => null)) ??
    (await prisma.user.findUnique({ where: { email: record.email } }).catch(() => null)) ??
    (vaultPhone ? await prisma.user.findUnique({ where: { phone: vaultPhone } }).catch(() => null) : null);

  if (existing) {
    // 本地这条密码已过期（例如整库重建后又被别人注册过）：以保险库这份为准
    if (existing.password !== record.passwordHash) {
      await prisma.user
        .update({ where: { id: existing.id }, data: { password: record.passwordHash } })
        .catch(() => {});
    }
    verifiedUsers.set(existing.id, Date.now() + USER_TTL_MS);
    return existing;
  }

  const base = {
    id: record.userId,
    email: record.email,
    password: record.passwordHash,
    name: record.name ?? record.email.split("@")[0] ?? "同学",
  };

  try {
    const created = await prisma.user.create({ data: { ...base, phone: vaultPhone } });
    verifiedUsers.set(created.id, Date.now() + USER_TTL_MS);
    return created;
  } catch {
    // 手机号可能被另一个账号占着：先只恢复邮箱身份，不要把对方的数据抢过来
    try {
      const created = await prisma.user.create({ data: base });
      verifiedUsers.set(created.id, Date.now() + USER_TTL_MS);
      return created;
    } catch {
      return prisma.user.findUnique({ where: { email: record.email } }).catch(() => null);
    }
  }
}

/**
 * 会话仍在、账号行缺失时按 id + 邮箱重建。
 *
 * 不校验密码：浏览器里那个签名有效的 JWT 本身就是身份证明。
 * 但要求保险库里的 userId 与 JWT 里的 uid 一致，避免把一个会话「接到」另一个账号上。
 */
async function reviveAccount({ id, email }: { id: string; email: string }) {
  const record = await loadAccountFromVault(email);
  if (!record || record.userId !== id) return null;

  const existing = await prisma.user.findUnique({ where: { id } }).catch(() => null);
  if (existing) {
    verifiedUsers.set(id, Date.now() + USER_TTL_MS);
    return existing;
  }
  // 同 id 但换了邮箱的极端情况：不要覆盖别人，直接放弃
  if (await prisma.user.findUnique({ where: { email: record.email } })) return null;

  try {
    const created = await prisma.user.create({
      data: {
        id,
        email: record.email,
        password: record.passwordHash,
        name: record.name ?? record.email.split("@")[0] ?? "同学",
      },
    });
    verifiedUsers.set(id, Date.now() + USER_TTL_MS);
    return created;
  } catch {
    return null;
  }
}
