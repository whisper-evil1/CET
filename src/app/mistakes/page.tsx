import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUserMistakes } from "@/lib/mistakes";
import { SiteHeader } from "@/components/site-header";
import { MistakeAiPanel } from "@/components/mistake-ai-panel";
import type { MistakeItem, OptionAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MistakesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?next=/mistakes");

  const { summary, mistakes } = await getUserMistakes(userId);
  const hasMistakes = mistakes.length > 0;

  const maxType = Math.max(1, ...summary.byType.map((t) => t.count));
  const maxPaper = Math.max(1, ...summary.byPaper.map((p) => p.wrongCount));
  const maxChoice = Math.max(1, ...summary.byWrongChoice.map((c) => c.count));

  return (
    <div className="min-h-screen">
      <SiteHeader active="mistakes" />

      <main className="mx-auto max-w-[1080px] px-5 pb-24">
        <section className="border-b border-line py-8">
          <h1 className="font-serif text-[26px] text-ink">错题本</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-mute">
            这里汇总了你答错的所有题目，以及 AI 基于这些数据给出的薄弱点分析。
            数据只属于你本人，私密保存。
          </p>
        </section>

        {/* 概览数据卡：纯服务端渲染，零 JS，所有浏览器即时可见、延迟极低 */}
        <section className="grid grid-cols-2 border-b border-line sm:grid-cols-4">
          <Stat label="已作答" value={summary.answeredCount} />
          <Stat label="正确" value={summary.correctCount} tone="correct" />
          <Stat label="错题" value={summary.wrongCount} tone="wrong" />
          <Stat label="正确率" value={`${summary.accuracy}%`} />
        </section>

        {/* 上：分布 + AI 分析（两栏，窄屏堆叠）
            min-w-0 必须加：grid 子项默认 min-width:auto，会按「最小内容宽度」撑开，
            而 AI 面板里的徽标+按钮、分布条里的 120px 固定条一叠加，320px 宽的小屏
            就被顶到 377px，整页出现横向滚动条。 */}
        <section className="grid gap-6 py-8 lg:grid-cols-[1fr_minmax(320px,400px)]">
          <div className="min-w-0 space-y-6">
            <Distribution
              title="错题题型分布"
              items={summary.byType.map((t) => ({ label: t.type, count: t.count }))}
              max={maxType}
            />
            <Distribution
              title="出错最多的卷子"
              items={summary.byPaper.map((p) => ({ label: p.title, count: p.wrongCount }))}
              max={maxPaper}
            />
            <Distribution
              title="最容易误选的选项"
              items={summary.byWrongChoice.map((c) => ({ label: `选项 ${c.choice}`, count: c.count }))}
              max={maxChoice}
            />
          </div>

          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            <MistakeAiPanel hasMistakes={hasMistakes} />
          </div>
        </section>

        {/* 下：错题清单 */}
        <section className="border-t border-line pt-8">
          <h2 className="font-serif text-[18px] text-ink">错题清单</h2>
          {!hasMistakes ? (
            <p className="mt-4 rounded-[10px] border border-line bg-surface px-5 py-10 text-center text-[13px] text-ink-mute">
              目前还没有错题，保持住！答对每一题，这里就一直空着。
            </p>
          ) : (
            <ul className="mt-4 space-y-5">
              {mistakes.map((m, index) => (
                <MistakeCard key={m.id} item={m} index={index} total={mistakes.length} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "correct" | "wrong";
}) {
  const valueColor = tone === "correct" ? "text-correct" : tone === "wrong" ? "text-wrong" : "text-ink";
  return (
    <div className="py-6 sm:px-5">
      <p className="text-[11px] tracking-[0.14em] text-ink-mute">{label}</p>
      <p className={`mt-1.5 font-serif text-[26px] leading-none ${valueColor}`}>{value}</p>
    </div>
  );
}

function Distribution({
  title,
  items,
  max,
}: {
  title: string;
  items: { label: string; count: number }[];
  max: number;
}) {
  return (
    <div className="card-in rounded-[10px] border border-line bg-surface px-5 py-4">
      <h3 className="text-[11px] tracking-[0.18em] text-ink-mute uppercase">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-ink-mute">暂无数据</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{item.label}</span>
              {/* 条形几何用内联样式：老内核不认 Tailwind v4 的 @layer，
                  h-2/absolute 这类工具类会整块失效，条形会塌成 0 高度不可见。
                  内联固定 120×8，任何浏览器都能画出来。 */}
              <span
                className="shrink-0"
                style={{
                  position: "relative",
                  display: "block",
                  height: 8,
                  width: 120,
                  overflow: "hidden",
                  borderRadius: 9999,
                  background: "#f4f1e8",
                  flex: "0 0 auto",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    display: "block",
                    borderRadius: 9999,
                    background: "#a6392b",
                    width: `${Math.round((item.count / max) * 100)}%`,
                  }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-ink-mute">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MistakeCard({ item, index, total }: { item: MistakeItem; index: number; total: number }) {
  const q = item.question;
  const correctOpt = q.options.find((o) => o.key === q.answer);
  const wrongOpt = q.options.find((o) => o.key === item.choice);
  const optionAnalysis = q.optionAnalysis as OptionAnalysis | null;

  return (
    <li className="card-in rounded-[10px] border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft pb-3">
        <span className="font-mono text-[11px] text-wrong">第 {q.number} 题</span>
        {q.type && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-mute">{q.type}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-mute">
          {q.paperTitle}
          {q.passageTitle ? ` · ${q.passageTitle}` : ""}
        </span>
        <span className="text-[11px] text-ink-mute">{new Date(item.createdAt).toLocaleDateString("zh-CN")}</span>
      </div>

      <p className="mt-3 text-[14px] leading-[1.8] text-ink">{q.stem}</p>

      <ul className="mt-3 space-y-2">
        {q.options.map((option) => {
          const isCorrect = option.key === q.answer;
          const isWrongChoice = option.key === item.choice && option.key !== q.answer;
          const dimmed = !isCorrect && !isWrongChoice;
          return (
            <li
              key={option.key}
              className={[
                "flex items-start gap-3 rounded-[8px] border px-3.5 py-2.5",
                isCorrect
                  ? "border-correct bg-correct-soft"
                  : isWrongChoice
                    ? "border-wrong bg-wrong-soft"
                    : "border-line bg-surface",
                dimmed ? "opacity-55" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-[5px] font-mono text-[10px]",
                  isCorrect
                    ? "bg-correct text-white"
                    : isWrongChoice
                      ? "bg-wrong text-white"
                      : "border border-line text-ink-mute",
                ].join(" ")}
              >
                {isCorrect ? "✓" : isWrongChoice ? "✕" : option.key}
              </span>
              <span className="text-[13.5px] leading-[1.7] text-ink-soft">{option.text}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 rounded-[8px] bg-paper-deep/60 px-4 py-3">
        <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">你的作答</p>
        <p className="mt-1 text-[13px] leading-[1.7] text-ink-soft">
          你选了 <span className="font-mono text-wrong">{item.choice}</span>
          （{wrongOpt?.text ?? "—"}），正确答案是{" "}
          <span className="font-mono text-correct">{q.answer}</span>
          （{correctOpt?.text ?? "—"}）。
        </p>
      </div>

      {q.analysis && (
        <div className="mt-3">
          <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">解析</p>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.85] text-ink-soft">{q.analysis}</p>
        </div>
      )}

      {optionAnalysis && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] tracking-[0.16em] text-ink-mute uppercase">逐项分析</p>
          <ul className="space-y-1.5">
            {Object.entries(optionAnalysis).map(([key, text]) => {
              const isKey = key === q.answer;
              return (
                <li key={key} className="flex gap-2.5">
                  <span
                    className={`mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-[4px] font-mono text-[10px] ${
                      isKey ? "bg-correct text-white" : "border border-line text-ink-mute"
                    }`}
                  >
                    {key}
                  </span>
                  <span className={`text-[13px] leading-[1.7] ${isKey ? "text-ink" : "text-ink-soft"}`}>{text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {q.evidenceText && (
        <p className="mt-3 border-l-2 border-line pl-3 text-[12.5px] leading-[1.7] text-ink-mute">
          <span className="font-mono text-accent">依据</span> · {q.evidenceText}
        </p>
      )}

      <p className="mt-3 text-[11px] text-ink-mute">
        第 {index + 1} / {total} 条错题
      </p>
    </li>
  );
}
