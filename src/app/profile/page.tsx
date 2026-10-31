import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/profile");

  const [user, vocabTotal, vocabMastered, favoriteCount, answers, recent] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, createdAt: true },
    }),
    prisma.vocabWord.count({ where: { userId } }),
    prisma.vocabWord.count({ where: { userId, status: "mastered" } }),
    prisma.favorite.count({ where: { userId } }),
    prisma.answer.findMany({ where: { userId }, select: { isCorrect: true } }),
    prisma.answer.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        isCorrect: true,
        createdAt: true,
        question: {
          select: {
            number: true,
            passage: { select: { paper: { select: { id: true, title: true } } } },
          },
        },
      },
    }),
  ]);

  const answeredCount = answers.length;
  const correctCount = answers.filter((a) => a.isCorrect).length;
  const accuracy = answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0;

  const stats = [
    { label: "已作答", value: answeredCount },
    { label: "正确率", value: `${accuracy}%` },
    { label: "生词", value: vocabTotal },
    { label: "已掌握", value: vocabMastered },
    { label: "收藏", value: favoriteCount },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader active="profile" />

      <main className="mx-auto max-w-[860px] px-5 pb-24">
        <section className="flex items-end justify-between border-b border-line py-8">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent font-serif text-[19px] text-white">
              {(user?.name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h1 className="font-serif text-[24px] text-ink">{user?.name ?? "同学"}</h1>
              <p className="mt-1 font-mono text-[11.5px] text-ink-mute">{user?.email}</p>
            </div>
          </div>
          <LogoutButton />
        </section>

        <section className="grid grid-cols-2 border-b border-line sm:grid-cols-5 sm:divide-x sm:divide-line">
          {stats.map((stat) => (
            <div key={stat.label} className="py-6 sm:px-5">
              <p className="text-[11px] tracking-[0.14em] text-ink-mute">{stat.label}</p>
              <p className="mt-1.5 font-serif text-[26px] leading-none text-ink">{stat.value}</p>
            </div>
          ))}
        </section>

        <section className="mt-10">
          <h2 className="font-serif text-[18px] text-ink">最近的作答</h2>
          <ul className="mt-3 border-t border-line">
            {recent.length === 0 && (
              <li className="py-14 text-center text-[13px] text-ink-mute">
                还没有作答记录，去首页挑一套卷子开始吧
              </li>
            )}
            {recent.map((item, index) => (
              <li
                key={`${item.question.number}-${index}`}
                className="flex items-center gap-3 border-b border-line py-3.5 text-[12.5px]"
              >
                <span
                  className={`font-mono text-[11px] ${
                    item.isCorrect ? "text-correct" : "text-wrong"
                  }`}
                >
                  {item.isCorrect ? "✓" : "✕"}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  {item.question.passage.paper.title} · 第 {item.question.number} 题
                </span>
                <span className="font-mono text-[11px] text-ink-mute">
                  {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-[11.5px] leading-relaxed text-ink-mute">
          账号创建于 {user?.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-CN") : "—"}。
          所有作答、生词与笔记都只属于这个账号，私密笔记对其他账号不可见。
        </p>
      </main>
    </div>
  );
}
