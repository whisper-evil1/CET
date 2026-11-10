"use client";

import { useState } from "react";
import { apiFetch, postJson } from "@/lib/api-client";
import type { ImportResult, WordbookEntry, WordbookMeta } from "@/lib/types";

type Props = {
  books: WordbookMeta[] | undefined;
  isLoading: boolean;
  onImported: () => void;
};

type Page = {
  book: WordbookMeta;
  entries: WordbookEntry[];
  hasMore: boolean;
};

const PAGE_SIZE = 40;

/**
 * 词书视图。
 *
 * 每本词书的取词规则都写在卡片里（不藏着）：某本词书里为什么是这些词、
 * 按什么排序，用户能自己核。这也是「高频」这个说法能站得住的前提。
 *
 * 导入是分档的（50 / 200 / 全部），因为一次塞 1500 个词进生词本，
 * 大多数人一周内不会再打开——先给一小批，学完再要。
 */
export function WordbookView({ books, isLoading, onImported }: Props) {
  const [busy, setBusy] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [openId, setOpenId] = useState<string>("");
  const [page, setPage] = useState<Page | null>(null);
  const [pageLoading, setPageLoading] = useState(false);

  const importBook = async (book: WordbookMeta, count: number) => {
    if (busy) return;
    setBusy(`${book.id}:${count}`);
    setNotice("");
    try {
      const result = await postJson<ImportResult>("/api/vocab/import", {
        wordbookId: book.id,
        count,
      });
      const parts = [`「${book.name}」新增 ${result.added} 个`];
      if (result.updated > 0) parts.push(`补全释义 ${result.updated} 个`);
      if (result.skipped > 0) parts.push(`已在词库 ${result.skipped} 个`);
      setNotice(parts.join("，"));
      onImported();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "导入失败，稍后再试");
    } finally {
      setBusy("");
    }
  };

  const loadPage = async (bookId: string, offset: number) => {
    setPageLoading(true);
    try {
      const data = await apiFetch<Page>(
        `/api/vocab/wordbooks/${encodeURIComponent(bookId)}?offset=${offset}&limit=${PAGE_SIZE}`,
      );
      setPage((prev) =>
        offset === 0 || !prev
          ? data
          : { ...data, entries: [...prev.entries, ...data.entries] },
      );
    } catch {
      setPage(null);
    } finally {
      setPageLoading(false);
    }
  };

  const toggleBrowse = (bookId: string) => {
    if (openId === bookId) {
      setOpenId("");
      setPage(null);
      return;
    }
    setOpenId(bookId);
    setPage(null);
    void loadPage(bookId, 0);
  };

  if (isLoading) {
    return <p className="py-16 text-center text-[13px] text-ink-mute">加载词书…</p>;
  }

  if (!books || books.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[13.5px] text-ink-soft">词书数据没加载出来</p>
        <p className="mt-2 text-[12.5px] text-ink-mute">
          可以先到「导入」里粘贴自己的词表，功能不依赖词书
        </p>
      </div>
    );
  }

  return (
    <div className="pt-4">
      {/* 口径说明：这些字不是装饰，是这套词书凭什么叫「高频」 */}
      <p className="text-[11.5px] leading-[1.75] text-ink-mute">
        依据 ECDICT 的 COCA / BNC 词频字段排序：排名越小，在真实语料里出现得越多。
        每本词书的取词规则写在卡片里，可自行核对。
      </p>

      {notice && (
        <p className="mt-3 rounded-[8px] border border-line bg-paper-deep px-3 py-2 text-[12px] text-ink-soft">
          {notice}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {books.map((book) => {
          const progress = book.count > 0 ? Math.min(100, (book.imported / book.count) * 100) : 0;
          const isOpen = openId === book.id;
          return (
            <li key={book.id} className="rounded-[10px] border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-serif text-[18px] text-ink">{book.name}</span>
                  <span className="rounded-full border border-line px-2 py-[1px] font-mono text-[10px] text-ink-mute">
                    {book.level}
                  </span>
                  <span className="text-[11.5px] text-ink-mute">{book.count} 词</span>
                </div>
                <span className="text-[11.5px] text-ink-mute">
                  已导入 {book.imported} / {book.count}
                </span>
              </div>

              <p className="mt-1.5 text-[11.5px] leading-[1.7] text-ink-mute">{book.rule}</p>

              <div className="mt-2 h-[3px] w-full rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { count: 50, label: "导入 50" },
                  { count: 200, label: "导入 200" },
                  { count: book.count, label: "全部导入" },
                ].map((item) => (
                  <button
                    key={item.count}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void importBook(book, item.count)}
                    className="min-h-[36px] rounded-full border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                  >
                    {busy === `${book.id}:${item.count}` ? "导入中…" : item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => toggleBrowse(book.id)}
                  className="min-h-[36px] rounded-full px-3 text-[12px] text-ink-mute underline-offset-2 transition-colors hover:text-ink hover:underline"
                >
                  {isOpen ? "收起" : "浏览词表"}
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 border-t border-line-soft pt-2">
                  {pageLoading && !page && (
                    <p className="py-6 text-center text-[12px] text-ink-mute">加载中…</p>
                  )}
                  {page && (
                    <>
                      <ul className="divide-y divide-line-soft">
                        {page.entries.map((entry) => (
                          <li key={entry.word} className="flex items-baseline gap-2 py-2">
                            <span className="font-serif text-[14.5px] text-ink">{entry.word}</span>
                            <span className="shrink-0 font-mono text-[10px] text-ink-mute">
                              #{entry.rank}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
                              {entry.definitions.length > 0
                                ? entry.definitions.map((d) => d.zh).join("；")
                                : "释义待补"}
                            </span>
                            {entry.imported && (
                              <span className="shrink-0 text-[10.5px] text-correct">已加入</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {page.hasMore && (
                        <button
                          type="button"
                          disabled={pageLoading}
                          onClick={() => void loadPage(book.id, page.entries.length)}
                          className="mt-2 min-h-[36px] w-full rounded-full border border-line text-[12px] text-ink-soft disabled:opacity-40"
                        >
                          {pageLoading ? "加载中…" : "加载更多"}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
