"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 全局 error boundary：兜底所有 page 子树的运行时异常。
 *
 * 主要场景：
 *   - /profile 在反代下 server action 失败后抛「Application error」白屏
 *   - 任何 client component hydration 异常
 *   - 服务端渲染时 prisma 抛错的极端情况（虽然 withApi 已兜底 API 层）
 *
 * error.tsx 不捕获 layout.tsx 自身的错误（那需要 global-error.tsx），
 * 但页面级白屏它都能接住。这里给一个友好的错误页 + 回首页入口，
 * 避免用户面对 Next.js 默认的「Application error」英文页。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 上报到服务端日志（Next.js 会把 console.error 转成服务端日志）
    console.error("[app-error]", error);
  }, [error]);

  // 拿当前 URL 上的 sharecode，回首页时带上，避免再次被平台 403
  const sharecode =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("sharecode")
      : null;
  const homeHref = sharecode ? `/?sharecode=${encodeURIComponent(sharecode)}` : "/";

  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-[11px] tracking-[0.28em] text-ink-mute uppercase">Something went wrong</p>
      <h1 className="mt-4 font-serif text-[28px] leading-tight text-ink">
        页面出了点小问题
      </h1>
      <p className="mt-4 text-[14px] leading-[1.8] text-ink-soft">
        可能是网络波动，或分享链接的访问凭证失效了。
        <br />
        先回首页试试；如果反复出现，请重新打开分享链接。
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-ink px-5 py-2 text-[13px] text-paper transition-opacity hover:opacity-85"
        >
          重试当前页
        </button>
        <Link
          href={homeHref}
          className="rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
        >
          回首页
        </Link>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-[11px] text-ink-mute">错误编号：{error.digest}</p>
      )}
    </div>
  );
}
