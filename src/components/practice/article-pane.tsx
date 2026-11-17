"use client";

import { useEffect, useMemo, useRef } from "react";
import { tokenizeParagraph, normalizeForVocab } from "@/lib/text-segments";
import type { Paragraph } from "@/lib/types";
import { FONT_SIZES, usePracticeStore } from "@/stores/practice";

export type WordClickPayload = {
  word: string;
  rect: DOMRect;
  paragraphLabel: string;
  paragraphText: string;
  /** 被点中那个词在段落里的字符偏移：同词多次出现时用它取对的语境 */
  charOffset: number;
};

/**
 * 选词填空的内联空号渲染配置。
 * 空号在正文里长这样：`A 26______ office block`，这里把它换成一个可点击的芯片，
 * 填过之后直接显示单词，交卷后按对错着色 —— 和纸质卷子上「在横线上写字母」一致。
 */
export type BlankRender = {
  /** 需要内联渲染的空号（其余空号当普通文字处理） */
  numbers: number[];
  /** 空号 → 已选词 */
  values: Record<number, { key: string; word: string } | undefined>;
  /** 交卷后的对错 */
  status: Record<number, "correct" | "wrong" | undefined>;
  active: number | null;
  onPick: (number: number) => void;
};

type Props = {
  title: string | null;
  paragraphs: Paragraph[];
  passageId: string;
  onWordClick: (payload: WordClickPayload) => void;
  /** 左栏滚动容器，交给 shell 管理滚动位置 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  blank?: BlankRender;
};

/**
 * 左栏：文章区。
 * 逐段渲染 + 段落字母标记 + 单词级可点 + 字号调节 + 依据段落跳转高亮。
 * 本组件不持有滚动状态，滚动位置由 shell 统一管理（保证切题时左栏纹丝不动）。
 */
export function ArticlePane({
  title,
  paragraphs,
  passageId,
  onWordClick,
  scrollRef,
  onScroll,
  blank,
}: Props) {
  const fontSize = usePracticeStore((s) => s.fontSize);
  const setFontSize = usePracticeStore((s) => s.setFontSize);
  const vocabWords = usePracticeStore((s) => s.vocabWords);
  const jump = usePracticeStore((s) => s.jump);

  const paraRefs = useRef<Record<string, HTMLElement | null>>({});

  // 依据句跳转：滚到对应段落顶部并高亮 1.5 秒
  useEffect(() => {
    if (!jump) return;
    const node = paraRefs.current[jump.para];
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "start" });
    node.classList.remove("para-flash");
    // 强制重排，保证同一段落连续点击也能重放动画
    void node.offsetWidth;
    node.classList.add("para-flash");
    const timer = window.setTimeout(() => node.classList.remove("para-flash"), 1600);
    return () => window.clearTimeout(timer);
  }, [jump]);

  const fontIndex = FONT_SIZES.indexOf(fontSize);

  return (
    <section className="flex h-full min-h-0 flex-col bg-paper">
      {/* 工具条：标题 + 字号调节 */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-6">
        <span className="truncate text-[11px] tracking-[0.2em] text-ink-mute uppercase">
          Passage
        </span>
        <span className="truncate font-serif text-[13px] text-ink-soft">{title ?? "Reading"}</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="缩小字号"
            disabled={fontIndex <= 0}
            onClick={() => setFontSize(FONT_SIZES[Math.max(0, fontIndex - 1)]!)}
            className="h-7 w-7 rounded border border-line text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink disabled:opacity-35"
          >
            A−
          </button>
          <span className="w-9 text-center font-mono text-[11px] text-ink-mute">{fontSize}px</span>
          <button
            type="button"
            aria-label="放大字号"
            disabled={fontIndex >= FONT_SIZES.length - 1}
            onClick={() => setFontSize(FONT_SIZES[Math.min(FONT_SIZES.length - 1, fontIndex + 1)]!)}
            className="h-7 w-7 rounded border border-line text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink disabled:opacity-35"
          >
            A+
          </button>
        </div>
      </div>

      {/* 滚动容器：左栏独立滚动 */}
      <div ref={scrollRef} onScroll={onScroll} className="scroll-pane min-h-0 flex-1 px-6 py-7">
        <div
          className="article-body mx-auto max-w-[68ch]"
          style={{ ["--article-size" as string]: `${fontSize}px` }}
        >
          {paragraphs.map((paragraph, index) => (
            <ParagraphBlock
              key={paragraph.label}
              paragraph={paragraph}
              isLast={index === paragraphs.length - 1}
              vocabWords={vocabWords}
              blank={blank}
              registerRef={(node) => {
                paraRefs.current[paragraph.label] = node;
              }}
              onClickWord={(word, rect, charOffset) =>
                onWordClick({
                  word,
                  rect,
                  paragraphLabel: paragraph.label,
                  paragraphText: paragraph.text,
                  charOffset,
                })
              }
            />
          ))}

          <p className="mt-10 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-mute">
            {blank && blank.numbers.length > 0
              ? "点带下划线的空号即可选题 · 点任意单词查释义 · 已加入生词本的词显示淡黄底"
              : "点任意单词查释义 · 已加入生词本的词会显示淡黄底 · 段落字母对应题目解析里的「依据段落」"}
          </p>
        </div>
      </div>

      <span className="sr-only">{passageId}</span>
    </section>
  );
}

type Piece =
  | { kind: "text"; text: string; offset: number }
  | { kind: "blank"; number: number };

