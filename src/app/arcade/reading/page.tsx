import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { ReadingGame } from "@/components/arcade/reading-game";

export const dynamic = "force-dynamic";

export default async function ArcadeReadingPage() {
  const session = await auth();

  return (
    <div className="min-h-screen">
      <SiteHeader active="arcade" />
      <main className="arcade-skin mx-auto max-w-[820px] px-4 pb-20 sm:px-5">
        <section className="pt-6 sm:pt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[24px] g-ink sm:text-[28px]">趣味阅读闯关</h1>
            <span className="tile-amber rounded-full px-2 py-0.5 text-[11px]">限时 45 秒/题</span>
          </div>
          <p className="mt-2 max-w-[54ch] text-[12.5px] leading-[1.85] g-mute sm:text-[13px]">
            从卷库里随机抽 5 道客观题，先读原文再作答。答完立刻给对错与解析；
            超时只在本关计错，不会替你交空答案污染错题本。
          </p>
        </section>

        {session?.user ? (
          <ReadingGame />
        ) : (
          <div className="card-soft mt-5 p-8 text-center">
            <p className="font-serif text-[17px] g-ink">登录后才能开局</p>
            <p className="mx-auto mt-2 max-w-[34ch] text-[12.5px] leading-[1.8] g-mute">
              答题成绩要写进错题本与正确率统计，所以需要先登录。
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
