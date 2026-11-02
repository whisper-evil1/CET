import { NextResponse } from "next/server";
import type { ApiBody } from "@/lib/api-helpers";

/**
 * POST /api/logout —— 退出登录（绕开 NextAuth 的 signOut 内部回调）。
 *
 * 背景：NextAuth v5 的 signOut() 在反代 + 容器化部署下会尝试内部请求
 * 0.0.0.0:3000（容器内 next start 的监听地址），但该地址在容器里
 * 经常 ECONNREFUSED，导致 signOut 抛错。
 * 之前用 <form action={logout}> server action 也走不通：平台反代
 * 不支持 Next.js server action 的 POST 路由（带 Next-Action header），
 * 直接返回 404 HTML，前端 hydrate 时抛「Application error」白屏。
 *
 * 这里改成最朴素的方案：手动把 session cookie 设为空 + 立即过期，
 * 等价于登出。不依赖 NextAuth 内部机制，也不依赖 server action。
 * 前端 LogoutButton 用 fetch 调这个路由，成功后自己跳首页。
 */
export async function POST() {
  const res = NextResponse.json<ApiBody<{ ok: true }>>({
    code: 0,
    message: "ok",
    data: { ok: true },
  });

  // NextAuth v5 在 HTTPS 下用 __Secure- 前缀，HTTP 下不带前缀；
  // 两个都清一遍，覆盖任意部署形态。
  const cookieNames = [
    "__Secure-authjs.session-token",
    "authjs.session-token",
    "__Secure-authjs.callback-url",
    "authjs.callback-url",
  ];
  for (const name of cookieNames) {
    // path=/ 确保覆盖整个站点的 cookie；maxAge=0 立即过期
    res.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }

  return res;
}
