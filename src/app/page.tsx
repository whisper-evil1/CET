import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

/** 进度环：SVG 描边，不依赖 conic-gradient，旧内核（Chrome 80 / Safari 13）表现一致 */
function Ring({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle className="ring-track" cx="32" cy="32" r={r} fill="none" strokeWidth="5" />
        <circle
          className="ring-value"
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-[17px] leading-none text-ink">{clamped}%</span>
        <span className="mt-0.5 text-[9px] tracking-wide text-ink-mute">{label}</span>
      </span>
    </div>
  );
}

/** 功能位的小印：单字方块，比 emoji 更贴纸感排版，也不会因字体缺失变豆腐块 */
function Seal({ char, tone }: { char: string; tone: string }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] font-serif text-[15px] ${tone}`}
    >
      {char}
    </span>
  );
}

type TaskRow = {
  label: string;
  hint: string;
  href: string;
  done: boolean;
};

/**
 * 首页 = 学习台。
 * v2.3 参考「学习 + 创作」类产品的信息节奏重排：先给主张与今日任务，再给三步学习、
 * 创作平台，最后才是试卷库与数据。试卷区仍是原来的左文右题入口，位置下移但没删。
 * 全部服务端渲染，除顶部导航外零客户端 JS。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const { level } = await searchParams;
  // 只认 CET4 / CET6，其余当全部
  const activeLevel = level === "CET4" || level === "CET6" ? level : null;

  const papers = await prisma.paper.findMany({
    where: { hidden: false, ...(activeLevel ? { level: activeLevel } : {}) },
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

  // 两级各自的卷子数，给 Tab 显示徽标
  const [cet4Count, cet6Count] = await Promise.all([
    prisma.paper.count({ where: { level: "CET4" } }),
    prisma.paper.count({ where: { level: "CET6" } }),
  ]);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [answers, vocabTotal, vocabMastered, favoriteCount] = await Promise.all([
    userId
      ? prisma.answer.findMany({
          where: { userId },
          select: {
            isCorrect: true,
            createdAt: true,
            question: { select: { passage: { select: { paperId: true } } } },
          },
        })
      : Promise.resolve([]),
    userId ? prisma.vocabWord.count({ where: { userId } }) : Promise.resolve(0),
    userId ? prisma.vocabWord.count({ where: { userId, status: "mastered" } }) : Promise.resolve(0),
    userId ? prisma.favorite.count({ where: { userId } }) : Promise.resolve(0),
  ]);

  const answeredByPaper = new Map<string, { answered: number; correct: number }>();
  let todayAnswered = 0;
  for (const answer of answers) {
    const paperId = answer.question.passage.paperId;
    const stat = answeredByPaper.get(paperId) ?? { answered: 0, correct: 0 };
    stat.answered += 1;
    if (answer.isCorrect) stat.correct += 1;
    answeredByPaper.set(paperId, stat);
    if (answer.createdAt >= startOfToday) todayAnswered += 1;
  }

  const totalAnswered = answers.length;
  const totalCorrect = answers.filter((a) => a.isCorrect).length;
  const accuracy = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const [dueVocab, todayCreations, creationCount] = await Promise.all([
    userId
      ? prisma.vocabWord.count({
          where: {
            userId,
            status: "learning",
            OR: [{ dueAt: null }, { dueAt: { lte: new Date() } }],
          },
        })
      : Promise.resolve(0),
    userId
      ? prisma.creation.count({ where: { userId, createdAt: { gte: startOfToday } } })
      : Promise.resolve(0),
    userId ? prisma.creation.count({ where: { userId } }) : Promise.resolve(0),
  ]);

  const stats = [
    { label: "已作答", value: totalAnswered, unit: "题" },
    { label: "正确率", value: accuracy, unit: "%" },
    { label: "生词本", value: vocabTotal, unit: "词" },
    { label: "已掌握", value: vocabMastered, unit: "词" },
    { label: "收藏", value: favoriteCount, unit: "题" },
    { label: "作品", value: creationCount, unit: "件" },
  ];

  // 今日任务：背 / 读 / 写各一件，做完一件算三分之一
  const tasks: TaskRow[] = [
    {
      label: "复习到期单词",
      hint: dueVocab > 0 ? `${dueVocab} 个在等你` : vocabTotal > 0 ? "今天清空了" : "还没建词库",
      href: dueVocab > 0 ? "/arcade/vocab" : "/vocab",
      done: dueVocab === 0 && vocabTotal > 0,
    },
    {
      label: "限时阅读 5 题",
      hint: `今日已答 ${todayAnswered} 题`,
      href: "/arcade/reading",
      done: todayAnswered >= 5,
    },
    {
      label: "一次改写或创作",
      hint: todayCreations > 0 ? `今日 ${todayCreations} 件` : "去创作平台开工",
      href: "/create",
      done: todayCreations > 0,
    },
  ];
  const doneCount = tasks.filter((t) => t.done).length;
  const taskPercent = (doneCount / tasks.length) * 100;

  return (
    <div className="min-h-screen">
      <SiteHeader active="home" />

      <main className="mx-auto max-w-[1180px] px-4 pb-20 sm:px-5">
        {/* ============ Hero：主张 + 今日任务 ============ */}
        <section className="card-soft hero-paper mt-5 overflow-hidden p-5 sm:mt-6 sm:p-7 lg:p-9">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_290px] lg:gap-9">
            <div className="min-w-0">
              <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">
                Read · Write · Tell it in English
              </p>
              <h1 className="mt-3 font-serif text-[30px] leading-[1.2] tracking-tight text-ink sm:text-[38px] lg:text-[42px]">
                用英语，讲好中国故事
              </h1>
              <p className="mt-3 max-w-[46ch] text-[13.5px] leading-[1.85] text-ink-soft sm:text-[14.5px]">
                左边读原文、右边答题的老规矩不变。新增三步：先把词背熟，再限时闯关读一篇，
                最后把中文写成英文——短文、小说片段、口播稿都能改成英语世界看得懂的样子。
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href="#papers"
                  className="rounded-full bg-ink px-5 py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-85"
                >
                  开始刷题
                </Link>
                <Link
                  href="/arcade"
                  className="rounded-full border border-line bg-surface px-5 py-2.5 text-[13.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  趣味闯关
                </Link>
                <Link
                  href="/create"
                  className="rounded-full border border-line bg-surface px-5 py-2.5 text-[13.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  成为创作者
                </Link>
              </div>
            </div>

            {/* 今日任务 */}
            <div className="rounded-[13px] border border-line bg-surface/90 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] font-medium text-ink">今日任务</p>
                <span className="font-mono text-[11px] text-ink-mute">
                  {doneCount}/{tasks.length}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Ring percent={taskPercent} label="完成" />
                <ul className="min-w-0 flex-1 space-y-2">
                  {tasks.map((task) => (
                    <li key={task.label}>
                      <Link href={task.href} className="group flex items-start gap-2">
                        <span
                          className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
                            task.done
                              ? "border-correct bg-correct text-white"
                              : "border-line text-transparent"
                          }`}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] text-ink-soft group-hover:text-ink">
                            {task.label}
                          </span>
                          <span className="block truncate text-[10.5px] text-ink-mute">
                            {task.hint}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              {!userId && (
                <Link
                  href="/login"
                  className="mt-3 block rounded-[9px] bg-accent-soft px-3 py-2 text-center text-[11.5px] text-accent transition-colors hover:bg-accent hover:text-white"
                >
                  登录后记录进度 · 演示 demo@cet.local / demo1234
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* ============ 学习三步 ============ */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-[19px] text-ink">学习三步</h2>
            <span className="flex items-center gap-3">
              <Link
                href="/vocab/stats"
                className="text-[12px] text-jade-ink transition-opacity hover:opacity-80"
              >
                单词数据面板 →
              </Link>
              <Link
                href="/arcade"
                className="text-[12px] text-ink-mute transition-colors hover:text-accent"
              >
                查看全部 →
              </Link>
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link
              href="/arcade/vocab"
              className="card-soft group flex items-start gap-3 p-4 transition-colors hover:border-accent/40"
            >
              <Seal char="词" tone="tile-jade" />
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[16px] text-ink">趣味背单词</span>
                <span className="mt-1 block text-[12px] leading-[1.7] text-ink-soft">
                  释义四选一 · 连击加分 · 答错回到队列
                </span>
                <span className="mt-2 block text-[11px] text-ink-mute">
                  {userId ? `待复习 ${dueVocab} 个` : "登录后按记忆曲线出题"}
                </span>
              </span>
            </Link>

            <Link
              href="/arcade/reading"
              className="card-soft group flex items-start gap-3 p-4 transition-colors hover:border-accent/40"
            >
              <Seal char="读" tone="tile-amber" />
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[16px] text-ink">趣味阅读闯关</span>
                <span className="mt-1 block text-[12px] leading-[1.7] text-ink-soft">
                  每题限时 · 答完即判 · 连对记连击
                </span>
                <span className="mt-2 block text-[11px] text-ink-mute">从卷库抽题，不另建题库</span>
              </span>
            </Link>

            <Link
              href="/arcade/writing"
              className="card-soft group flex items-start gap-3 p-4 transition-colors hover:border-accent/40"
            >
              <Seal char="写" tone="tile-indigo" />
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-[16px] text-ink">趣味写作 / 翻译</span>
                <span className="mt-1 block text-[12px] leading-[1.7] text-ink-soft">
                  当场写 · 逐句点评 · 指出具体该改的句子
                </span>
                <span className="mt-2 block text-[11px] text-ink-mute">中译英为主，附参考译本</span>
              </span>
            </Link>
          </div>
        </section>

        {/* ============ 创作平台 ============ */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-serif text-[19px] text-ink">创作平台</h2>
            <Link
              href="/create"
              className="text-[12px] text-ink-mute transition-colors hover:text-accent"
            >
              作品库{creationCount > 0 ? ` · ${creationCount} 件` : ""} →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Link
              href="/create/novel"
              className="card-soft group flex flex-col justify-between p-5 transition-colors hover:border-accent/40"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Seal char="译" tone="tile-rose" />
                  <span className="font-serif text-[17px] text-ink">小说英译改编</span>
                </div>
                <p className="mt-3 text-[12.5px] leading-[1.8] text-ink-soft">
                  把中文小说片段改成英语读者能读下去的版本：段级对照、专名表、改编说明，
                  文体可选文学化 / 简明英语 / 青少年向。
                </p>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-[11px] text-ink-mute">《红楼梦》片段也能试</span>
                <span className="text-[12px] text-accent">开始创作 →</span>
              </div>
            </Link>

            <Link
              href="/create/video"
              className="card-soft group flex flex-col justify-between p-5 transition-colors hover:border-accent/40"
            >
              <div>
                <div className="flex items-center gap-2">
                  <Seal char="影" tone="tile-sky" />
                  <span className="font-serif text-[17px] text-ink">短视频出海</span>
                </div>
                <p className="mt-3 text-[12.5px] leading-[1.8] text-ink-soft">
                  中文口播稿 → YouTube Shorts / TikTok 发布包：英文标题、开场钩子、
                  秒级分镜、字幕、话题标签、封面文案；标题超 60 字符会直接标出来。
                </p>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-[11px] text-ink-mute">30s / 60s 两档</span>
                <span className="text-[12px] text-accent">开始创作 →</span>
              </div>
            </Link>
          </div>
        </section>

        {/* ============ 试卷库（原有入口，位置下移） ============ */}
        <section id="papers" className="mt-10 scroll-mt-20">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-serif text-[19px] text-ink">试卷库</h2>
              <p className="mt-1 text-[11.5px] text-ink-mute">
                2021 年 6 月至 2026 年 6 月，每场三套；左文右题，点单词即查
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-line p-0.5 text-[12px]">
              <Link
                href="/"
                className={`rounded-full px-3 py-1 transition-colors ${
                  !activeLevel ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                }`}
              >
                全部
              </Link>
              <Link
                href="/?level=CET4"
                className={`rounded-full px-3 py-1 transition-colors ${
                  activeLevel === "CET4" ? "bg-accent text-white" : "text-ink-soft hover:text-ink"
                }`}
              >
                四级 · {cet4Count}
              </Link>
              <Link
                href="/?level=CET6"
                className={`rounded-full px-3 py-1 transition-colors ${
                  activeLevel === "CET6" ? "bg-accent text-white" : "text-ink-soft hover:text-ink"
                }`}
              >
                六级 · {cet6Count}
              </Link>
            </div>
          </div>

          <ul className="border-t border-line">
            {papers.map((paper) => {
              const questionCount = paper.passages.reduce((sum, p) => sum + p._count.questions, 0);
              const stat = answeredByPaper.get(paper.id) ?? { answered: 0, correct: 0 };
              const progress = questionCount ? Math.round((stat.answered / questionCount) * 100) : 0;
              const isDraft = paper.status !== "ready";

              // 正文没补齐的卷子不给入口：点进去是一张空卷，比不给入口更糟
              if (isDraft) {
                return (
                  <li key={paper.id} className="border-b border-line">
                    <div className="flex items-center gap-4 py-5 opacity-60 sm:gap-5 sm:py-6">
                      <span className="w-12 shrink-0 font-mono text-[11px] tracking-wider text-ink-mute sm:w-14">
                        {paper.level}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-serif text-[17px] text-ink-soft sm:text-[19px]">
                          {paper.title}
                        </span>
                        <span className="mt-1 block truncate text-[12px] text-ink-mute">
                          结构与考试大纲一致 · 正文待补，暂不可练
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-mute">
                        待补
                      </span>
                    </div>
                  </li>
                );
              }

              return (
                <li key={paper.id} className="border-b border-line">
                  <Link
                    href={`/practice/${paper.id}`}
                    className="group flex items-center gap-4 py-5 transition-colors hover:bg-paper-deep/60 sm:gap-5 sm:py-6"
                  >
                    <span className="w-12 shrink-0 font-mono text-[11px] tracking-wider text-accent sm:w-14">
                      {paper.level}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-[17px] text-ink group-hover:text-accent sm:text-[19px]">
                        {paper.title}
                      </span>
                      <span className="mt-1 flex items-center gap-2 truncate text-[12px] text-ink-mute">
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${
                            paper.origin === "official"
                              ? "bg-accent/10 text-accent"
                              : "bg-line-soft text-ink-soft"
                          }`}
                        >
                          {paper.origin === "official" ? "官方原题" : "仿真材料"}
                        </span>
                        <span className="truncate">
                          {paper.passages
                            .map((p) => p.title)
                            .filter(Boolean)
                            .join(" · ")}{" "}
                          · {questionCount} 题
                        </span>
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

                    <span className="shrink-0 font-mono text-[11px] text-ink-mute sm:hidden">
                      {progress}%
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

        {/* ============ 数据概览 ============ */}
        <section className="card-soft mt-10 p-5">
          <div className="grid grid-cols-3 gap-y-5 sm:grid-cols-6">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0 px-1">
                <p className="text-[10.5px] tracking-[0.14em] text-ink-mute">{stat.label}</p>
                <p className="mt-1.5 font-serif text-[22px] leading-none text-ink">
                  {stat.value}
                  <span className="ml-1 text-[11px] text-ink-mute">{stat.unit}</span>
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
            <p className="text-[11.5px] text-ink-mute">
              这些数字背后还有掌握度分布、复习趋势、记忆保持曲线
            </p>
            <Link
              href="/vocab/stats"
              className="text-[12px] text-accent transition-opacity hover:opacity-80"
            >
              打开单词数据面板 →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
