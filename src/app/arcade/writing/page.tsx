import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { WritingGame } from "@/components/arcade/writing-game";

export const dynamic = "force-dynamic";

export default async function ArcadeWritingPage() {
  const session = await auth();

  return (
    <div className="min-h-screen">
      <SiteHeader active="arcade" />
      <main className="arcade-skin mx-auto max-w-[760px] px-4 pb-20 sm:px-5">
        <section className="pt-6 sm:pt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[24px] g-ink sm:text-[28px]">趣味写作 / 翻译</h1>
            <span className="tile-indigo rounded-full px-2 py-0.5 text-[11px]">逐句点评</span>
          </div>
          <p className="mt-2 max-w-[54ch] text-[12.5px] leading-[1.85] g-mute sm:text-[13px]">
            题目取自卷库里的写作与翻译部分。写完点「让 AI 批改」：先给分档，再逐项指出问题，
            最后列出可以直接替换的句子。模型没连通时也会按字数、句长、衔接词、中文标点残留检查。
          </p>
        </section>

        {session?.user ? (
          <WritingGame />
        ) : (
          <div className="card-soft mt-5 p-8 text-center">
            <p className="font-serif text-[17px] g-ink">登录后才能提交批改</p>
            <p className="mx-auto mt-2 max-w-[34ch] text-[12.5px] leading-[1.8] g-mute">
              批改按人限流，需要先登录。
            </p>
            <Link
              href="/login"
              className="btn-game mt-5 inline-flex"
            >
              去登录
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