/** 把正文按空号切段：文字段保留原始偏移，空号段单独成片 */
function splitBlanks(text: string, numbers: Set<number>, enabled: boolean): Piece[] {
  if (!enabled || numbers.size === 0) return [{ kind: "text", text, offset: 0 }];

  const pieces: Piece[] = [];
  const pattern = /\b(\d{2})\s*_{2,}/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const number = Number(match[1]);
    if (!numbers.has(number)) continue;
    if (match.index > last) {
      pieces.push({ kind: "text", text: text.slice(last, match.index), offset: last });
    }
    pieces.push({ kind: "blank", number });
    last = match.index + match[0].length;
  }

  if (pieces.length === 0) return [{ kind: "text", text, offset: 0 }];
  if (last < text.length) pieces.push({ kind: "text", text: text.slice(last), offset: last });
  return pieces;
}

function ParagraphBlock({
  paragraph,
  isLast,
  vocabWords,
  blank,
  registerRef,
  onClickWord,
}: {
  paragraph: Paragraph;
  isLast: boolean;
  vocabWords: Record<string, string>;
  blank?: BlankRender;
  registerRef: (node: HTMLElement | null) => void;
  onClickWord: (word: string, rect: DOMRect, charOffset: number) => void;
}) {
  // 分词结果按段落文本缓存：字号变化、生词增删都不会重算
  const tokens = useMemo(() => tokenizeParagraph(paragraph.text), [paragraph.text]);

  const blankNumbers = blank?.numbers ?? [];
  const blankKey = blankNumbers.join(",");
  const pieces = useMemo(
    () => splitBlanks(paragraph.text, new Set(blankNumbers), Boolean(blank)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paragraph.text, blankKey, Boolean(blank)],
  );

  // 点段落字母：高亮本段 1.5 秒（对应 PRD「点击段落可定位高亮」）
  const flashSelf = (node: HTMLElement | null) => {
    if (!node) return;
    node.classList.remove("para-flash");
    void node.offsetWidth;
    node.classList.add("para-flash");
    window.setTimeout(() => node.classList.remove("para-flash"), 1600);
  };

  return (
    <article
      ref={registerRef}
      className={`group relative grid grid-cols-[2.1rem_1fr] gap-x-2 scroll-mt-16 ${
        isLast ? "" : "mb-6"
      }`}
    >
      <button
        type="button"
        aria-label={`高亮第 ${paragraph.label} 段`}
        onClick={(event) => {
          const article = (event.currentTarget as HTMLElement).closest("article");
          flashSelf(article);
        }}
        className="h-fit select-none pt-[0.32em] text-left font-serif text-[15px] leading-none text-ink-mute/70 transition-colors hover:text-accent"
      >
        {paragraph.label}
      </button>

      <p
        className="text-justify"
        onClick={(event) => {
          const target = (event.target as HTMLElement).closest<HTMLElement>("[data-word]");
          if (!target) return;
          const word = target.dataset.word ?? "";
          if (!word) return;
          onClickWord(word, target.getBoundingClientRect(), Number(target.dataset.offset ?? -1));
        }}
      >
        {pieces.map((piece, index) => {
          if (piece.kind === "blank") {
            return (
              <BlankChip
                key={`b${piece.number}-${index}`}
                number={piece.number}
                value={blank?.values[piece.number]}
                status={blank?.status[piece.number]}
                active={blank?.active === piece.number}
                onPick={() => blank?.onPick(piece.number)}
              />
            );
          }

          const pieceTokens = pieces.length === 1 ? tokens : tokenizeParagraph(piece.text);
          return (
            <span key={`t${index}`}>
              {pieceTokens.map((token) => {
                if (token.kind === "gap") return token.text;

                const key = normalizeForVocab(token.text);
                const inVocab = key in vocabWords;

                return (
                  <span
                    key={token.key}
                    data-word={token.text}
                    data-offset={piece.offset + token.start}
                    role="button"
                    tabIndex={-1}
                    title={inVocab ? (vocabWords[key] ?? "") : undefined}
                    className={`word ${inVocab ? "word-in-vocab" : ""}`}
                  >
                    {token.text}
                  </span>
                );
              })}
            </span>
          );
        })}
      </p>
    </article>
  );
}

/**
 * 正文里的一个空号。
 * 没填时显示「26 ＿＿」，填了显示单词；交卷后按对错着色，与右栏清单颜色一致。
 */
function BlankChip({
  number,
  value,
  status,
  active,
  onPick,
}: {
  number: number;
  value?: { key: string; word: string };
  status?: "correct" | "wrong";
  active: boolean;
  onPick: () => void;
}) {
  const tone =
    status === "correct"
      ? "border-correct bg-correct-soft text-correct"
      : status === "wrong"
        ? "border-wrong bg-wrong-soft text-wrong"
        : active
          ? "border-accent bg-accent-soft text-accent"
          : value
            ? "border-ink-mute/60 bg-paper-deep/70 text-ink"
            : "border-ink-mute/45 text-ink-mute hover:border-accent hover:text-accent";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onPick();
      }}
      aria-label={
        value ? `第 ${number} 空，已选 ${value.key} ${value.word}` : `第 ${number} 空，尚未作答`
      }
      className={`mx-[1px] inline-flex items-baseline gap-1 rounded-[4px] border-b-2 px-1.5 align-baseline font-sans text-[0.82em] leading-[1.5] transition-colors ${tone}`}
    >
      <span className="font-mono text-[0.78em] opacity-70">{number}</span>
      <span className={value ? "font-medium" : "opacity-40"}>{value ? value.word : "＿＿"}</span>
    </button>
  );
}

