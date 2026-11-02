"use client";

import { useState } from "react";
import useSWR from "swr";
import { postJson, swrFetcher } from "@/lib/api-client";
import type { ExperiencePack } from "@/lib/types";

type Props = { questionId: string };
type Resp = { pack: ExperiencePack | null };

/**
 * AI 经验包卡片：展示「这题的坑 / 正确思路 / 常错原因 / 高频生词」。
 * 无 AI Key 时后端走本地归纳兜底，卡片始终有内容；写作/翻译等无选项题返回空，不渲染。
 */
export function ExperiencePackCard({ questionId }: Props) {
  const key = `/api/questions/${questionId}/experience`;
  const { data, error, isLoading, mutate } = useSWR<Resp>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pack = data?.pack ?? null;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setMessage(null);
    try {
      await postJson<Resp>(key, {});
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  if (!isLoading && !error && !pack) return null;

  return (
    <section className="card-in mb-3 rounded-[10px] border border-line bg-surface p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-medium text-ink">AI 经验包</span>
        <span className="text-[10.5px] text-ink-mute">据官方解析与讨论归纳</span>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="ml-auto text-[11px] text-ink-mute transition-colors hover:text-accent disabled:opacity-40"
        >
          {refreshing ? "生成中…" : "刷新"}
        </button>
      </div>

      {isLoading && <p className="mt-2 text-[12px] text-ink-mute">正在归纳…</p>}
      {error && !isLoading && <p className="mt-2 text-[12px] text-wrong">暂时无法生成经验包</p>}
      {message && <p className="mt-1 text-[11px] text-wrong">{message}</p>}

      {pack && (
        <div className="mt-2.5 space-y-2.5 text-[12.5px] leading-[1.7] text-ink-soft">
          <div className="rounded-[8px] bg-accent-soft px-3 py-2">
            <span className="mr-1 font-medium text-accent">💡 这题的坑</span>
            {pack.pitfall}
          </div>

          <div>
            <p className="font-medium text-ink">✅ 正确思路</p>
            <p className="mt-0.5 whitespace-pre-wrap">{pack.correctApproach}</p>
          </div>

          {pack.commonMistakes.length > 0 && (
            <div>
              <p className="font-medium text-ink">📌 常错原因</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {pack.commonMistakes.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {pack.keyVocab.length > 0 && (
            <div>
              <p className="font-medium text-ink">⚠️ 高频生词</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {pack.keyVocab.map((word, index) => (
                  <span
                    key={index}
                    className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    {word}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
