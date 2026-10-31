import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/favorites");

  const rows = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      question: {
        select: {
          id: true,
          number: true,
          stem: true,
          type: true,
          passage: {
            select: { title: true, paper: { select: { id: true, title: true, level: true } } },
          },
        },
      },
    },
  });

  const groups = new Map<
    string,
    {
      paperId: string;
      paperTitle: string;
      level: string;
      items: { id: string; number: number; stem: string; type: string | null }[];
    }
  >();

  for (const row of rows) {
    const paper = row.question.passage.paper;
    const group = groups.get(paper.id) ?? {
      paperId: paper.id,
      paperTitle: paper.title,
      level: paper.level,
      items: [],
    };
    group.items.push({
      id: row.question.id,
      number: row.question.number,
      stem: row.question.stem,
      type: row.question.type,
    });
    groups.set(paper.id, group);
  }

  return (
    <div className="min-h-screen">
      <SiteHeader active="favorites" />

      <main className="mx-auto max-w-[860px] px-5 pb-24">
        <div className="border-b border-line py-7">
          <h1 className="font-serif text-[26px] text-ink">收藏的题目</h1>
          <p className="mt-1.5 text-[12.5px] text-ink-mute">
            共 {rows.length} 道 · 点进去直达那道题
          </p>
        </div>

        {rows.length === 0 && (
          <div className="py-24 text-center">
            <p className="text-[13.5px] text-ink-soft">还没有收藏任何题目</p>
            <p className="mt-2 text-[12.5px] text-ink-mute">
              刷题时点右上角的 ☆，题就会出现在这里
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-full bg-ink px-5 py-2 text-[13px] text-paper"
            >
              去刷题
            </Link>
          </div>
        )}

        {[...groups.values()].map((group) => (
          <section key={group.paperId} className="mt-10">
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-accent">{group.level}</span>
              <h2 className="font-serif text-[17px] text-ink">{group.paperTitle}</h2>
            </div>

            <ul className="mt-3 border-t border-line">
              {group.items.map((item) => (
                <li key={item.id} className="border-b border-line">
                  <Link
                    href={`/practice/${group.paperId}?q=${item.id}`}
                    className="group flex items-start gap-4 py-4"
                  >
                    <span className="mt-0.5 font-mono text-[11px] text-ink-mute">
                      {item.number}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-serif text-[14.5px] leading-[1.6] text-ink group-hover:text-accent">
                        {item.stem}
                      </span>
                      {item.type && (
                        <span className="mt-1 inline-block rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-mute">
                          {item.type}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-ink-mute transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
