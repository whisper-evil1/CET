import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth";
import { loadVocabAnalytics, type VocabAnalytics } from "@/lib/vocab-analytics";
import {
  BadgeIcon,
  BannerArt,
  BlastArt,
  BlastLevelsArt,
  FlappyArt,
  GuardArt,
  ListenArt,
  MemoryArt,
  MilestonePath,
  MilestoneRow,
  MoleArt,
  ReadingArt,
  SentenceArt,
  SnakeArt,
  SpellArt,
  SprintArt,
  VocabArt,
  WritingArt,
} from "@/components/arcade/arcade-art";

export const dynamic = "force-dynamic";

const GAMES = [
  {
    href: "/arcade/vocab",
    title: "趣味背单词",
    desc: "释义四选一，20 秒一题，3 条命。答对拉长间隔，答错 10 分钟后再来。",
    art: "art-jade",
    Art: VocabArt,
    tag: "记忆曲线",
  },
  {
    href: "/arcade/reading",
    title: "趣味阅读闯关",
    desc: "从卷库里随机抽 5 题，每题 45 秒，答完即判并给解析。",
    art: "art-amber",
    Art: ReadingArt,
    tag: "错题回炉",
  },
  {
    href: "/arcade/writing",
    title: "趣味写作 / 翻译",
    desc: "当场写、当场批改：限时 15 分钟，逐项给分并指出该改的句子。",
    art: "art-violet",
    Art: WritingArt,
    tag: "AI 批改",
  },
];

/**
 * 配对四连：从参考站（cet-reading-games）移植的四个配对类玩法。
 *
 * 为什么和上面三关分开列：上面是「完整题型」（词 / 读 / 写，各管一条学习链路），
 * 这四个是「同一批词换四种手感玩」，本质都是词 ↔ 释义的配对，
 * 混排在一起会让人以为有七个不同目标。分组之后语义清楚：
 * 三关定方向，配对四连练手速和反应。
 */
const MATCH_GAMES = [
  {
    href: "/arcade/blast",
    title: "词义消除",
    desc: "英中配对消除，90 秒清盘，连击加倍。",
    Art: BlastArt,
    tag: "90 秒",
  },
  {
    href: "/arcade/memory",
    title: "翻牌配对",
    desc: "12 张牌找配对，步数越少星级越高。",
    Art: MemoryArt,
    tag: "记忆",
  },
  {
    href: "/arcade/spell",
    title: "拼写达人",
    desc: "看释义拼单词，首尾字母给提示，3 条命。",
    Art: SpellArt,
    tag: "拼写",
  },
  {
    href: "/arcade/listen",
    title: "听音辨词",
    desc: "听发音选释义，10 轮，训练耳朵。",
    Art: ListenArt,
    tag: "听力",
  },
];

/**
 * 进阶挑战：参考站其余 7 个玩法的移植，规则各不相同、都带完整画面感
 * （canvas 飞行 / 打字守城 / 贪吃蛇），词源同样走生词本优先 + 词书兜底。
 */
const ADVANCED_GAMES = [
  {
    href: "/arcade/blast-levels",
    title: "单词消消乐",
    desc: "12 关高频难词闯关，过关解锁下一关，越往后越硬核。",
    Art: BlastLevelsArt,
    tag: "关卡制",
  },
  {
    href: "/arcade/sentence",
    title: "句子重组",
    desc: "看中文句意，把打乱的英文单词拼回正确语序。",
    Art: SentenceArt,
    tag: "句型",
  },
  {
    href: "/arcade/flappy",
    title: "笨鸟先飞",
    desc: "拍翅膀穿过管道，每过 3 道弹单词关，答对才能继续飞。",
    Art: FlappyArt,
    tag: "飞行",
  },
  {
    href: "/arcade/mole",
    title: "单词打地鼠",
    desc: "照着释义敲中那只举词的地鼠，60 秒手速与词感双考。",
    Art: MoleArt,
    tag: "60 秒",
  },
  {
    href: "/arcade/guard",
    title: "单词保卫战",
    desc: "照释义打出单词击落陨石，守住 3 座城市。",
    Art: GuardArt,
    tag: "打字",
  },
  {
    href: "/arcade/sprint",
    title: "60 秒快问快答",
    desc: "词义、听音、选词混着来，60 秒极限连击。",
    Art: SprintArt,
    tag: "连击",
  },
  {
    href: "/arcade/snake",
    title: "单词贪吃蛇",
    desc: "照释义吃掉正确的单词，越吃越长越快。",
    Art: SnakeArt,
    tag: "经典",
  },
];

