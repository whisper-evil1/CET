"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { del, postJson, swrFetcher } from "@/lib/api-client";
import type { BookSummary, StudyWord } from "@/lib/books";
import { ReviewGame } from "@/components/arcade/review-game";
import type { PoolWord } from "@/components/arcade/word-pool";

type BookList = { books: BookSummary[] };
type StudyingBook = { name: string; count: number; pool: PoolWord[] };
type BookWords = { book: BookSummary; words: StudyWord[] };

/** 把书里的词转成刷词模式的词池条目（四选一、连对 3 次那套）。 */
function toPoolWords(words: StudyWord[]): PoolWord[] {
  const seen = new Set<string>();
  const out: PoolWord[] = [];
  for (const item of words) {
    const word = (item.word ?? "").trim();
    const lower = word.toLowerCase();
    if (!word || seen.has(lower)) continue;
    const first = item.definitions?.[0];
    const definition = (first?.zh ?? "").replace(/\[[^\]]{1,6}\]/g, "").trim();
    if (!definition) continue;
    seen.add(lower);
    out.push({
      id: item.vocabId ?? null,
      word,
      phonetic: item.phonetic,
      definition,
      pos: (first?.pos ?? "").trim(),
      rank: item.rank,
      from: item.vocabId ? "own" : "book",
    });
  }
  return out;
}

const KIND_LABEL: Record<BookSummary["kind"], string> = {
  reading: "自动",
  exam: "内置词书",
  custom: "我的",
};

/**
 * 词书书架（左右布局）。
 *
 * 左侧一列是书架：阅读生词、内置四六级高频、我自己建的词本，
 * 能新建、改名、删除、设默认、加词。右侧是选中那本的内容和「开始背」。
 *
 * 点左侧选书，右侧就地展示，不再跳到底部。
 * 「开始背」用和生词本一样的刷词模式（四选一、连对 3 次、6 个一轮）。
 *
 * 三种书语义不同：
 *   阅读生词 —— 就是生词本里的全部词（和「生词本」页签同一份），自动就有
 *   内置词书 —— 四六级高频，只读；想删改就复制进自己的本子
 *   我的词本 —— 自己建，能加能删能改名，可以有很多本
 */
