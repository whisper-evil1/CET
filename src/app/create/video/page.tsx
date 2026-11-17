import Link from "next/link";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { VideoStudio } from "@/components/create/video-studio";

export const dynamic = "force-dynamic";

export default async function CreateVideoPage({
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
            <span className="tile-sky rounded-full px-2 py-0.5 text-[11px]">短视频出海</span>
          </div>
          <h1 className="mt-3 font-serif text-[24px] leading-tight text-ink sm:text-[28px]">
            一条中文口播，两种海外平台
          </h1>
          <p className="mt-2 max-w-[56ch] text-[12.5px] leading-[1.85] text-ink-soft sm:text-[13px]">
            按平台的节奏重写：TikTok 前三秒就要给钩子，YouTube Shorts 的标题还得带检索词。
            产出是可拍可剪的英文发布包，不是视频文件。
          </p>
        </section>

        {session?.user ? (
          <VideoStudio workId={id} />
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
