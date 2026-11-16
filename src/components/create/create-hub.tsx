"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DeleteWorkButton } from "@/components/create/delete-work-button";

/**
 * 创作中心 · 作品列表（客户端 tab）。
 *
 * 数据来自服务端预取的作品数组，本组件只负责「全部 / 小说英译 / 短视频」三档切换。
 * 截图里的「推荐作品 / 创作教程」项目没有对应数据源，不做假 tab、不造假数据。
 * 每个 tab 的新建按钮指向真实工作台，切换时列表按 kind 过滤。
 */
export type HubWork = {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  preview: string;
};

type Tab = "all" | "novel" | "video";

const TABS: { key: Tab; label: string; href: string; newLabel: string }[] = [
  { key: "all", label: "全部作品", href: "/create/novel", newLabel: "新建作品" },
  { key: "novel", label: "小说英译", href: "/create/novel", newLabel: "新建作品" },
  { key: "video", label: "短视频出海", href: "/create/video", newLabel: "新建视频" },
];

function kindLabel(kind: string): string {
  return kind === "novel" ? "小说英译" : "短视频出海";
}

/** 封面：不画假插画，用首字 + 作品类型色块做诚实占位 */
function Cover({ work }: { work: HubWork }) {
  const isNovel = work.kind === "novel";
  const glyph = (work.title || (isNovel ? "译" : "影")).trim().charAt(0);
  return (
    <div className={`hub-cover ${isNovel ? "hub-cover-novel" : "hub-cover-video"}`}>
      <span className="hub-cover-glyph">{glyph}</span>
      <span className="hub-cover-kind">{isNovel ? "TEXT → EN" : "VIDEO → EN"}</span>
    </div>
  );
}

export function CreateHub({
  works,
  signedIn,
}: {
  works: HubWork[];
  signedIn: boolean;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  const shown = useMemo(
    () => (tab === "all" ? works : works.filter((w) => w.kind === tab)),
    [works, tab],
  );

  return (
    <section className="mt-10" aria-labelledby="hub-works-title">
      <div className="hub-section-head">
        <div>
          <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">My Works</p>
          <h2 id="hub-works-title" className="mt-1 font-serif text-[20px] text-ink sm:text-[22px]">
            我的创作
          </h2>
        </div>
        <Link href={active.href} className="hub-new-btn">
          <span aria-hidden className="text-[15px] leading-none">＋</span>
          {active.newLabel}
        </Link>
      </div>

      <div className="hub-tabs" role="tablist" aria-label="作品分类">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`hub-tab ${tab === t.key ? "hub-tab-active" : ""}`}
          >
            {t.label}
            <span className="hub-tab-count">
              {t.key === "all" ? works.length : works.filter((w) => w.kind === t.key).length}
            </span>
          </button>
        ))}
      </div>

      {!signedIn && (
        <div className="hub-empty">
          <p className="text-[13px] text-ink-soft">登录后保存的作品会出现在这里。</p>
          <Link href="/login" className="hub-empty-btn">去登录</Link>
        </div>
      )}

      {signedIn && shown.length === 0 && (
        <div className="hub-empty">
          <p className="text-[13px] text-ink-soft">
            {tab === "all" ? "还没有作品，选一个工作台开始。" : `还没有${kindLabel(tab)}作品。`}
          </p>
          <Link href={active.href} className="hub-empty-btn">{active.newLabel}</Link>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="hub-grid">
          {shown.map((work) => (
            <li key={work.id} className="hub-work-card">
              <Cover work={work} />
              <div className="hub-work-body">
                <div className="flex items-start justify-between gap-2">
                  <span className={`hub-kind-tag ${work.kind === "novel" ? "hub-kind-novel" : "hub-kind-video"}`}>
                    {kindLabel(work.kind)}
                  </span>
                  <DeleteWorkButton id={work.id} />
                </div>
                <Link
                  href={`/create/${work.kind}?id=${work.id}`}
                  className="mt-2 block truncate font-serif text-[15px] text-ink transition-colors hover:text-accent"
                  title={work.title}
                >
                  {work.title}
                </Link>
                <p className="mt-1 line-clamp-2 min-h-[36px] text-[11.5px] leading-[1.7] text-ink-mute">
                  {work.preview || "（无预览内容）"}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
                  <span className="text-[10.5px] text-ink-mute">
                    {new Date(work.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                  <Link
                    href={`/create/${work.kind}?id=${work.id}`}
                    className="text-[11px] text-accent transition-opacity hover:opacity-70"
                  >
                    打开 →
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