export function WordbookShelf({ onImported }: { onImported?: () => void }) {
  const { data, isLoading, error, mutate } = useSWR<BookList>("/api/books", swrFetcher, {
    revalidateOnFocus: false,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [studying, setStudying] = useState<StudyingBook | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState("");

  const books = useMemo(() => data?.books ?? [], [data]);
  const selected = books.find((b) => b.id === selectedId) ?? null;

  const wordsKey = selectedId ? `/api/books/${encodeURIComponent(selectedId)}/words?limit=300` : null;
  const {
    data: wordData,
    isLoading: wordsLoading,
    mutate: mutateWords,
  } = useSWR<BookWords>(wordsKey, swrFetcher, { revalidateOnFocus: false });

  const say = useCallback((tone: "ok" | "err", text: string) => setNotice({ tone, text }), []);

  const refresh = useCallback(async () => {
    await mutate();
    if (wordsKey) await mutateWords();
    onImported?.();
  }, [mutate, mutateWords, wordsKey, onImported]);

  /* 默认选第一本，右侧不至于空白 */
  useEffect(() => {
    if (selectedId || books.length === 0) return;
    // 优先选默认词本，否则第一本
    const first = books.find((b) => b.isDefault) ?? books[0];
    setSelectedId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books]);

  const createBook = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await postJson<{ book: BookSummary }>("/api/books", { name });
      setNewName("");
      await mutate();
      setSelectedId(res.book.id);
      say("ok", `已建好《${res.book.name}》`);
    } catch (err) {
      say("err", err instanceof Error ? err.message : "新建失败");
    } finally {
      setBusy(false);
    }
  };

  const renameBook = async (book: BookSummary) => {
    const name = window.prompt("给词本改个名字", book.name)?.trim();
    if (!name || name === book.name) return;
    try {
      await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      }).then(async (res) => {
        const json = (await res.json()) as { code: number; message: string };
        if (json.code !== 0) throw new Error(json.message);
      });
      await refresh();
    } catch (err) {
      say("err", err instanceof Error ? err.message : "改名失败");
    }
  };

  const setDefault = async (book: BookSummary) => {
    try {
      await fetch(`/api/books/${encodeURIComponent(book.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      await mutate();
      say("ok", `以后加词默认进《${book.name}》`);
    } catch {
      say("err", "设置失败");
    }
  };

  const removeBook = async (book: BookSummary) => {
    if (!window.confirm(`删掉《${book.name}》？里面的词不会影响生词本。`)) return;
    try {
      await del(`/api/books/${encodeURIComponent(book.id)}`);
      if (selectedId === book.id) setSelectedId(null);
      await mutate();
    } catch (err) {
      say("err", err instanceof Error ? err.message : "删除失败");
    }
  };

  const addWord = async () => {
    const raw = adding.trim();
    if (!raw || !selected || busy) return;
    setBusy(true);
    try {
      const res = await postJson<{ added: number; duplicated: number }>(
        `/api/books/${encodeURIComponent(selected.id)}/words`,
        { words: raw.split(/[\s,，;；\n]+/).filter(Boolean) },
      );
      setAdding("");
      await refresh();
      say("ok", res.added > 0 ? `加了 ${res.added} 个词` : "这些词都已在书里");
    } catch (err) {
      say("err", err instanceof Error ? err.message : "加词失败");
    } finally {
      setBusy(false);
    }
  };

  const importExam = async (examId: string, count: number) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const res = await postJson<{ added: number }>(
        `/api/books/${encodeURIComponent(selected.id)}/words`,
        { importExam: examId, count },
      );
      await refresh();
      say("ok", `从高频词书复制了 ${res.added} 个词`);
    } catch (err) {
      say("err", err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const removeWord = async (word: string) => {
    if (!selected) return;
    try {
      await del(`/api/books/${encodeURIComponent(selected.id)}/words?word=${encodeURIComponent(word)}`);
      await mutateWords();
      await mutate();
    } catch (err) {
      say("err", err instanceof Error ? err.message : "移除失败");
    }
  };

  const startStudy = async (book: BookSummary) => {
    if (book.count === 0) return;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(book.id)}/words?limit=300`).then(
        (r) => r.json() as Promise<{ code: number; data: BookWords }>,
      );
      if (res.code !== 0) throw new Error("取词失败");
      const pool = toPoolWords(res.data.words);
      if (pool.length === 0) {
        say("err", "这本书没有能背的词");
        return;
      }
      setStudying({ name: book.name, count: pool.length, pool });
    } catch {
      say("err", "取词失败，稍后再试");
    }
  };

  if (studying) {
    return (
      <ReviewGame
        embedded
        pool={studying.pool}
        poolLabel={`《${studying.name}》共 ${studying.count} 个词，每轮随机抽 ${Math.min(studying.count, 6)} 个来背。`}
        onExit={() => setStudying(null)}
        onPoolExit={() => setStudying(null)}
      />
    );
  }

  if (isLoading) {
    return <p className="py-16 text-center text-[13px] text-ink-mute">正在取你的词书…</p>;
  }
  if (error) {
    return <p className="py-16 text-center text-[13px] text-wrong">词书加载失败，刷新再试。</p>;
  }

  return (
    <div className="pt-4">
      {notice && (
        <p
          className={`mb-3 flex items-start justify-between gap-3 rounded-[8px] px-3 py-2 text-[12.5px] ${
            notice.tone === "ok" ? "bg-correct-soft text-correct" : "bg-wrong-soft text-wrong"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 underline">
            知道了
          </button>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
        {/* 左侧：书架 */}
        <aside className="min-w-0">
          <ul className="space-y-2">
            {books.map((book) => {
              const active = selectedId === book.id;
              return (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(active ? null : book.id)}
                    className={`w-full rounded-[12px] border px-5 py-4 text-left transition-colors ${
                      active ? "border-accent bg-accent-soft/30" : "border-line bg-surface hover:border-ink-mute"
                    }`}
                  >
                    <div className="flex items-baseline gap-2.5">
                      <span className="min-w-0 flex-1 truncate font-serif text-[19px] text-ink">
                        {book.name}
                      </span>
                      <span className="shrink-0 rounded-full bg-paper-deep px-2.5 py-1 text-[12px] text-ink-mute">
                        {KIND_LABEL[book.kind]}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <span className="font-mono text-[13.5px] text-ink-mute">{book.count} 词</span>
                      {book.isDefault && (
                        <span className="rounded-full bg-ink px-2 py-1 text-[11.5px] text-paper">默认</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* 新建 */}
          <div className="mt-4 rounded-[12px] border border-dashed border-line bg-paper-deep/30 p-4">
            <p className="text-[14px] text-ink-soft">新建一本词本</p>
            <div className="mt-2.5 flex gap-2.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createBook();
                }}
                maxLength={24}
                placeholder="词本名字"
                className="min-w-0 flex-1 rounded-[8px] border border-line bg-paper px-3.5 py-2.5 text-[15px] text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => void createBook()}
                disabled={busy || !newName.trim()}
                className="shrink-0 rounded-[8px] bg-ink px-5 py-2.5 text-[14px] text-paper disabled:opacity-35"
              >
                新建
              </button>
            </div>
          </div>
        </aside>

        {/* 右侧：选中词书的内容 */}
        <section className="min-w-0">
          {!selected ? (
            <div className="flex min-h-[260px] items-center justify-center rounded-[12px] border border-line bg-paper-deep/20">
              <p className="text-[15px] text-ink-mute">左边点一本词书，这里看内容、开始背。</p>
            </div>
          ) : (
            <div className="rounded-[12px] border border-line bg-surface">
              {/* 头部：书名 + 操作 */}
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
                <h3 className="min-w-0 font-serif text-[21px] text-ink">{selected.name}</h3>
                <span className="font-mono text-[14px] text-ink-mute">
                  {wordData?.words.length ?? selected.count} 个词
                </span>
                {selected.rule && (
                  <span className="hidden min-w-0 flex-1 truncate text-[12.5px] text-ink-mute sm:block">
                    {selected.rule}
                  </span>
                )}

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={selected.count === 0}
                    onClick={() => void startStudy(selected)}
                    className="rounded-full bg-ink px-5 py-2.5 text-[14.5px] text-paper disabled:opacity-30"
                  >
                    开始背（四选一 · 连对 3 次）
                  </button>
                  {selected.kind === "custom" && !selected.isDefault && (
                    <button
                      type="button"
                      onClick={() => void setDefault(selected)}
                      className="rounded-full px-3 py-2 text-[13px] text-ink-mute hover:text-ink"
                    >
                      设为默认
                    </button>
                  )}
                  {selected.kind === "custom" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void renameBook(selected)}
                        className="rounded-full px-3 py-2 text-[13px] text-ink-mute hover:text-ink"
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeBook(selected)}
                        className="rounded-full px-3 py-2 text-[13px] text-ink-mute hover:text-wrong"
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 自建词本的加词工具条 */}
              {selected.kind === "custom" && (
                <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-5 py-3">
                  <input
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void addWord();
                    }}
                    placeholder="加词，可用空格分隔多个"
                    className="min-w-0 flex-1 rounded-[8px] border border-line bg-paper px-3.5 py-2.5 text-[14.5px] text-ink outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void addWord()}
                    disabled={busy || !adding.trim()}
                    className="rounded-[8px] bg-ink px-5 py-2.5 text-[14px] text-paper disabled:opacity-35"
                  >
                    加入
                  </button>
                  <button
                    type="button"
                    onClick={() => void importExam("cet4-core", 50)}
                    disabled={busy}
                    className="rounded-[8px] border border-line px-5 py-2.5 text-[14px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-35"
                  >
                    复制四级高频 50
                  </button>
                  <button
                    type="button"
                    onClick={() => void importExam("cet6-core", 50)}
                    disabled={busy}
                    className="rounded-[8px] border border-line px-5 py-2.5 text-[14px] text-ink-soft hover:border-accent hover:text-accent disabled:opacity-35"
                  >
                    复制六级高频 50
                  </button>
                </div>
              )}

              {/* 词表 */}
              {wordsLoading && <p className="px-5 py-8 text-[15px] text-ink-mute">正在取词…</p>}

              {!wordsLoading && (
                <ul className="divide-y divide-line-soft">
                  {(wordData?.words ?? []).map((item) => (
                    <li key={item.word} className="flex items-baseline gap-4 px-5 py-4">
                      <span className="w-[11rem] shrink-0 truncate font-serif text-[19px] text-ink">
                        {item.word}
                      </span>
                      {item.phonetic && (
                        <span className="hidden w-[7.5rem] shrink-0 font-mono text-[13.5px] text-ink-mute md:block">
                          {item.phonetic}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 text-[15.5px] leading-relaxed text-ink-soft">
                        {item.definitions.map((d) => `${d.pos} ${d.zh}`.trim()).join("；") || "（暂无释义）"}
                      </span>
                      {selected.kind === "custom" && (
                        <button
                          type="button"
                          onClick={() => void removeWord(item.word)}
                          className="shrink-0 text-[13px] text-ink-mute hover:text-wrong"
                        >
                          移出
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {!wordsLoading && (wordData?.words.length ?? 0) === 0 && (
                <p className="px-5 py-10 text-center text-[15px] text-ink-mute">
                  {selected.kind === "reading"
                    ? "生词本还是空的。去刷题遇到不认识的词点一下，或手动加词，就会出现在这里。"
                    : selected.kind === "custom"
                      ? "空词本。上面输入框加几个词，或者从高频词书复制一批过来。"
                      : "这本书暂时取不到内容。"}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
