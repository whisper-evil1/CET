import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

/**
 * 配对四连的外壳页（服务端组件）。
 *
 * 四个游戏页除了标题、标签、一句说明之外完全一样（顶栏 + 页头 + 游戏区 + 页脚提示），
 * 写四遍就会四处漂移。这里收成一处，页面文件只留「这一关是什么」。
 *
 * 不用 "use client"：这里没有任何交互，套上客户端指令会把它变成 client bundle 的一部分，
 * 白白多打一份 SiteHeader。
 */
export function GamePage({
  title,
  tag,
  desc,
  footer,
  children,
}: {
  title: string;
  tag: string;
  desc: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <SiteHeader active="arcade" />
      <main className="arcade-skin mx-auto max-w-[760px] px-4 pb-20 sm:px-5">
        <section className="pt-6 sm:pt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[24px] g-ink sm:text-[28px]">{title}</h1>
            <span className="rounded-full bg-[var(--game-blue-soft)] px-2 py-0.5 text-[11px] g-blue-deep">
              {tag}
            </span>
          </div>
          <p className="mt-2 max-w-[56ch] text-[12.5px] leading-[1.85] g-mute sm:text-[13px]">{desc}</p>
        </section>

        {children}

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] g-mute">
          <Link href="/arcade" className="g-blue hover:underline">
            ← 回游戏厅
          </Link>
          {footer}
        </div>
      </main>
    </div>
  );
}

/** 未登录时的统一挡板：四个游戏都要写回记忆曲线，所以都需要账号 */
export function LoginGate({ what }: { what: string }) {
  return (
    <div className="card-soft mt-5 p-8 text-center">
      <p className="font-serif text-[17px] g-ink">登录后才能开局</p>
      <p className="mx-auto mt-2 max-w-[38ch] text-[12.5px] leading-[1.8] g-mute">
        {what}的成绩要写回你的生词本记忆曲线，所以需要先登录。
      </p>
      <Link href="/login?next=/arcade" className="btn-game mt-5 inline-flex">
        去登录
      </Link>
    </div>
  );
}
