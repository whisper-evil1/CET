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
      {/* 小屏适配：品牌 + 登录一行，导航独占第二行。
          之前 414px 宽下 nav 被挤到 33px，五个中文标签逐字竖排，手机上像乱码。
          用 flex-wrap + order 控制换行，sm 以上恢复单行原布局。 */}
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-6 sm:px-5 sm:py-0">
        <Link href="/" className="group order-1 flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <span className="font-serif text-[19px] tracking-tight text-ink">左文右题</span>
          <span className="hidden text-[10px] tracking-[0.22em] text-ink-mute uppercase sm:inline">
            CET Reading
          </span>
        </Link>

        <div className="order-2 ml-auto flex shrink-0 items-center gap-3 sm:order-3">
          {user ? (
            <Link
              href="/profile"
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] text-white">
                {(user.name ?? user.email ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[6em] truncate">{user.name ?? user.email}</span>
            </Link>
          ) : (
            <Link
              href="/login"
              className="shrink-0 whitespace-nowrap rounded-full bg-ink px-4 py-1.5 text-[13px] text-paper transition-opacity hover:opacity-85"
            >
              登录 / 注册
            </Link>
          )}
        </div>

        <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto sm:order-2 sm:ml-2 sm:w-auto sm:shrink">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1.5 text-[13px] transition-colors ${
                active === link.key
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
