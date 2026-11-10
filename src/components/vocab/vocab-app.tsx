"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { postJson, swrFetcher } from "@/lib/api-client";
import type { VocabItem, VocabQueue, WordbookMeta } from "@/lib/types";
import { WordListView } from "./word-list-view";
import { FlashSession } from "./flash-session";
import { AudioPlayer } from "./audio-player";
import { WordbookView } from "./wordbook-view";
import { ImportView } from "./import-view";

type Section = "vocab" | "books" | "import";
type View = "list" | "flash" | "audio";
type SortKey = "recent" | "priority";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "vocab", label: "生词本" },
  { key: "books", label: "词书" },
  { key: "import", label: "导入" },
];

const TITLES: Record<Section, string> = {
  vocab: "生词本",
  books: "四六级词书",
  import: "导入单词",
};

/**
 * /vocab 顶层结构：
 *   生词本 —— 词表（可按优先级排）、刷词、随身听
 *   词书   —— 内置四六级高频词书，按词频排序，可部分导入
 *   导入   —— 粘贴文本 / 上传 txt、csv、json
 *
 * 刷词队列优先用 /api/vocab/queue 的排序结果（按优先级）；
 * 接口没返回时退回按最近添加排序的词表，功能不依赖接口成功与否。
 */
export function VocabApp() {
  const [section, setSection] = useState<Section>("vocab");
  const [tab, setTab] = useState<"learning" | "mastered">("learning");
  const [view, setView] = useState<View>("list");
  const [sort, setSort] = useState<SortKey>("recent");

  const { data, isLoading, error, mutate } = useSWR<VocabItem[]>(
    `/api/vocab?status=${tab}${sort === "priority" ? "&sort=priority" : ""}`,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const { data: queue, mutate: mutateQueue } = useSWR<VocabQueue>(
    "/api/vocab/queue?limit=60",
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const {
    data: books,
    isLoading: booksLoading,
    mutate: mutateBooks,
  } = useSWR<WordbookMeta[]>(section === "books" ? "/api/vocab/wordbooks" : null, swrFetcher, {
    revalidateOnFocus: false,
  });

  const words = data ?? [];
  const queueWords = queue?.items ?? [];

  const refreshAll = useCallback(() => {
    void mutate();
    void mutateQueue();
    void mutateBooks();
  }, [mutate, mutateQueue, mutateBooks]);

  /* 进入词表时自动补全缺失释义 */
  useEffect(() => {
    if (section !== "vocab" || tab !== "learning" || isLoading) return;
    const hasEmpty = words.some((w) => w.definitions.length === 0);
    if (!hasEmpty) return;
    // 后台静默补全，完成后刷新列表
    postJson<{ total: number; filled: number }>("/api/vocab/refresh", {})
      .then((res) => {
        if (res.filled > 0) void mutate();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, tab, isLoading]);

  const handleExit = useCallback(() => {
    setView("list");
    refreshAll();
  }, [refreshAll]);

  if (view === "flash") {
    return <FlashSession words={queueWords.length > 0 ? queueWords : words} onExit={handleExit} />;
  }
  if (view === "audio") {
    return <AudioPlayer words={words} onExit={handleExit} />;
  }

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-28">
      {/* 标题 + 三个入口 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-6">
        <h1 className="font-serif text-[26px] text-ink">{TITLES[section]}</h1>
        <div className="flex items-center gap-1">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={`rounded-full px-3 py-1.5 text-[12px] transition-colors ${
                section === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
          {/* 学习数据是「看结果」不是「切分区」，所以用描边按钮和上面三个页签区分开 */}
          <Link
            href="/vocab/stats"
            className="ml-1 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
          >
            学习数据
          </Link>
        </div>
      </div>

      {section === "vocab" && (
        <WordListView
          tab={tab}
          sort={sort}
          onSortChange={setSort}
          onTabChange={setTab}
          words={words}
          queue={queue}
          isLoading={isLoading}
          error={error}
          onMutate={refreshAll}
          onStartFlash={() => setView("flash")}
          onStartAudio={() => setView("audio")}
        />
      )}

      {section === "books" && (
        <WordbookView books={books} isLoading={booksLoading} onImported={refreshAll} />
      )}

      {section === "import" && <ImportView onImported={refreshAll} />}
    </div>
  );
}
