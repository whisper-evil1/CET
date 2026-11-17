import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { CreateHub, type HubWork } from "@/components/create/create-hub";

export const dynamic = "force-dynamic";

function previewOf(kind: string, output: string): string {
  try {
    const data = JSON.parse(output) as Record<string, unknown>;
    if (kind === "novel") {
      const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
      const first = paragraphs[0] as { en?: string; zh?: string } | undefined;
      return ((first?.en || first?.zh || "") as string).slice(0, 90);
    }
    const hooks = Array.isArray(data.hooks) ? data.hooks : [];
    const first = typeof hooks[0] === "string" ? (hooks[0] as string) : "";
    return first.slice(0, 90) || String(data.coverText ?? "").slice(0, 90);
  } catch {
    return "";
  }
}

/**
 * 创作中心首页。
 *
 * 页面结构对齐参考图：顶部双渐变「创作平台」卡片 + 下方的作品 tab 网格。
 * 样式沿用本站纸感设计系统（衬线标题 / 朱砂强调 / 低饱和页签色），
 * 不引入截图里的高饱和渐变——那是另一套品牌语言，硬搬会和阅读区打架。
 */
export default async function CreateHubPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const rows: HubWork[] = userId
    ? (
        await prisma.creation.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          take: 24,
          select: { id: true, kind: true, title: true, createdAt: true, output: true },
        })
      ).map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        preview: previewOf(row.kind, row.output),
      }))
    : [];

  return (
    <div className="min-h-screen">
      <SiteHeader active="create" />
      <main className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-5">
        <section className="pt-7 sm:pt-9">
          <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">Creation Studio</p>
          <h1 className="mt-2 font-serif text-[26px] leading-tight text-ink sm:text-[34px]">
            用英语，讲好中国故事
          </h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-[1.85] text-ink-soft sm:text-[14px]">
            学习 × 创作 × 连接世界。把中文小说改成海外读得懂的英文，把国内短视频转成可发布的英文成片。
            生成结果自动存进作品库，随时回来接着改。
          </p>
        </section>

        {/* 创作平台双卡：对齐参考图 11「创作平台卡片」的结构语言 */}
        <section className="mt-7 grid gap-4 md:grid-cols-2" aria-label="创作平台入口">
          <Link href="/create/novel" className="hub-entry hub-entry-novel">
            <div className="hub-entry-top">
              <span className="hub-entry-eyebrow">NOVEL · TRANSLATION</span>
              <span className="hub-entry-mark" aria-hidden>译</span>
            </div>
            <div className="hub-entry-main">
              <h2 className="hub-entry-title">小说翻译创作</h2>
              <p className="hub-entry-lead">
                把中国故事翻译成世界语言<br className="hidden sm:block" />让世界读懂中国
              </p>
            </div>
            <div className="hub-entry-foot">
              <span className="hub-entry-cta">开始创作 →</span>
              <span className="hub-entry-deco" aria-hidden>书</span>
            </div>
          </Link>

          <Link href="/create/video" className="hub-entry hub-entry-video">
            <div className="hub-entry-top">
              <span className="hub-entry-eyebrow">SHORT VIDEO · GLOBAL</span>
              <span className="hub-entry-mark" aria-hidden>影</span>
            </div>
            <div className="hub-entry-main">
              <h2 className="hub-entry-title">短视频出海创作</h2>
              <p className="hub-entry-lead">
                把精彩的中国内容<br className="hidden sm:block" />制作成全球可发布的视频
              </p>
            </div>
            <div className="hub-entry-foot">
              <span className="hub-entry-cta">开始创作 →</span>
              <span className="hub-entry-deco" aria-hidden>影</span>
            </div>
          </Link>
        </section>

        {/* 拍照搜题保留为窄条入口：它是真实功能，不因改版丢掉 */}
        <Link href="/solve/photo" className="hub-solve-strip">
          <span className="hub-solve-badge" aria-hidden>拍</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">拍照搜题</span>
            <span className="block text-[11.5px] text-ink-mute">
              不会的题拍下来，Agent 识别后分步讲解；看不清会请你补拍，不硬猜答案
            </span>
          </span>
          <span className="text-[11.5px] text-accent">去搜题 →</span>
        </Link>

        <CreateHub works={rows} signedIn={Boolean(userId)} />
      </main>
    </div>
  );
}
