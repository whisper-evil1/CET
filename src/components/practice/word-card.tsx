"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { delJson, postJson } from "@/lib/api-client";
import { speakText, stopSpeaking } from "@/lib/pronounce";
import { normalizeForVocab, sentenceAround } from "@/lib/text-segments";
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
  const removeVocabLocal = usePracticeStore((s) => s.removeVocabLocal);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [entry, setEntry] = useState<WordEntry | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [added, setAdded] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 加入/取消失败时的醒目提示：以前只写进 hint，被释义区盖住，用户以为「点了没反应」 */
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const context = useMemo(
    () => sentenceAround(payload.paragraphText, payload.word, payload.charOffset),
    [payload.paragraphText, payload.word, payload.charOffset],
  );
  const normalized = normalizeForVocab(payload.word);

  /* ---------- 查词 ---------- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEntry(null);
    setHint(null);
    setError(null);
    // 读一次当前快照即可，不要把 vocabWords 放进依赖：
    // 否则加入生词本后 store 变化会立刻触发重新查词，词卡闪回骨架屏、还白吃一次限流额度
    setAdded(normalized in usePracticeStore.getState().vocabWords);

    postJson<LookupResponse>("/api/lookup", {
      word: payload.word,
      passageId,
      context,
    })
      .then((data) => {
        if (!alive) return;
        setEntry(data.entry);
        setHint(data.hint);
        setAdded(normalized in usePracticeStore.getState().vocabWords);
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
  }, [payload.word, payload.paragraphText, payload.charOffset, passageId, context, normalized]);

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
  // 先播音频文件、再退回 speechSynthesis。
  // 百度 / 迅雷这类安卓内置浏览器没有可用语音引擎，旧的单一路径会静默失败，
  // 表现就是「点了播放按钮没反应」，所以这里还必须把失败原因显示出来。
  const [speaking, setSpeaking] = useState(false);
  const [accent, setAccent] = useState<"us" | "uk">("us");

  const speak = async () => {
    if (speaking) return;
    setSpeaking(true);
    setError(null);
    const word = entry?.word ?? payload.word;
    const channel = await speakText(word, "en", 0.95, accent);
    setSpeaking(false);
    if (channel === "failed") {
      setError("当前浏览器播放不了发音，换 Chrome / Safari / 微信打开即可");
    }
  };

  const toggleAccent = () => setAccent((a) => (a === "us" ? "uk" : "us"));

  // 词卡关闭或切词时掐断正在播的声音
  useEffect(() => stopSpeaking, []);

  /* ---------- 加入生词库 ---------- */
  // 即便词典没查到释义（entry 为 null），也允许加入生词本；
  // 释义可后续补全（配置 AI_API_KEY 后重查会自动填充）。
  const addToVocab = async () => {
    if (saving || added) return;
    setSaving(true);
    setError(null);
    try {
      const word = normalized;
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
      setError(
        error instanceof Error && error.message ? `加入失败：${error.message}` : "加入生词本失败，请重试",
      );
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 取消收藏 ---------- */
  const removeFromVocab = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await delJson("/api/vocab", { word: normalized });
      removeVocabLocal(normalized);
      setAdded(false);
    } catch (error) {
      setError(
        error instanceof Error && error.message ? `取消失败：${error.message}` : "取消收藏失败，请重试",
      );
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
          aria-label={`朗读单词（当前${accent === "us" ? "美式" : "英式"}发音）`}
          aria-busy={speaking}
          title="朗读"
          className={`mt-0.5 h-7 shrink-0 rounded-full border border-line px-2 text-[11px] transition-colors hover:border-ink-mute hover:text-accent ${
            speaking ? "animate-pulse text-accent" : "text-ink-soft"
          }`}
        >
          🔊 {accent === "us" ? "US" : "UK"}
        </button>
        <button
          type="button"
          onClick={toggleAccent}
          aria-label="切换美式/英式发音"
          title="切换美音/英音"
          className="mt-0.5 h-7 w-7 shrink-0 rounded-full text-[10px] text-ink-mute transition-colors hover:text-ink"
        >
          ⇄
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
        {error && (
          <p
            role="alert"
            className="mb-2 rounded-[6px] bg-wrong-soft px-2.5 py-1.5 text-[11.5px] leading-snug text-wrong"
          >
            {error}
          </p>
        )}
        {added ? (
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-correct">✓ 已在生词本</span>
            <button
              type="button"
              onClick={removeFromVocab}
              disabled={saving}
              className="text-[12px] text-ink-mute underline-offset-2 transition-colors hover:text-wrong hover:underline disabled:opacity-40"
            >
              {saving ? "…" : "取消收藏"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={addToVocab}
            disabled={saving}
            className="w-full rounded-[6px] bg-ink py-1.5 text-[12.5px] text-paper transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            {saving
              ? "加入中…"
              : entry && entry.definitions.length > 0
                ? "＋ 加入生词本"
                : "＋ 先收藏，稍后补释义"}
          </button>
        )}
      </div>
    </div>
  );
}
