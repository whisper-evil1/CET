"use server";

import { signOut } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * 退出登录：走服务端，不走客户端 fetch POST。
 * 之前用 next-auth/react 的 signOut({ callbackUrl }) 在反代环境下
 * 容易因为 CSRF token 或 POST 拦截导致页面崩溃，这里改成 server action。
 */
export async function logout() {
  // redirect: false 让 signOut 只清 cookie，不自己跳转，跳转交给下面的 redirect
  await signOut({ redirect: false });
  redirect("/");
}
