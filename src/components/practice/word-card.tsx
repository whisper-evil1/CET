"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { sentenceAround } from "@/lib/text-segments";
import type { WordEntry } from "@/lib/types";
import { usePracticeStore } from "@/stores/practice";
import type { WordClickPayload } from "./article-pane";

type LookupResponse = { found: boolean; entry: WordEntry | null; hint: string | null };

type Props = {
  payload: WordClickPayload;
  passageId: string;
  onClose: () => void;
};

const GAP = 8;
const MARGIN = 12;

/**
 * 词卡浮层。
 * 定位规则（PRD 7.3）：默认出现在单词下方 8px；靠底向上翻转；靠右向左偏移；永不溢出视口。
 */
export function WordCard({ payload, passageId, onClose }: Props) {
  const addVocabLocal = usePracticeStore((s) => s.addVocabLocal);
  const vocabWords = usePracticeStore((s) => s.vocabWords);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [entry, setEntry] = useState<WordEntry | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const context = sentenceAround(payload.paragraphText, payload.word);
  const normalized = payload.word.toLowerCase();

  /* ---------- 查词 ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEntry(null);
    setHint(null);
    setAdded(normalized in vocabWords);

    postJson<LookupResponse>("/api/lookup", {
      word: payload.word,
      passageId,
      context,
    })
      .then((data) => {
        if (!alive) return;
        setEntry(data.entry);
        setHint(data.hint);
        setAdded(normalized in vocabWords);
      })
      .catch((error: Error) => {
        if (alive) setHint(error.message || "查词失败，请稍后再试");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.word, payload.paragraphText, vocabWords]);

  /* ---------- 边界翻转定位 ---------- */
  const reposition = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = payload.rect;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = rect.bottom + GAP;
    if (top + height > vh - MARGIN) {
      const flipped = rect.top - height - GAP;
      top = flipped >= MARGIN ? flipped : Math.max(MARGIN, vh - height - MARGIN);
    }

    let left = rect.left;
    if (left + width > vw - MARGIN) left = vw - width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    setPos({ left, top });
  }, [payload.rect]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition, loading, entry, hint]);

  useEffect(() => {
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [reposition]);

  /* ---------- 点外部关闭 ---------- */
  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const target = event.target as Node;
      if (card.contains(target)) return;
      // 点在另一个单词上时交给那个单词重新打开
      if ((event.target as HTMLElement).closest?.("[data-word]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [onClose]);

  /* ---------- 发音 ---------- */
  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(entry?.word ?? payload.word);
    utter.lang = "en-US";
    utter.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  /* ---------- 加入生词库 ---------- */
  // 即便词典没查到释义（entry 为 null），也允许加入生词本；
  // 释义可后续补全（配置 AI_API_KEY 后重查会自动填充）。
  const addToVocab = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const word = entry?.word ?? normalized;
      await postJson("/api/vocab", {
        word,
        phonetic: entry?.phonetic ?? null,
        definitions: entry ? entry.definitions.slice(0, 6) : [],
        example: entry?.examples[0]?.en ?? null,
        exampleZh: entry?.examples[0]?.zh ?? null,
        sourceContext: context,
        sourcePassageId: passageId,
      });
      addVocabLocal(word, entry?.definitions[0]?.zh ?? "");
      setAdded(true);
    } catch (error) {
      setHint(error instanceof Error ? error.message : "加入生词库失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`${payload.word} 的释义`}
      className="card-in fixed z-50 w-[320px] max-w-[calc(100vw-24px)] rounded-[10px] border border-line bg-surface shadow-[0_12px_32px_-12px_rgba(50,40,20,0.28)]"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="flex items-start gap-2 border-b border-line-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[19px] leading-tight text-ink">{payload.word}</p>
          {entry?.phonetic && (
            <p className="mt-0.5 font-mono text-[12px] text-ink-mute">{entry.phonetic}</p>
          )}
        </div>
        <button
          type="button"
          onClick={speak}
          aria-label="朗读单词"
          title="朗读"
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-line text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-accent"
        >
          🔊
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭词卡"
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full text-[13px] text-ink-mute transition-colors hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[46vh] overflow-y-auto px-4 py-3">
        {loading && (
          <div className="space-y-2 py-1">
            <div className="h-3 w-3/4 animate-pulse rounded bg-line-soft" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-line-soft" />
          </div>
        )}

        {!loading && entry && (
          <>
            <ul className="space-y-1.5">
              {entry.definitions.map((definition, index) => (
                <li key={`${definition.zh}-${index}`} className="flex gap-2 text-[13.5px] leading-[1.6]">
                  {definition.pos && (
                    <span className="shrink-0 font-mono text-[11px] text-accent">{definition.pos}</span>
                  )}
                  <span className="text-ink">{definition.zh}</span>
                </li>
              ))}
            </ul>

            {entry.examples.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
                {entry.examples.slice(0, 2).map((example, index) => (
                  <div key={index}>
                    <p className="font-serif text-[12.5px] leading-[1.6] text-ink-soft">{example.en}</p>
                    {example.zh && <p className="mt-0.5 text-[12px] text-ink-mute">{example.zh}</p>}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-3 truncate text-[11px] text-ink-mute" title={context}>
              语境：{context}
            </p>
          </>
        )}

        {!loading && !entry && (
          <div className="py-1">
            <p className="text-[12.5px] leading-relaxed text-ink-mute">
              {hint ?? "没有查到这个词的释义。"}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-mute/80">
              仍可加入生词本，释义后续可补（配置 AI_API_KEY 后重查会自动填充）。
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-line-soft px-4 py-2.5">
        {added ? (
          <p className="text-[12.5px] text-correct">✓ 已在生词本</p>
        ) : (
          <button
            type="button"
            onClick={addToVocab}
            disabled={saving}
            className="w-full rounded-[6px] bg-ink py-1.5 text-[12.5px] text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {saving
              ? "加入中…"
              : entry
                ? "＋ 加入生词本"
                : "＋ 加入生词本（释义待补）"}
          </button>
        )}
      </div>
    </div>
  );
}
