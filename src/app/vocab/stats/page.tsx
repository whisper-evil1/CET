import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { loadVocabAnalytics } from "@/lib/vocab-analytics";
import {
  CoverageBars,
  ForecastBars,
  MasteryDonut,
  RetentionBars,
  ReviewTrend,
} from "@/components/vocab/analytics-charts";

export const dynamic = "force-dynamic";

/**
 * 单词学习分析面板。
 *
 * 位置：挂在生词本下面（/vocab/stats），入口在生词本顶部、背单词结算面板、首页今日任务。
 * 之所以不塞进首页：首页是「今天该干什么」，这里是「我到底学成什么样」，
 * 两件事混在一屏会把今日任务的行动按钮挤下去。
 */
export default async function VocabStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/vocab/stats");

  const a = await loadVocabAnalytics(session.user.id);
  const empty = a.totals.total === 0;

  const kpis = [
    { label: "词库总量", value: a.totals.total, unit: "词", hint: `今日待复习 ${a.totals.dueToday}` },
    { label: "已掌握", value: a.totals.mastered, unit: "词", hint: `复习中 ${a.totals.learning - a.totals.fresh} · 未开始 ${a.totals.fresh}` },
    { label: "今日已复习", value: a.totals.reviewedToday, unit: "次", hint: `连续 ${a.totals.streakDays} 天` },
    {
      label: "近 7 日正确率",
      value: a.totals.accuracy7d == null ? "—" : a.totals.accuracy7d,
      unit: a.totals.accuracy7d == null ? "" : "%",
      hint: a.totals.logsTotal ? `样本 ${a.totals.logsTotal} 次` : "暂无记录",
    },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader active="vocab" />
      <main className="mx-auto w-full max-w-[1080px] px-4 pb-16 pt-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">Vocabulary Analytics</p>
            <h1 className="mt-1.5 font-serif text-[26px] leading-tight text-ink sm:text-[30px]">单词学习数据</h1>
            <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.8] text-ink-soft">
              每一格都来自你的真实复习记录：掌握度看词的状态，趋势看每天的复习量，
              记忆保持看「间隔拉长之后还记得多少」。
            </p>
          </div>
          <Link
            href="/vocab"
            className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
          >
            ← 回生词本
          </Link>
        </div>

        {empty ? (
          <section className="card-soft mt-6 p-6 text-center">
            <p className="font-serif text-[17px] text-ink">词库还是空的</p>
            <p className="mx-auto mt-2 max-w-[44ch] text-[12.5px] leading-[1.9] text-ink-soft">
              先去词书导一批词，或者去刷一套真题、把不认识的词点进来。
              只要有过一次复习，这里的图就会开始长数据。
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              <Link
                href="/vocab"
                className="rounded-[10px] bg-accent px-4 py-2 text-[12.5px] text-white transition-opacity hover:opacity-90"
              >
                去导入词书
              </Link>
              <Link
                href="/arcade/vocab"
                className="rounded-[10px] border border-line px-4 py-2 text-[12.5px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
              >
                先玩一关词
              </Link>
            </div>
          </section>
        ) : (
          <>
            {/* KPI */}
            <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kpis.map((k) => (
                <div key={k.label} className="card-soft p-4">
                  <p className="text-[11px] text-ink-mute">{k.label}</p>
                  <p className="mt-1.5 flex items-baseline gap-1">
                    <span className="font-serif text-[26px] leading-none text-ink">{k.value}</span>
                    <span className="text-[11.5px] text-ink-mute">{k.unit}</span>
                  </p>
                  <p className="mt-1.5 text-[10.5px] text-ink-mute">{k.hint}</p>
                </div>
              ))}
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <div className="card-soft flex flex-col p-5">
                <h2 className="font-serif text-[16px] text-ink">掌握度分布</h2>
                <p className="mt-1 text-[11px] text-ink-mute">按词的状态统计，与生词本筛选一致</p>
                <div className="mt-4 flex flex-1 items-center">
                  <MasteryDonut
                    mastered={a.totals.mastered}
                    learning={a.totals.learning}
                    fresh={a.totals.fresh}
                  />
                </div>
              </div>
              <div className="card-soft flex flex-col p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-serif text-[16px] text-ink">近 14 天复习量</h2>
                  <span className="font-mono text-[11px] text-ink-mute">正确 / 错误堆叠</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-mute">每根柱子是一天的复习次数</p>
                <div className="mt-4 flex flex-1 items-end">
                  <ReviewTrend trend={a.trend} />
                </div>
              </div>
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="card-soft flex flex-col p-5">
                <h2 className="font-serif text-[16px] text-ink">记忆保持曲线</h2>
                <p className="mt-1 text-[11px] text-ink-mute">间隔越长还记得住，说明这个词真的进长期记忆了</p>
                <div className="mt-4 flex flex-1 items-center">
                  <RetentionBars retention={a.retention} />
                </div>
              </div>
              <div className="card-soft flex flex-col p-5">
                <h2 className="font-serif text-[16px] text-ink">未来 7 天到期预测</h2>
                <p className="mt-1 text-[11px] text-ink-mute">按记忆曲线的到期时间排，规划每天复习量用</p>
                <div className="mt-4 flex flex-1 items-end">
                  <ForecastBars forecast={a.forecast} />
                </div>
              </div>
            </section>

            <section className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="card-soft flex flex-col p-5">
                <h2 className="font-serif text-[16px] text-ink">词频与考纲覆盖</h2>
                <p className="mt-1 text-[11px] text-ink-mute">分母是该档位的词数，分子是其中复习过的</p>
                <div className="mt-4 flex flex-1 flex-col justify-center">
                  <CoverageBars coverage={a.coverage} />
                </div>
              </div>
              <div className="card-soft flex flex-col p-5">
                <h2 className="font-serif text-[16px] text-ink">最容易忘的词</h2>
                <p className="mt-1 text-[11px] text-ink-mute">按累计遗忘次数排序，优先回炉</p>
                {a.hardest.length === 0 ? (
                  <p className="mt-4 text-[12.5px] text-ink-mute">还没有反复忘的词，保持住。</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {a.hardest.map((w) => (
                      <li key={w.id} className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 last:border-0 last:pb-0">
                        <span className="min-w-0 truncate font-mono text-[13px] text-ink">{w.word}</span>
                        <span className="shrink-0 text-[11px] text-ink-mute">
                          忘 {w.lapses} 次 · 复习 {w.reviewCount} 次
                          {w.status === "mastered" ? " · 已掌握" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {a.bySource.length > 0 && (
                  <div className="mt-4 border-t border-line-soft pt-3">
                    <p className="text-[11px] text-ink-mute">词从哪来</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.bySource.map((s) => (
                        <span key={s.source} className="rounded-full bg-tint-jade px-2.5 py-1 text-[11px] text-jade-ink">
                          {s.label} {s.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <p className="mt-5 text-[11px] leading-relaxed text-ink-mute">
              数据口径：掌握度与到期预测取自当前词库快照；趋势、记忆保持、连续天数取自复习流水，
              流水自 v2.4 起记录，因此更早的复习不会出现在曲线上。
            </p>
          </>
        )}
      </main>
    </div>
  );
}
