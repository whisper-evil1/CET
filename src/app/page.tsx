import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

/**
 * 首页：试卷列表 + 学习数据概览。
 * 直接在服务端用 Prisma 查询，避免首屏多一次 HTTP 往返。
 */
export default async function HomePage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const papers = await prisma.paper.findMany({
    orderBy: { sort: "asc" },
    include: {
      passages: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          _count: { select: { questions: true } },
        },
      },
    },
  });

  const [answers, vocabTotal, vocabMastered, favoriteCount] = await Promise.all([
    userId
      ? prisma.answer.findMany({
          where: { userId },
          select: {
            isCorrect: true,
            question: { select: { passage: { select: { paperId: true } } } },
          },
        })
      : Promise.resolve([]),
    userId ? prisma.vocabWord.count({ where: { userId } }) : Promise.resolve(0),
    userId ? prisma.vocabWord.count({ where: { userId, status: "mastered" } }) : Promise.resolve(0),
    userId ? prisma.favorite.count({ where: { userId } }) : Promise.resolve(0),
  ]);

  const answeredByPaper = new Map<string, { answered: number; correct: number }>();
  for (const answer of answers) {
    const paperId = answer.question.passage.paperId;
    const stat = answeredByPaper.get(paperId) ?? { answered: 0, correct: 0 };
    stat.answered += 1;
    if (answer.isCorrect) stat.correct += 1;
    answeredByPaper.set(paperId, stat);
  }

  const totalAnswered = answers.length;
  const totalCorrect = answers.filter((a) => a.isCorrect).length;
  const accuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const stats = [
    { label: "已作答", value: totalAnswered, unit: "题" },
    { label: "正确率", value: accuracy, unit: "%" },
    { label: "生词本", value: vocabTotal, unit: "词" },
    { label: "已掌握", value: vocabMastered, unit: "词" },
    { label: "收藏", value: favoriteCount, unit: "题" },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader active="home" />

      <main className="mx-auto max-w-[1180px] px-5 pb-24">
        {/* Hero：一句主张 + 一条细线，不做花哨动效 */}
        <section className="rise-in border-b border-line py-12 md:py-16">
          <p className="mb-4 text-[11px] tracking-[0.28em] text-accent uppercase">
            Left reads · Right answers
          </p>
          <h1 className="max-w-[16ch] font-serif text-[38px] leading-[1.15] tracking-tight text-ink md:text-[52px]">
            左边读原文，
            <br />
            右边答题，互不打扰。
          </h1>
          <p className="mt-6 max-w-[52ch] text-[15px] leading-[1.9] text-ink-soft">
            市面上的刷题 App 把文章和题目挤在一列，来回翻找就丢了上下文。
            这里把它们分开：两栏各自滚动，滚左边时右边纹丝不动；点任意单词就能查，
            查过的词自动进你的生词本，认识三次就算掌握。
          </p>

          {!userId && (
            <div className="mt-8 flex flex-wrap items-center gap-4 rounded-[10px] border border-line bg-surface px-5 py-4">
              <p className="text-[13px] text-ink-soft">
                登录后才会记录你的作答、生词与笔记。
                <span className="ml-2 font-mono text-[12px] text-ink-mute">
                  演示账号 demo@cet.local / demo1234
                </span>
              </p>
              <Link
                href="/login"
                className="ml-auto rounded-full bg-accent px-4 py-1.5 text-[13px] text-white transition-opacity hover:opacity-90"
              >
                登录
              </Link>
            </div>
          )}
        </section>

        {/* 数据概览 */}
        <section className="rise-in grid grid-cols-2 border-b border-line md:grid-cols-5 md:divide-x md:divide-line">
          {stats.map((stat) => (
            <div key={stat.label} className="px-1 py-6 md:px-5">
              <p className="text-[11px] tracking-[0.16em] text-ink-mute">{stat.label}</p>
              <p className="mt-2 font-serif text-[30px] leading-none text-ink">
                {stat.value}
                <span className="ml-1 text-[12px] text-ink-mute">{stat.unit}</span>
              </p>
            </div>
          ))}
        </section>

        {/* 试卷列表 */}
        <section className="mt-12">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-serif text-[22px] text-ink">试卷</h2>
            <span className="text-[12px] text-ink-mute">
              共 {papers.length} 套 · 每题都有解析、错项分析与 AI 答疑
            </span>
          </div>

          <ul className="border-t border-line">
            {papers.map((paper) => {
              const questionCount = paper.passages.reduce((sum, p) => sum + p._count.questions, 0);
              const stat = answeredByPaper.get(paper.id) ?? { answered: 0, correct: 0 };
              const progress = questionCount ? Math.round((stat.answered / questionCount) * 100) : 0;

              return (
                <li key={paper.id} className="border-b border-line">
                  <Link
                    href={`/practice/${paper.id}`}
                    className="group flex items-center gap-5 py-6 transition-colors hover:bg-paper-deep/60"
                  >
                    <span className="w-14 shrink-0 font-mono text-[11px] tracking-wider text-accent">
                      {paper.level}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[19px] text-ink group-hover:text-accent">
                        {paper.title}
                      </span>
                      <span className="mt-1 block truncate text-[12.5px] text-ink-mute">
                        {paper.passages
                          .map((p) => p.title)
                          .filter(Boolean)
                          .join(" · ")}{" "}
                        · {questionCount} 题
                      </span>
                    </span>

                    <span className="hidden w-40 shrink-0 sm:block">
                      <span className="mb-1.5 flex justify-between text-[11px] text-ink-mute">
                        <span>
                          {stat.answered}/{questionCount}
                        </span>
                        <span>正确 {stat.correct}</span>
                      </span>
                      <span className="block h-[3px] w-full bg-line-soft">
                        <span
                          className="block h-full bg-accent transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                    </span>

                    <span className="shrink-0 text-ink-mute transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {papers.length === 0 && (
            <p className="py-16 text-center text-[13px] text-ink-mute">
              还没有试卷数据，先运行 <code className="font-mono">npm run db:seed</code> 导入种子题库。
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
