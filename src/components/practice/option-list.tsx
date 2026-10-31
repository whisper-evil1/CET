"use client";

import type { QuestionOption } from "@/lib/types";

type Props = {
  options: QuestionOption[];
  selected: string | null;
  /** 提交后才有值 */
  answerKey: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
};

/**
 * 选项组。
 * 提交后：正确项绿框 + 对勾，选错的那项红框 + 叉，其余淡化。
 */
export function OptionList({ options, selected, answerKey, onSelect, disabled }: Props) {
  return (
    <ul className="space-y-2.5" role="radiogroup" aria-label="选项">
      {options.map((option) => {
        const submitted = Boolean(answerKey);
        const isSelected = selected === option.key;
        const isCorrect = submitted && option.key === answerKey;
        const isWrongChoice = submitted && isSelected && option.key !== answerKey;
        const dimmed = submitted && !isCorrect && !isWrongChoice;

        return (
          <li key={option.key}>
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSelect(option.key)}
              className={[
                "flex w-full items-start gap-3 rounded-[8px] border px-3.5 py-3 text-left transition-all duration-150",
                "focus-visible:outline-2 focus-visible:outline-offset-2",
                isCorrect
                  ? "border-correct bg-correct-soft"
                  : isWrongChoice
                    ? "border-wrong bg-wrong-soft"
                    : isSelected
                      ? "border-accent bg-accent-soft/50"
                      : "border-line bg-surface hover:border-ink-mute/60 hover:bg-paper-deep/40",
                dimmed ? "opacity-55" : "",
                disabled ? "cursor-default" : "cursor-pointer",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-[1px] grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border font-mono text-[11px] transition-colors",
                  isCorrect
                    ? "border-correct bg-correct text-white"
                    : isWrongChoice
                      ? "border-wrong bg-wrong text-white"
                      : isSelected
                        ? "border-accent bg-accent text-white"
                        : "border-line text-ink-mute",
                ].join(" ")}
              >
                {isCorrect ? "✓" : isWrongChoice ? "✕" : option.key}
              </span>

              <span className="text-[14px] leading-[1.7] text-ink-soft">{option.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
