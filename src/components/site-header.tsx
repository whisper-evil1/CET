import Link from "next/link";
import { auth } from "@/lib/auth";

/**
 * 全站顶部导航（服务端组件，直接读会话）。
 * 刻意做得很轻：一根细线 + 字距很松的小字母，不抢正文的注意力。
 */
export async function SiteHeader({ active }: { active?: "home" | "vocab" | "favorites" | "profile" | "leaderboard" }) {
  const session = await auth();
  const user = session?.user;

  const links: { href: string; label: string; key: "home" | "vocab" | "favorites" | "leaderboard" | "profile" }[] = [
    { href: "/", label: "试卷", key: "home" },
    { href: "/vocab", label: "生词本", key: "vocab" },
    { href: "/favorites", label: "收藏", key: "favorites" },
    { href: "/leaderboard", label: "排行", key: "leaderboard" },
    { href: "/profile", label: "我的", key: "profile" },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-6 px-5">
        <Link href="/" className="group flex items-baseline gap-2">
          <span className="font-serif text-[19px] tracking-tight text-ink">左文右题</span>
          <span className="text-[10px] tracking-[0.22em] text-ink-mute uppercase">CET Reading</span>
        </Link>

        <nav className="ml-2 flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                active === link.key
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <Link
              href="/profile"
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] text-white">
                {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              {user.name ?? user.email}
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-ink px-4 py-1.5 text-[13px] text-paper transition-opacity hover:opacity-85"
            >
              登录 / 注册
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
