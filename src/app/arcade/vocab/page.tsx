import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { VocabGame } from "@/components/arcade/vocab-game";

export const dynamic = "force-dynamic";

export default async function ArcadeVocabPage() {
  const session = await auth();

  return (
    <div className="min-h-screen">
      <SiteHeader active="arcade" />
      <main className="arcade-skin mx-auto max-w-[760px] px-4 pb-20 sm:px-5">
        <section className="pt-6 sm:pt-8">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-serif text-[24px] g-ink sm:text-[28px]">趣味背单词</h1>
            <span className="tile-jade rounded-full px-2 py-0.5 text-[11px]">释义四选一</span>
          </div>
          <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.85] g-mute sm:text-[13px]">
            题目全部来自你的生词本，按优先级排序。答对 → 间隔拉长；答错或超时 → 10 分钟后再来一遍。
            一轮 10 词，每题 20 秒，连击有额外加分。
          </p>
        </section>

        {session?.user ? (
          <VocabGame />
        ) : (
          <div className="card-soft mt-5 p-8 text-center">
            <p className="font-serif text-[17px] g-ink">登录后才能开局</p>
            <p className="mx-auto mt-2 max-w-[34ch] text-[12.5px] leading-[1.8] g-mute">
              闯关成绩要写回你的生词本记忆曲线，所以需要先登录。
            </p>
            <Link
              href="/login"
              className="btn-game mt-5 inline-flex"
            >
              去登录
            </Link>
          </div>
        )}

        <p className="mt-5 text-[11.5px] text-ink-mute">
          想换词？<Link href="/vocab" className="text-accent underline-offset-2 hover:underline">去词书导词</Link>
          ，或去
          <Link href="/vocab?tab=import" className="mx-1 text-accent underline-offset-2 hover:underline">
            导入
          </Link>
          自己的词表。
        </p>
      </main>
    </div>
  );
}
