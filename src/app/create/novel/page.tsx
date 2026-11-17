import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { NovelStudio } from "@/components/create/novel-studio";

export const dynamic = "force-dynamic";

export default async function CreateNovelPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await auth();
  const { id } = await searchParams;

  return (
    <div className="min-h-screen">
      <SiteHeader active="create" />
      <main className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-5">
        <section className="pt-6 sm:pt-8">
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/create" className="text-[11.5px] text-ink-mute hover:text-accent">
              ← 创作平台
            </Link>
            <span className="tile-rose rounded-full px-2 py-0.5 text-[11px]">小说英译改编</span>
          </div>
          <h1 className="mt-3 font-serif text-[24px] leading-tight text-ink sm:text-[28px]">
            中文一段，英文一段
          </h1>
          <p className="mt-2 max-w-[56ch] text-[12.5px] leading-[1.85] text-ink-soft sm:text-[13px]">
            不是逐字直译，是按英语读者的阅读习惯改写：保留情节与人物关系，
            处理称谓、节令、俗语，把中文的长句拆成英语能读下去的节奏。
          </p>
        </section>

        {session?.user ? (
          <NovelStudio workId={id} />
        ) : (
          <div className="card-soft mt-5 p-8 text-center">
            <p className="font-serif text-[17px] text-ink">登录后才能生成与保存</p>
            <p className="mx-auto mt-2 max-w-[34ch] text-[12.5px] leading-[1.8] text-ink-mute">
              生成按人限流，作品存在你自己的作品库里。
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block rounded-full bg-ink px-5 py-2 text-[13px] text-paper"
            >
              去登录
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
