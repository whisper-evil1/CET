"use client";

import type { AnswerResult } from "@/lib/types";

type Props = {
  result: AnswerResult;
  onJumpPara: (label: string) => void;
};

/**
 * 答案与解析面板（默认折叠，展开才渲染内容）。
 * 展开动作由 shell 记账：只有真展开才会调用 /analysis 把 viewedAnalysis 置为 true。
 */
export function AnalysisPanel({ result, onJumpPara }: Props) {
  const { optionAnalysis } = result;

  return (
    <div className="card-in mt-4 rounded-[8px] border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5">
        <span className="text-[11px] tracking-[0.18em] text-ink-mute uppercase">Answer</span>
        <span className="font-serif text-[16px] text-correct">正确答案 {result.answer}</span>
        {result.type && (
          <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-mute">
            {result.type}
          </span>
        )}
      </div>

      <div className="px-4 py-3.5">
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.85] text-ink-soft">
          {result.analysis}
        </p>

        {optionAnalysis && (
          <div className="mt-4 border-t border-line-soft pt-3">
            <p className="mb-2 text-[11px] tracking-[0.18em] text-ink-mute uppercase">
              逐项分析
            </p>
            <ul className="space-y-2">
              {Object.entries(optionAnalysis).map(([key, text]) => {
                const isKey = key === result.answer;
                return (
                  <li key={key} className="flex gap-2.5">
                    <span
                      className={`mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-[4px] font-mono text-[10px] ${
                        isKey ? "bg-correct text-white" : "border border-line text-ink-mute"
                      }`}
                    >
                      {key}
                    </span>
                    <span
                      className={`text-[13px] leading-[1.7] ${
                        isKey ? "text-ink" : "text-ink-soft"
                      }`}
                    >
                      {text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {result.evidencePara && (
          <button
            type="button"
            onClick={() => onJumpPara(result.evidencePara!)}
            className="mt-4 flex w-full items-center gap-2 rounded-[6px] border border-dashed border-line px-3 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            <span className="font-mono text-[11px] text-accent">第 {result.evidencePara} 段</span>
            <span className="min-w-0 flex-1 truncate font-serif">
              {result.evidenceText ?? "点击定位原文依据"}
            </span>
            <span aria-hidden>↗</span>
          </button>
        )}
      </div>
    </div>
  );
}
