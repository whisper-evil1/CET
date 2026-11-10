import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { DeleteWorkButton } from "@/components/create/delete-work-button";

export const dynamic = "force-dynamic";

type WorkCard = {
  id: string;
  kind: string;
  title: string;
  createdAt: Date;
  preview: string;
};

function previewOf(kind: string, output: string): string {
  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    if (kind === "novel") {
      const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
      const first = paragraphs[0] as { en?: string; zh?: string } | undefined;
      const text = (first?.en || first?.zh || "") as string;
      return text.slice(0, 90);
    }
    const hooks = Array.isArray(data.hooks) ? data.hooks : [];
    const first = typeof hooks[0] === "string" ? (hooks[0] as string) : "";
    return first.slice(0, 90) || String(data.coverText ?? "").slice(0, 90);
  } catch {
    return "";
  }
}

export default async function CreateHubPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const works: WorkCard[] = userId
    ? (
        await prisma.creation.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          take: 12,
          select: { id: true, kind: true, title: true, createdAt: true, output: true },
        })
      ).map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        createdAt: row.createdAt,
        preview: previewOf(row.kind, row.output),
      }))
    : [];

  return (
    <div className="min-h-screen">
      <SiteHeader active="create" />
      <main className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-5">
        <section className="pt-7 sm:pt-9">
          <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">Create</p>
          <h1 className="mt-2 font-serif text-[26px] leading-tight text-ink sm:text-[32px]">
            把中国的故事，写成英语世界读得懂的样子
          </h1>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-[1.85] text-ink-soft sm:text-[14px]">
            两个工作台：一个是小说英译改编，段级对照、可导出；一个是短视频出海，
            直接产出 YouTube Shorts / TikTok 的英文发布包。生成的每一件都能存进作品库。
          </p>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-2">
          <Link
            href="/create/novel"
            className="card-soft group flex flex-col justify-between p-5 transition-colors hover:border-accent/40"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="tile-rose flex h-10 w-10 items-center justify-center rounded-[10px] font-serif text-[17px]">
                  译
                </span>
                <h2 className="font-serif text-[18px] text-ink">小说英译改编</h2>
              </div>
              <ul className="mt-3 space-y-1.5 text-[12.5px] leading-[1.75] text-ink-soft">
                <li>· 段级左右对照，改没改丢一眼看得出来</li>
                <li>· 文体三档：文学化 / 简明英语（B1）/ 青少年向</li>
                <li>· 专名表 + 改编说明；可导出 Markdown</li>
              </ul>
            </div>
            <p className="mt-4 text-[12px] text-accent">打开工作台 →</p>
          </Link>

          <Link
            href="/create/video"
            className="card-soft group flex flex-col justify-between p-5 transition-colors hover:border-accent/40"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="tile-sky flex h-10 w-10 items-center justify-center rounded-[10px] font-serif text-[17px]">
                  影
                </span>
                <h2 className="font-serif text-[18px] text-ink">短视频出海</h2>
              </div>
              <ul className="mt-3 space-y-1.5 text-[12.5px] leading-[1.75] text-ink-soft">
                <li>· 英文标题（≤60 字符，超了会标红）</li>
                <li>· 3 个开场钩子 + 秒级分镜 + 字幕</li>
                <li>· 话题标签 / 封面文案 / 发布描述</li>
              </ul>
            </div>
            <p className="mt-4 text-[12px] text-accent">打开工作台 →</p>
          </Link>
        </section>

        <section className="mt-9">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-[19px] text-ink">作品库</h2>
            <span className="text-[11.5px] text-ink-mute">
              {userId ? `最近 ${works.length} 件` : "登录后显示"}
            </span>
          </div>

          {!userId && (
            <div className="card-soft p-6 text-center">
              <p className="text-[12.5px] text-ink-soft">登录后保存的作品会出现在这里。</p>
              <Link
                href="/login"
                className="mt-3 inline-block rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper"
              >
                去登录
              </Link>
            </div>
          )}

          {userId && works.length === 0 && (
            <div className="card-soft p-6 text-center">
              <p className="text-[12.5px] text-ink-soft">还没有作品。上面选一个工作台开始。</p>
            </div>
          )}

          {works.length > 0 && (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {works.map((work) => (
                <li key={work.id} className="card-soft p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] ${
                          work.kind === "novel" ? "tile-rose" : "tile-sky"
                        }`}
                      >
                        {work.kind === "novel" ? "小说英译" : "短视频"}
                      </span>
                      <p className="mt-1.5 truncate font-serif text-[15px] text-ink">
                        {work.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.7] text-ink-mute">
                        {work.preview || "（无预览）"}
                      </p>
                    </div>
                    <DeleteWorkButton id={work.id} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/create/${work.kind}?id=${work.id}`}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                    >
                      打开
                    </Link>
                    <span className="text-[10.5px] text-ink-mute">
                      {new Date(work.createdAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
