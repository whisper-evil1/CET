import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "./prisma";
import { syncAccountToCloud } from "./cloud-account-sync";
import { verifyCode } from "./email-code";

/**
 * 登录凭据：密码 或 邮箱验证码，二选一。
 *
 * 两者都不是必填，但 authorize 里保证「至少有一个且能验过」——
 * 如果把 password 写成 min(6) 必填，验证码登录会先被 zod 挡掉；
 * 如果全 optional 又不判，空凭据也能进，等于没有认证。
 */
const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(3),
  password: z.string().min(6).max(64).optional(),
  code: z.string().trim().min(6).max(6).optional(),
});

/**
 * 认证：邮箱 + 密码 / 邮箱 + 验证码。
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
        code: { label: "验证码", type: "text" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email } = parsed.data;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        if (parsed.data.code) {
          // 验证码登录：码对不对交给 email-code 判（含过期、试错次数上限、一次性）
          const verified = verifyCode(email, "login", parsed.data.code);
          if (!verified.ok) return null;
        } else {
          if (!parsed.data.password) return null;
          const matched = await bcrypt.compare(parsed.data.password, user.password);
          if (!matched) return null;
        }

        // 老账号回填：云侧镜像只写不读，进程内用 Set 记住已同步的邮箱，
        // 同一个账号一个进程生命周期内最多打一次云，不会拖慢后续登录。
        await syncAccountToCloud({
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

/** 服务端取当前用户 id；未登录返回 null */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
