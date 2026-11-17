"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import type { BookSummary, StudyWord } from "@/lib/books";
import type { VocabItem } from "@/lib/types";
import { shortGloss, type StoryWord } from "@/lib/word-story";
import { WordStoryPlayer } from "./word-story-player";

type Props = {
  vocabWords: VocabItem[];
  onExit: () => void;
};

type BookList = { books: BookSummary[] };
type BookWords = { book: BookSummary; words: StudyWord[] };

const MIN_WORDS = 4;
const MAX_WORDS = 16;
const RANDOM_COUNT = 8;

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 单词串故事 —— 选词页。
 *
 * 用户从「生词本」或任意一本「词书」里勾选要串进故事的词，
 * 按勾选顺序组成词序，选满 4–16 个后进入故事播放器。
 * 也保留「随机选 8 个」一键，兼顾原来的随机体验。
 */
export function StoryBuilder({ vocabWords, onExit }: Props) {
  const [source, setSource] = useState<string>("vocab");
  const [query, setQuery] = useState("");
  /** 已勾选的词（数组保序，顺序就是故事里的词序） */
  const [selected, setSelected] = useState<StoryWord[]>([]);
  /** 非空时进入故事播放器 */
  const [picked, setPicked] = useState<StoryWord[] | null>(null);

  const { data: bookList, isLoading: booksLoading } = useSWR<BookList>("/api/books", swrFetcher, {
    revalidateOnFocus: false,
  });
  const books = useMemo(() => bookList?.books ?? [], [bookList]);

  const bookKey =
    source !== "vocab" ? `/api/books/${encodeURIComponent(source)}/words?limit=300` : null;
  const { data: bookWords, isLoading: wordsLoading } = useSWR<BookWords>(bookKey, swrFetcher, {
    revalidateOnFocus: false,
  });

  /** 当前来源下可选的所有词（有释义的才参与） */
  const candidates: StoryWord[] = useMemo(() => {
    if (source === "vocab") {
      return vocabWords
        .filter((w) => w.word && w.definitions.length > 0)
        .map((w) => ({
          word: w.word,
          zh: shortGloss(w.definitions.map((d) => d.zh).filter(Boolean)[0] ?? ""),
        }));
    }
    return (bookWords?.words ?? [])
      .filter((w) => w.word && w.definitions.length > 0)
      .map((w) => ({
        word: w.word,
        zh: shortGloss(w.definitions.map((d) => d.zh).filter(Boolean)[0] ?? ""),
      }));
  }, [source, vocabWords, bookWords]);

  const selectedSet = useMemo(() => new Set(selected.map((s) => s.word)), [selected]);

  const filtered = useMemo(() => {
    if (!query.trim()) return candidates;
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => c.word.toLowerCase().includes(q) || c.zh.includes(q));
  }, [candidates, query]);

  const toggle = useCallback((item: StoryWord) => {
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.word === item.word);
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      if (prev.length >= MAX_WORDS) return prev;
      return [...prev, item];
    });
  }, []);

  const randomPick = useCallback(() => {
    setSelected(shuffle(candidates).slice(0, RANDOM_COUNT));
  }, [candidates]);

  const clear = useCallback(() => setSelected([]), []);

  const build = useCallback(() => {
    if (selected.length < MIN_WORDS) return;
    setPicked(selected);
  }, [selected]);

  if (picked) {
    return (
      <WordStoryPlayer
        givenWords={picked}
        words={vocabWords}
        onExit={() => setPicked(null)}
      />
    );
  }

  const listReady = !booksLoading && (source === "vocab" || !wordsLoading);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-60px)] max-w-[760px] flex-col px-5 pb-32">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-line py-4">
        <button onClick={onExit} className="text-[13px] text-ink-mute hover:text-ink">
          ← 返回词表
        </button>
        <span className="font-serif text-[15px] text-ink">单词串故事 · 选词</span>
        <span className="font-mono text-[11.5px] text-ink-mute">{selected.length}/{MAX_WORDS}</span>
      </div>

      {/* 来源切换：生词本 + 各本词书 */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSource("vocab")}
          className={`rounded-full px-3 py-1.5 text-[12.5px] transition-colors ${
            source === "vocab" ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
          }`}
        >
          生词本
        </button>
        {books.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => setSource(book.id)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] transition-colors ${
              source === book.id ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
            }`}
          >
            {book.name}
            <span className="ml-1 opacity-60">{book.count}</span>
          </button>
        ))}
      </div>

      {/* 提示 + 快捷操作 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-mute">
        <span>勾选 {MIN_WORDS}–{MAX_WORDS} 个词，按勾选顺序串成故事</span>
        <button
          type="button"
          onClick={randomPick}
          disabled={candidates.length === 0}
          className="rounded-full border border-line px-3 py-1 text-ink-soft hover:border-accent hover:text-accent disabled:opacity-35"
        >
          🎲 随机选 8 个
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-ink-mute hover:text-ink-soft"
          >
            清空
          </button>
        )}
      </div>

      {/* 搜索 */}
      <div className="mt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词或释义…"
          className="w-full rounded-[8px] border border-line bg-surface px-4 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
        />
      </div>

      {/* 词列表 */}
      <div className="mt-3 rounded-[12px] border border-line bg-surface">
        {!listReady && (
          <p className="px-5 py-8 text-center text-[13px] text-ink-mute">正在取词…</p>
        )}
        {listReady && candidates.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-ink-mute">
            {source === "vocab"
              ? "生词本还是空的。先去词书导入，或刷题时点词加入。"
              : "这本书还没有可选的词。"}
          </p>
        )}
        {listReady && candidates.length > 0 && filtered.length === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-ink-mute">没找到匹配的词</p>
        )}
        {listReady && (
          <ul className="divide-y divide-line-soft">
            {filtered.map((item) => {
              const on = selectedSet.has(item.word);
              return (
                <li key={item.word}>
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                      on ? "bg-accent/[0.06]" : "hover:bg-paper-deep/50"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[12px] text-white transition-colors ${
                        on ? "border-accent bg-accent" : "border-line-soft bg-paper"
                      }`}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="w-[9.5rem] shrink-0 truncate font-serif text-[16px] text-ink">
                      {item.word}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-mute">
                      {item.zh}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部固定栏 */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 px-5 py-3">
          <span className="min-w-0 flex-1 text-[13px] text-ink-mute">
            已选 <span className="font-mono text-ink">{selected.length}</span> 个
            {selected.length > 0 && selected.length < MIN_WORDS && (
              <span className="ml-2 text-wrong">还差 {MIN_WORDS - selected.length} 个</span>
            )}
          </span>
          <button
            type="button"
            onClick={randomPick}
            disabled={candidates.length === 0}
            className="rounded-[10px] border border-line px-4 py-2.5 text-[13.5px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-35"
          >
            🎲 随机选 8 个
          </button>
          <button
            type="button"
            onClick={build}
            disabled={selected.length < MIN_WORDS}
            className="rounded-[10px] bg-ink px-6 py-2.5 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-35"
          >
            串成故事 →
          </button>
        </div>
      </div>
    </div>
  );
}
