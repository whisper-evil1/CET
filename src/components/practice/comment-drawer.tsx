"use client";

import { useState } from "react";
import useSWR from "swr";
import { del, patchJson, postJson, swrFetcher } from "@/lib/api-client";
import type { CommentItem } from "@/lib/types";

type Props = {
  questionId: string;
  onClose: () => void;
};

type Tab = "private" | "public";

/**
 * 留言抽屉。
 * 私密/公开两个 tab，全部走服务端鉴权：私密只可能拿到自己的记录。
 * 公开后不可撤回为私密（服务端只允许 private → public）。
 */
export function CommentDrawer({ questionId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("private");

  return (
    <aside className="drawer-in fixed top-0 right-0 z-40 flex h-full w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-[-16px_0_40px_-24px_rgba(40,30,10,0.25)]">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
        <h3 className="text-[13px] font-medium text-ink">笔记与讨论</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="ml-auto text-[13px] text-ink-mute hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-line px-4 py-2">
        {(
          [
            { key: "private", label: "我的笔记", hint: "仅自己可见" },
            { key: "public", label: "公开讨论", hint: "所有人可见" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-[6px] px-3 py-1.5 text-[12.5px] transition-colors ${
              tab === item.key ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep"
            }`}
          >
            {item.label}
            <span className="ml-1.5 text-[10.5px] opacity-70">{item.hint}</span>
          </button>
        ))}
      </div>

      <CommentList key={`${questionId}-${tab}`} questionId={questionId} tab={tab} />
    </aside>
  );
}

function CommentList({ questionId, tab }: { questionId: string; tab: Tab }) {
  const key = `/api/questions/${questionId}/comments?scope=${tab}`;
  const { data, error, isLoading, mutate } = useSWR<CommentItem[]>(key, swrFetcher, {
    revalidateOnFocus: false,
  });

  const [content, setContent] = useState("");
  const [makePublic, setMakePublic] = useState(false);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const submit = async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    setMessage(null);
    try {
      await postJson(`/api/questions/${questionId}/comments`, {
        content,
        visibility: makePublic ? "public" : "private",
      });
      setContent("");
      setMakePublic(false);
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "发送失败");
    } finally {
      setPosting(false);
    }
  };

  const publish = async (id: string) => {
    try {
      await patchJson(`/api/comments/${id}`, { visibility: "public" });
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "操作失败");
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("删除这条留言？删除后无法恢复。")) return;
    try {
      await del(`/api/comments/${id}`);
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "删除失败");
    }
  };

  const like = async (id: string) => {
    try {
      await postJson(`/api/comments/${id}/like`, {});
      await mutate();
    } catch {
      /* 点赞失败不打断阅读，静默即可 */
    }
  };

  const reply = async (parentId: string) => {
    if (!replyText.trim()) return;
    try {
      await postJson(`/api/questions/${questionId}/comments`, {
        content: replyText,
        visibility: "public",
        parentId,
      });
      setReplyText("");
      setReplyTo(null);
      await mutate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "回复失败");
    }
  };

  const items = data ?? [];

  return (
    <>
      <div className="scroll-pane min-h-0 flex-1 px-4 py-4">
        {isLoading && (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-[8px] bg-line-soft/60" />
            ))}
          </div>
        )}

        {error && (
          <p className="rounded-[8px] border border-line bg-paper px-3 py-2 text-[12.5px] text-wrong">
            {error instanceof Error ? error.message : "加载失败"}
          </p>
        )}

        {!isLoading && !error && items.length === 0 && (
          <p className="px-1 py-10 text-center text-[12.5px] leading-relaxed text-ink-mute">
            {tab === "private"
              ? "还没有自己的笔记，记录一下这题的易错点吧"
              : "还没有人讨论这题，你是第一个"}
          </p>
        )}

        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-[8px] border border-line bg-surface px-3.5 py-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-paper-deep text-[10px] text-ink-soft">
                  {(item.author.name ?? "?").slice(0, 1)}
                </span>
                <span className="text-[12px] text-ink-soft">{item.author.name ?? "匿名"}</span>
                <span className="font-mono text-[10.5px] text-ink-mute">
                  {formatTime(item.createdAt)}
                </span>
                {item.visibility === "private" && (
                  <span className="rounded-full bg-paper-deep px-1.5 py-0.5 text-[10px] text-ink-mute">
                    仅自己
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.75] text-ink">
                {item.content}
              </p>

              <div className="mt-2 flex items-center gap-3 text-[11.5px] text-ink-mute">
                {item.visibility === "public" && (
                  <>
                    <button
                      type="button"
                      onClick={() => like(item.id)}
                      className="transition-colors hover:text-accent"
                    >
                      ♡ {item.likes}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyTo(replyTo === item.id ? null : item.id)}
                      className="transition-colors hover:text-ink"
                    >
                      回复
                    </button>
                  </>
                )}
                {item.visibility === "private" && item.isMine && (
                  <button
                    type="button"
                    onClick={() => publish(item.id)}
                    className="transition-colors hover:text-accent"
                  >
                    改为公开
                  </button>
                )}
                {item.isMine && (
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="ml-auto transition-colors hover:text-wrong"
                  >
                    删除
                  </button>
                )}
              </div>

              {item.replies.length > 0 && (
                <ul className="mt-2.5 space-y-2 border-l-2 border-line-soft pl-3">
                  {item.replies.map((child) => (
                    <li key={child.id}>
                      <p className="text-[11.5px] text-ink-mute">
                        {child.author.name ?? "匿名"} · {formatTime(child.createdAt)}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-[1.7] text-ink-soft">
                        {child.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {replyTo === item.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    maxLength={500}
                    placeholder="回复这条讨论…"
                    className="min-w-0 flex-1 rounded-[6px] border border-line px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => reply(item.id)}
                    className="rounded-[6px] bg-ink px-3 text-[12px] text-paper"
                  >
                    发送
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 发布区 */}
      <div className="shrink-0 border-t border-line px-4 py-3">
        {message && <p className="mb-2 text-[11.5px] text-wrong">{message}</p>}
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={500}
          rows={3}
          placeholder={
            tab === "private"
              ? "写下这题的易错点，只有你能看到…"
              : "说点什么，所有人可见…"
          }
          className="w-full resize-none rounded-[8px] border border-line bg-paper px-3 py-2 text-[13px] leading-[1.7] outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
            <input
              type="checkbox"
              checked={makePublic}
              onChange={(event) => setMakePublic(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            公开这则留言
          </label>
          <span className="ml-auto font-mono text-[10.5px] text-ink-mute">{content.length}/500</span>
          <button
            type="button"
            onClick={submit}
            disabled={!content.trim() || posting}
            className="rounded-full bg-accent px-4 py-1.5 text-[12.5px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {posting ? "发送中…" : "发布"}
          </button>
        </div>
        {makePublic && (
          <p className="mt-1.5 text-[11px] text-ink-mute">
            公开后所有人可见、可回复，且不能撤回为私密。
          </p>
        )}
      </div>
    </>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
