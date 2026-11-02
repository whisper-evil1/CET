"use client";

import { useState } from "react";
import { apiFetch, ApiError, PLATFORM_BLOCK_CODE } from "@/lib/api-client";

/**
 * 退出登录按钮（客户端组件）。
 *
 * 之前用 <form action={logout}> server action 触发，但在 workbuddy.host
 * 反代下走不通：平台不支持 Next.js server action 的 POST 路由（带
 * Next-Action header），直接返回 404 HTML，Next.js 客户端 hydrate 时
 * 解析失败抛「Application error」白屏（截图2 的根因）。
 *
 * 现在改成最朴素的客户端 fetch POST /api/logout，该路由手动清 session
 * cookie，不依赖 server action、也不依赖 NextAuth 的内部 signout 回调
 * （后者在容器内会 ECONNREFUSED）。成功后客户端自己跳首页。
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ ok: true }>("/api/logout", { method: "POST" });
      // 清成功后跳首页；用 sharecode 兜底，避免跳完又被平台 403
      const params = new URLSearchParams();
      const code = new URLSearchParams(window.location.search).get("sharecode");
      if (code) params.set("sharecode", code);
      const qs = params.toString();
      window.location.href = "/" + (qs ? "?" + qs : "");
    } catch (err) {
      // 平台拦截（sharecode/cookie 丢失）时 apiFetch 会自动触发跳转，
      // 这里只需要给用户一个可见的提示，不要静默
      if (err instanceof ApiError && err.code === PLATFORM_BLOCK_CODE) {
        setError("访问凭证已失效，正在重新打开分享链接…");
      } else {
        setError(err instanceof Error && err.message ? err.message : "退出失败，请重试");
      }
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-[11.5px] leading-snug text-wrong">{error}</span>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-wrong hover:text-wrong disabled:opacity-40"
      >
        {busy ? "退出中…" : "退出登录"}
      </button>
    </div>
  );
}
