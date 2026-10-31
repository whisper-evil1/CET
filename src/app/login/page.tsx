import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const { next } = await searchParams;

  if (session?.user) redirect(next && next.startsWith("/") ? next : "/");

  return (
    <main className="grid min-h-screen md:grid-cols-[1fr_minmax(420px,46%)]">
      {/* 左侧：说清楚这个产品是什么，登录页也不浪费 */} 
      <section className="hidden flex-col justify-between border-r border-line bg-paper p-12 md:flex">
        <div>
          <p className="font-serif text-[15px] tracking-tight text-ink">左文右题</p>
          <p className="mt-1 text-[10.5px] tracking-[0.24em] text-ink-mute uppercase">
            CET Reading Practice
          </p>
        </div>

        <div>
          <h1 className="max-w-[18ch] font-serif text-[36px] leading-[1.2] text-ink">
            刷题的时候，
            <br />
            别再来回翻页了。
          </h1>
          <p className="mt-5 max-w-[42ch] text-[13.5px] leading-[1.9] text-ink-soft">
            左边文章独立滚动，右边题目独立滚动，两边互不影响。
            点单词即查、查过自动进生词本，每题都能问 AI 和写自己的笔记。
          </p>
        </div>

        <div className="flex items-center gap-4 text-[11.5px] text-ink-mute">
          <span>两栏独立滚动</span>
          <span className="h-3 w-px bg-line" />
          <span>生词自动复习</span>
          <span className="h-3 w-px bg-line" />
          <span>私密笔记</span>
        </div>
      </section>

      {/* 右侧：表单 */}
      <section className="flex items-center justify-center px-6 py-12">
        <Suspense fallback={null}>
          <LoginForm nextPath={next ?? "/"} />
        </Suspense>
      </section>
    </main>
  );
}
