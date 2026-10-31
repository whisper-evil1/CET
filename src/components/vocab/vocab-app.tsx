"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { postJson, swrFetcher } from "@/lib/api-client";
import type { VocabItem } from "@/lib/types";
import { WordListView } from "./word-list-view";
import { FlashSession } from "./flash-session";
import { AudioPlayer } from "./audio-player";

type View = "list" | "flash" | "audio";

/**
 * /vocab 三层结构入口：
 * 1. 词表（默认）—— 直接看释义、搜索、管理
 * 2. 刷词 —— 卡片正面释义全可见，认识/不认识
 * 3. 随身听 —— Web Speech API 自动连播
 *
 * 进入页面时自动触发补全缺失释义（POST /api/vocab/refresh）。
 */
export function VocabApp() {
  const [tab, setTab] = useState<"learning" | "mastered">("learning");
  const [view, setView] = useState<View>("list");

  const { data, isLoading, error, mutate } = useSWR<VocabItem[]>(
    `/api/vocab?status=${tab}`,
    swrFetcher,
    { revalidateOnFocus: false },
  );

  const words = data ?? [];

  /* 进入词表时自动补全缺失释义 */
  useEffect(() => {
    if (tab !== "learning" || isLoading) return;
    const hasEmpty = words.some((w) => w.definitions.length === 0);
    if (!hasEmpty) return;
    // 后台静默补全，完成后刷新列表
    postJson<{ total: number; filled: number }>("/api/vocab/refresh", {})
      .then((res) => {
        if (res.filled > 0) void mutate();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isLoading]);

  const handleExit = useCallback(() => {
    setView("list");
    void mutate();
  }, [mutate]);

  if (view === "flash") {
    return <FlashSession words={words} onExit={handleExit} />;
  }
  if (view === "audio") {
    return <AudioPlayer words={words} onExit={handleExit} />;
  }

  return (
    <WordListView
      tab={tab}
      onTabChange={setTab}
      words={words}
      isLoading={isLoading}
      error={error}
      onMutate={mutate}
      onStartFlash={() => setView("flash")}
      onStartAudio={() => setView("audio")}
    />
  );
}
