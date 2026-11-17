"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { postJson, swrFetcher } from "@/lib/api-client";
import type { VocabItem, VocabQueue } from "@/lib/types";
import { WordListView } from "./word-list-view";
import { FlashSession } from "./flash-session";
import { AudioPlayer } from "./audio-player";
import { StoryBuilder } from "./story-builder";
import { WordbookShelf } from "./wordbook-shelf";
import { ImportView } from "./import-view";
import { ReviewGame } from "@/components/arcade/review-game";

type Section = "vocab" | "books" | "import";
type View = "list" | "flash" | "audio" | "review" | "story";
type SortKey = "recent" | "priority";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "vocab", label: "生词本" },
  { key: "books", label: "词书" },
  { key: "import", label: "导入" },
];

const TITLES: Record<Section, string> = {
  vocab: "生词本",
  books: "词书",
  import: "导入单词",
};

/**
 * /vocab 顶层结构：
 *   生词本 —— 词表（可按优先级排）、刷词、随身听、背单词（记忆曲线）
 *   词书   —— 书架（左右布局）：阅读生词 + 四六级高频 + 我的词本，
 *            可新建/改名/删/设默认/加词，直接背（四选一刷词模式）
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

  const words = data ?? [];
  const queueWords = queue?.items ?? [];

  const refreshAll = useCallback(() => {
    void mutate();
    void mutateQueue();
  }, [mutate, mutateQueue]);

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

  /*
   * 支持 /vocab?mode=review 直接落在背词模式：
   * 旧链接（曾经挂在游戏厅的 /arcade/review）与站内跳转都还指向这个模式，
   * 用 query 而不是新路由，是因为它本来就是生词本的一个视图。
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "review") setView("review");
    if (mode === "audio") setView("audio");
    if (mode === "flash") setView("flash");
    if (mode === "story") setView("story");
    // 老 /study 重定向过来会带 tab=books，直接落在词书页签
    const tab = params.get("tab");
    if (tab === "books") setSection("books");
  }, []);

  if (view === "flash") {
    return <FlashSession words={queueWords.length > 0 ? queueWords : words} onExit={handleExit} />;
  }
  if (view === "audio") {
    return <AudioPlayer words={words} onExit={handleExit} />;
  }
  if (view === "story") {
    return <StoryBuilder vocabWords={words} onExit={handleExit} />;
  }
  if (view === "review") {
    return (
      <div className="arcade-skin mx-auto w-full max-w-[1180px] px-5 pb-28">
        <div className="flex flex-wrap items-end justify-between gap-2 py-5">
          <div className="min-w-0">
            <h1 className="font-serif text-[24px] text-ink sm:text-[26px]">背单词</h1>
            <p className="mt-1 max-w-[64ch] text-[12px] leading-relaxed text-ink-mute">
              用你生词本里的词出题：先只给单词，认识的才进四选一；连对 3 次才过，
              全部过关后再走一轮回顾。答对答错都会回写记忆曲线。
            </p>
          </div>
          <button
            type="button"
            onClick={handleExit}
            className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
          >
            ← 回词表
          </button>
        </div>
        <ReviewGame embedded onExit={handleExit} />
      </div>
    );
  }

  /*
   * 容器宽度：760 → 1180。
   * 760 在 1440 屏上只占一半，词书两栏被压到 720px，右栏只剩 370px，
   * 词表里「单词列 + 音标列」的固定宽一挤，释义列就被压成竖排一个字一行。
   * 放宽到 1180 后两栏都有余量，窄屏仍由 px/pb 自适应。
   */
  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-28 sm:px-6">
      {/* 标题 + 三个入口 */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line py-7">
        <h1 className="font-serif text-[30px] text-ink">{TITLES[section]}</h1>
        <div className="flex items-center gap-1.5">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSection(item.key)}
              className={`rounded-full px-4 py-2 text-[13.5px] transition-colors ${
                section === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
              }`}
            >
              {item.label}
            </button>
          ))}
          {/* 学习数据是「看结果」不是「切分区」，所以用描边按钮和上面三个页签区分开 */}
          <Link
            href="/vocab/stats"
            className="ml-1 rounded-full border border-line px-4 py-2 text-[13.5px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink"
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
          onStartReview={() => setView("review")}
          onStartStory={() => setView("story")}
        />
      )}

      {section === "books" && <WordbookShelf onImported={refreshAll} />}

      {section === "import" && <ImportView onImported={refreshAll} />}
    </div>
  );
}