/** 掌握度环：和 /vocab/stats 同一套画法（stroke-dasharray），不引图表库 */
function ScoreRing({ pct, hasData }: { pct: number; hasData: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const len = (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative h-[92px] w-[92px] shrink-0">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#eef1f6" strokeWidth="7" />
        {hasData && pct > 0 && (
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke="var(--game-blue)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${len} ${c - len}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[20px] leading-none font-semibold g-ink">
          {hasData ? `${pct}%` : "—"}
        </span>
        <span className="mt-1 text-[10px] g-mute">已掌握</span>
      </div>
    </div>
  );
}

/** 近 14 天复习量迷你柱：固定像素高度，避免父级 auto 时塌成 0 */
function MiniTrend({ trend }: { trend: VocabAnalytics["trend"] }) {
  const max = Math.max(...trend.map((t) => t.total), 1);
  const H = 46;
  return (
    <div
      className="flex items-end gap-[3px] border-b border-[#eef1f6] pb-[1px]"
      style={{ height: H }}
      aria-hidden="true"
    >
      {trend.map((t) => {
        const h = t.total ? Math.max(Math.round((t.total / max) * H), 4) : 3;
        return (
          <span
            key={t.key}
            className="min-w-0 flex-1 rounded-t-[2px]"
            style={{
              height: h,
              background: t.total ? "var(--game-blue)" : "#e3e9f2",
              opacity: t.total ? 0.78 : 1,
            }}
          />
        );
      })}
    </div>
  );
}

export default async function ArcadePage() {
  const session = await auth();
  const userId = session?.user?.id;
  const a = userId ? await loadVocabAnalytics(userId) : null;

  const total = a?.totals.total ?? 0;
  const mastered = a?.totals.mastered ?? 0;
  const pct = total ? Math.round((mastered / total) * 100) : 0;
  const dueToday = a?.totals.dueToday ?? 0;
  const reviewedToday = a?.totals.reviewedToday ?? 0;
  const streakDays = a?.totals.streakDays ?? 0;
  const target = reviewedToday + dueToday;
  const dayPct = target ? Math.round((reviewedToday / target) * 100) : 0;

  // 今日两件「能做到的事」是否已做：不做第三条假勾选项
  const doneRound = reviewedToday > 0;
  const doneDue = dueToday === 0;

  return (
    <div className="min-h-screen">
      <SiteHeader active="arcade" />
      <main className="arcade-skin mx-auto w-full max-w-[1180px] px-4 pt-5 pb-16 sm:px-5 sm:pt-7">
        <div className="grid gap-3.5 lg:grid-cols-12">
          {/* ---------- 主 Banner ---------- */}
          <section className="card-game overflow-hidden lg:col-span-12">
            <div className="flex flex-col-reverse sm:grid sm:grid-cols-[minmax(0,1fr)_300px] sm:items-center">
              <div className="min-w-0 px-5 py-5 sm:px-7 sm:py-7">
                <p className="text-[10.5px] font-medium tracking-[0.24em] g-blue uppercase">
                  Arcade
                </p>
                <h1 className="mt-2 font-serif text-[24px] leading-[1.25] g-ink sm:text-[32px]">
                  用游戏的方式，把英语练成条件反射
                </h1>
                <p className="mt-2.5 max-w-[46ch] text-[12.5px] leading-[1.85] g-mute sm:text-[13px]">
                  三条主线：词、读、写。都是限时小关卡，命值、连击、星级当场结算，
                  成绩直接写回生词本、错题本和写作批改。下面还有四个配对小游戏，
                  同一批词换四种手感反复练，没有另起一套进度。
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <Link href="/arcade/vocab" className="btn-game">
                    开始闯关
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="/create" className="btn-game-ghost">
                    成为创作者
                  </Link>
                </div>
              </div>
              <div className="h-[124px] sm:h-[228px] sm:pr-4">
                <BannerArt />
              </div>
            </div>
          </section>

          {/* ---------- 数据可视化 ---------- */}
          <section className="card-game flex flex-col p-5 lg:col-span-7">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold g-ink">我的词汇量</h2>
              <Link
                href="/vocab/stats"
                className="shrink-0 text-[12px] g-blue hover:underline"
              >
                完整数据面板 ›
              </Link>
            </div>

            {userId && a ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <ScoreRing pct={pct} hasData={total > 0} />
                  <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
                    {[
                      { label: "词库总量", value: total, unit: "词" },
                      { label: "连续打卡", value: streakDays, unit: "天" },
                      { label: "今日待复习", value: dueToday, unit: "词" },
                    ].map((k) => (
                      <div key={k.label} className="min-w-0">
                        <p className="text-[10.5px] g-mute">{k.label}</p>
                        <p className="mt-1 flex items-baseline gap-0.5">
                          <span className="font-mono text-[21px] leading-none font-semibold g-ink">
                            {k.value}
                          </span>
                          <span className="text-[10.5px] g-mute">{k.unit}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[11.5px] g-mute">今日复习进度</p>
                    <p className="font-mono text-[11.5px] g-ink">
                      {reviewedToday} / {target}
                    </p>
                  </div>
                  <div className="bar-game mt-2">
                    <span style={{ width: dayPct === 0 ? "0%" : `${Math.max(dayPct, 2)}%` }} />
                  </div>
                </div>

                <div className="mt-5">
                  <p className="text-[11.5px] g-mute">近 14 天复习量</p>
                  <div className="mt-2">
                    <MiniTrend trend={a.trend} />
                  </div>
                  {a.totals.logsTotal === 0 && (
                    <p className="mt-2 text-[11px] leading-relaxed g-mute">
                      还没有复习流水，打一关词或复习一次生词，柱子就会长出来。
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
                  <ScoreRing pct={0} hasData={false} />
                  <p className="min-w-0 flex-1 text-[12.5px] leading-[1.85] g-mute">
                    登录后这里会显示你的掌握度环、连续打卡天数和今日待复习量。
                  </p>
                </div>
                <Link href="/login?next=/arcade" className="btn-game mt-5 self-start">
                  登录查看我的数据
                </Link>
              </>
            )}
          </section>

          {/* ---------- 今日进度 ---------- */}
          <section className="card-game flex flex-col p-5 lg:col-span-5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold g-ink">今日进度</h2>
              <Link href="/vocab" className="shrink-0 text-[12px] g-blue hover:underline">
                去生词本 ›
              </Link>
            </div>

            <div className="mt-4">
              <div className="bar-game">
                <span style={{ width: dayPct === 0 ? "0%" : `${Math.max(dayPct, 2)}%` }} />
              </div>
              <p className="mt-2 font-mono text-[11px] g-mute">
                {userId ? `已完成 ${dayPct}%` : "登录后开始记录"}
              </p>
            </div>

            <ul className="mt-4 space-y-2.5">
              <CheckRow
                done={doneRound}
                title="打一关背单词"
                hint={userId ? `今日已复习 ${reviewedToday} 次` : "登录后统计"}
              />
              <CheckRow
                done={doneDue}
                title="清掉到期词"
                hint={userId ? (dueToday ? `还有 ${dueToday} 词到期` : "今天没有到期词") : "登录后统计"}
              />
            </ul>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                href="/arcade/reading"
                className="rounded-[12px] border g-line px-3 py-2.5 text-center text-[12px] g-ink transition-colors hover:border-[#c9d2e0]"
              >
                练一关阅读
              </Link>
              <Link
                href="/arcade/writing"
                className="rounded-[12px] border g-line px-3 py-2.5 text-center text-[12px] g-ink transition-colors hover:border-[#c9d2e0]"
              >
                写一段批改
              </Link>
            </div>

            <div className="mt-auto pt-4">
              <div className="rounded-[14px] g-blue-soft-bg px-4 py-3">
                <p className="text-[12.5px] font-medium g-blue-deep">坚持，让热爱发光 ✦</p>
                <p className="mt-1 text-[11px] leading-[1.7] text-[#5b7fc4]">
                  {userId
                    ? streakDays > 0
                      ? `已连续 ${streakDays} 天，每一份努力都在靠近更大的世界。`
                      : "今天开个头，连续天数就从这里开始算。"
                    : "每一份努力都在靠近更大的世界。"}
                </p>
              </div>
            </div>
          </section>

          {/* ---------- 三关入口 ---------- */}
          {GAMES.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="card-game tile-game flex flex-col p-3.5 lg:col-span-4"
            >
              <div className={`art-game h-[104px] px-3 ${g.art}`}>
                <g.Art />
              </div>
              <div className="mt-3 flex items-start justify-between gap-2">
                <h3 className="min-w-0 text-[14.5px] font-semibold g-ink">{g.title}</h3>
                <span className="shrink-0 rounded-full bg-[#f2f5fa] px-2 py-[3px] text-[10px] g-mute">
                  {g.tag}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-[1.75] g-mute">{g.desc}</p>
              <span className="mt-3 text-[12px] font-medium g-blue">开始 →</span>
            </Link>
          ))}

          {/* ---------- 配对四连 ---------- */}
          <GameGridSection
            title="配对四连"
            hint="同一批词，四种玩法 · 词源：生词本优先，不足补四级高频"
            intro="这四个玩的都是「词 ↔ 释义」的配对，只是手感不同：消除拼眼力、翻牌拼记忆、
              拼写拼准确、听音拼耳朵。答对答错一样写回生词本的记忆曲线，不另起进度。"
            games={MATCH_GAMES}
          />

          {/* ---------- 进阶挑战 ---------- */}
          <GameGridSection
            title="进阶挑战"
            hint="七个完整玩法 · 有关卡、有画面、有连击，词源与配对四连同一条"
            intro="规则各不相同：消消乐一关关解锁、笨鸟先飞边飞边答题、保卫战边打字边守城。
              全部适配触屏 —— 手机上滑动、点按就能玩，电脑键盘手感不变。"
            games={ADVANCED_GAMES}
          />

          {/* ---------- 里程碑地图 ---------- */}
          <section className="card-game flex flex-col p-5 lg:col-span-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold g-ink">掌握度里程碑</h2>
              <span className="font-mono text-[11.5px] g-mute">
                {userId ? `${pct}% · 第 ${Math.min(Math.floor(pct / 25) + 1, 5)} 关` : "登录后点亮"}
              </span>
            </div>
            <p className="mt-1 text-[11.5px] g-mute">
              每掌握四分之一的词，点亮一个关卡点。
            </p>

            <div className="mt-3 sm:hidden">
              <MilestoneRow pct={pct} />
            </div>
            <div className="mt-3 hidden h-[116px] sm:block">
              <MilestonePath pct={pct} />
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
              <Link href="/arcade/vocab" className="btn-game">
                继续闯关
              </Link>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Badge href="/vocab" kind="book" label="生词本" extra={userId ? `${total}` : ""} />
                <Badge href="/leaderboard" kind="rank" label="排行榜" extra="" />
                <Badge href="/mistakes" kind="wrong" label="错题本" extra="" />
              </div>
            </div>
          </section>

          {/* ---------- 创作平台 ---------- */}
          <section className="flex flex-col gap-3.5 lg:col-span-5">
            <Link
              href="/create/novel"
              className="card-game tile-game flex min-w-0 items-center gap-3 p-3.5"
            >
              <span className="art-game art-rose h-[64px] w-[64px] shrink-0">
                <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
                  <path d="M8 9c0-1.1.9-2 2-2h9v26H10a2 2 0 0 1-2-2z" fill="#fff" stroke="#b3261e" strokeWidth="1.6" />
                  <path d="M32 9c0-1.1-.9-2-2-2h-9v26h9a2 2 0 0 0 2-2z" fill="#fff" stroke="#b3261e" strokeWidth="1.6" />
                  <path d="M12 14h4M12 19h4M24 14h4M24 19h4" stroke="#e3a9a2" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold g-ink">小说翻译创作</span>
                <span className="mt-0.5 block text-[11px] leading-[1.6] g-mute">
                  中文小说改成英文版，段级对照
                </span>
              </span>
              <span className="ml-auto shrink-0 text-[12px] font-medium text-[#b3261e]">开始 →</span>
            </Link>

            <Link
              href="/create/video"
              className="card-game tile-game flex min-w-0 items-center gap-3 p-3.5"
            >
              <span className="art-game art-teal h-[64px] w-[64px] shrink-0">
                <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden="true">
                  <rect x="6" y="11" width="24" height="18" rx="4" fill="#fff" stroke="#12805c" strokeWidth="1.6" />
                  <path d="M20 16l6 4-6 4z" fill="#12805c" />
                  <path d="M30 16l4-2v12l-4-2z" fill="#12805c" opacity="0.5" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold g-ink">短视频出海创作</span>
                <span className="mt-0.5 block text-[11px] leading-[1.6] g-mute">
                  口播稿改成 YouTube / TikTok 格式
                </span>
              </span>
              <span className="ml-auto shrink-0 text-[12px] font-medium text-[#12805c]">开始 →</span>
            </Link>

            <Link
              href="/create"
              className="flex flex-wrap items-center gap-2 rounded-[18px] border border-dashed g-line px-4 py-3 text-[12px] g-mute transition-colors hover:border-[#c9d2e0] hover:g-ink"
            >
              作品库：看已经生成的改编稿与发布包
              <span className="ml-auto">→</span>
            </Link>
          </section>
        </div>

        <p className="mx-auto mt-5 max-w-[76ch] text-[11px] leading-[1.8] g-mute">
          数据口径：掌握度、待复习量取自生词本当前快照；连续天数与近 14 天复习量取自复习流水，
          流水自 v2.4 起记录，因此更早的复习不会出现在趋势里。
        </p>
      </main>
    </div>
  );
}

/** 游戏分组区：标题 + 一句说明 + 卡片网格。配对四连和进阶挑战共用同一版式 */
function GameGridSection({
  title,
  hint,
  intro,
  games,
}: {
  title: string;
  hint: string;
  intro: string;
  games: { href: string; title: string; desc: string; Art: () => React.ReactNode; tag: string }[];
}) {
  return (
    <section className="card-game p-5 lg:col-span-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold g-ink">{title}</h2>
        <span className="text-[11.5px] g-mute">{hint}</span>
      </div>
      <p className="mt-1.5 max-w-[72ch] text-[11.5px] leading-[1.8] g-mute">{intro}</p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {games.map((g) => (
          <Link
            key={g.href}
            href={g.href}
            className="tile-game flex min-w-0 flex-col rounded-[14px] border g-line p-3 transition-colors"
          >
            <div className="art-game h-[86px] bg-[#f8fafd] px-2">
              <g.Art />
            </div>
            <div className="mt-2.5 flex items-start justify-between gap-2">
              <h3 className="min-w-0 text-[13.5px] font-semibold g-ink">{g.title}</h3>
              <span className="shrink-0 rounded-full bg-[#f2f5fa] px-2 py-[2px] text-[10px] g-mute">
                {g.tag}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-[1.7] g-mute">{g.desc}</p>
            <span className="mt-2 text-[11.5px] font-medium g-blue">开始 →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CheckRow({ done, title, hint }: { done: boolean; title: string; hint: string }) {  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
          done
            ? "g-green-bg"
            : "border-[#d5dbe6] bg-white"
        }`}
      >
        {done && (
          <svg viewBox="0 0 14 14" className="h-[10px] w-[10px]" aria-hidden="true">
            <path
              d="M2.5 7.4l3 3 6-6.4"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[12.5px] ${done ? "g-mute line-through" : "g-ink"}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-[10.5px] g-mute">{hint}</span>
      </span>
      <span className="ml-auto shrink-0 text-[10.5px] g-mute">{done ? "完成" : "进行中"}</span>
    </li>
  );
}

function Badge({
  href,
  kind,
  label,
  extra,
}: {
  href: string;
  kind: "book" | "rank" | "wrong";
  label: string;
  extra: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-full border g-line px-2.5 py-1.5 text-[11px] g-mute transition-colors hover:border-[#c9d2e0] hover:g-ink"
    >
      <BadgeIcon kind={kind} />
      <span>{label}</span>
      {extra && <span className="font-mono text-[10.5px] g-blue">{extra}</span>}
    </Link>
  );
}
