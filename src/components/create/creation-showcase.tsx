"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * 创作平台效果展示区。
 *
 * 解决的问题：入口卡只有文字描述，访客看不出「做出来到底长什么样」。
 * 每个工作台给两个标签页：
 *   效果示例 —— 小说放段级中英对照成品，视频放成片 + 发布包；
 *   创作教程 —— 四步流程，看完就知道怎么用。
 */

type Tab = "sample" | "guide";

function TabBar({
  active,
  onChange,
  createHref,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  createHref: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      {(
        [
          ["sample", "效果示例"],
          ["guide", "创作教程"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1 text-[11.5px] transition-colors ${
            active === key
              ? "bg-ink text-paper"
              : "border border-line text-ink-soft hover:border-accent hover:text-accent"
          }`}
        >
          {label}
        </button>
      ))}
      <Link
        href={createHref}
        className="ml-auto rounded-full bg-accent px-3 py-1 text-[11.5px] text-white transition-opacity hover:opacity-85"
      >
        开始创作 →
      </Link>
    </div>
  );
}

function StepRow({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[10px] text-accent">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] text-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-[1.7] text-ink-mute">{hint}</span>
      </span>
    </li>
  );
}

/* ---------------- 小说英译：公版示例（鲁迅《故乡》，1921） ---------------- */

const NOVEL_PAIRS = [
  {
    zh: "我冒了严寒，回到相隔二千余里，别了二十余年的故乡去。",
    en: "I braved the bitter cold and set out for my old home — the place I had left more than twenty years ago, now over a thousand miles behind me.",
  },
  {
    zh: "时候既然是深冬；渐近故乡时，天气又阴晦了，冷风吹进船舱中，呜呜的响。",
    en: "It was the depth of winter. As we drew near, the sky turned grey and sullen, and a cold wind moaned through the cabin of the boat.",
  },
  {
    zh: "我所记得的故乡全不如此。我的故乡好得多了。",
    en: "The home I remembered was nothing like this. My home had been so much better than this.",
  },
];

const NOVEL_GLOSSARY = [
  { term: "故乡", gloss: "hometown; the place one grew up and left behind" },
  { term: "二十余里", gloss: "over twenty li (a li ≈ half a kilometer)" },
];

/* ---------------- 短视频：发布包示例（成都火锅，与工作台示例同稿） ---------------- */

const VIDEO_PACKAGE = {
  title: "Chengdu Hotpot: Why the Broth Simmers 40 Minutes First",
  titleChars: 56,
  hooks: [
    "Think hotpot is just spicy? Chengdu cooks it for fragrance.",
    "Before you touch a single ingredient, the broth has already simmered 40 minutes.",
    "The order you dip matters — get it wrong and the soup turns cloudy.",
  ],
  scenes: [
    {
      sec: "0-3s",
      visual: "特写：红汤沸腾，热气上涌",
      caption: "Think hotpot is just spicy?",
    },
    {
      sec: "3-10s",
      visual: "炒料：牛油化开，下豆瓣、花椒慢炒",
      caption: "First comes 40 minutes of stir-frying the base.",
    },
    {
      sec: "10-22s",
      visual: "涮菜：毛肚七上八下，鸭肠十秒提起",
      caption: "Tripe in and out 8 times. Intestine: 10 seconds.",
    },
    {
      sec: "22-30s",
      visual: "围炉全景，热气腾腾",
      caption: "Come to Chengdu. Sit down and taste the steam.",
    },
  ],
  hashtags: ["#ChengduFood", "#Hotpot", "#ChineseFood", "#FoodTok", "#Sichuan"],
  coverText: "40 minutes before the first bite",
};

/* ================================================================ */

export function CreationShowcase() {
  const [novelTab, setNovelTab] = useState<Tab>("sample");
  const [videoTab, setVideoTab] = useState<Tab>("sample");

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-[19px] text-ink">创作平台</h2>
        <span className="text-[11.5px] text-ink-mute">
          效果示例 + 创作教程 · 不用点进工作台也能看懂做出来是什么样
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* ================= 小说英译改编 ================= */}
        <div className="card-soft flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="tile-rose flex h-9 w-9 items-center justify-center rounded-[9px] font-serif text-[15px]">
              译
            </span>
            <div className="min-w-0">
              <h3 className="font-serif text-[16px] text-ink">小说英译改编</h3>
              <p className="text-[11px] text-ink-mute">中文小说 → 英语读者读得懂的版本</p>
            </div>
          </div>

          <TabBar active={novelTab} onChange={setNovelTab} createHref="/create/novel" />

          {novelTab === "sample" ? (
            <div className="mt-4 space-y-3">
              <p className="text-[11px] text-ink-mute">
                示例：鲁迅《故乡》开篇 · 文学化风格 · 段级对照
              </p>
              {NOVEL_PAIRS.map((pair, i) => (
                <div key={i} className="rounded-[10px] border border-line-soft p-3">
                  <p className="text-[11.5px] leading-[1.8] text-ink-soft">{pair.zh}</p>
                  <div className="mt-2 border-t border-line-soft pt-2">
                    <p className="font-serif text-[12px] leading-[1.85] text-ink">{pair.en}</p>
                  </div>
                </div>
              ))}
              <div className="rounded-[10px] bg-paper-deep p-3">
                <p className="text-[10.5px] tracking-wider text-ink-mute uppercase">专名表</p>
                <ul className="mt-1.5 space-y-1">
                  {NOVEL_GLOSSARY.map((g) => (
                    <li key={g.term} className="text-[11px] leading-[1.7] text-ink-soft">
                      <span className="font-medium text-ink">{g.term}</span> — {g.gloss}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ol className="mt-4 space-y-3">
              <StepRow
                n={1}
                title="贴入中文原文"
                hint="小说片段、散文、故事均可，按空行分段，最多 6000 字。"
              />
              <StepRow
                n={2}
                title="选改编风格"
                hint="文学化（保留叙述腔调）/ 简明英语（B1 可读）/ 青少年向（口语节奏）。"
              />
              <StepRow
                n={3}
                title="生成段级对照稿"
                hint="每段中英对照，改没改丢一眼看得出来；附专名表 + 改编说明。"
              />
              <StepRow
                n={4}
                title="导出或存作品库"
                hint="一键导出 Markdown；存入作品库后随时回来继续改。"
              />
            </ol>
          )}
        </div>

        {/* ================= 短视频出海 ================= */}
        <div className="card-soft flex flex-col p-5">
          <div className="flex items-center gap-2">
            <span className="tile-sky flex h-9 w-9 items-center justify-center rounded-[9px] font-serif text-[15px]">
              影
            </span>
            <div className="min-w-0">
              <h3 className="font-serif text-[16px] text-ink">短视频出海</h3>
              <p className="text-[11px] text-ink-mute">中文口播稿 → YouTube Shorts / TikTok 发布包</p>
            </div>
          </div>

          <TabBar active={videoTab} onChange={setVideoTab} createHref="/create/video" />

          {videoTab === "sample" ? (
            <div className="mt-4 space-y-3">
              <p className="text-[11px] text-ink-mute">
                示例：「成都火锅」口播稿 · YouTube Shorts · 30s
              </p>

              {/* 成片示意 */}
              <div className="overflow-hidden rounded-[10px] border border-line-soft bg-ink">
                <video
                  src="/demo/hotpot-demo.mp4"
                  controls
                  playsInline
                  preload="metadata"
                  className="mx-auto block max-h-[300px] w-full max-w-[200px] bg-black"
                >
                  你的浏览器不支持视频播放，请升级浏览器查看效果示例。
                </video>
                <p className="px-3 py-1.5 text-center text-[10px] text-paper/70">
                  成片效果示意 · 实际产出为可拍摄的发布包
                </p>
              </div>

              {/* 发布包 */}
              <div className="rounded-[10px] border border-line-soft p-3">
                <p className="text-[10.5px] tracking-wider text-ink-mute uppercase">
                  发布包 · 英文标题
                </p>
                <p className="mt-1 font-serif text-[12.5px] leading-[1.7] text-ink">
                  {VIDEO_PACKAGE.title}
                </p>
                <p className="mt-1 text-[10px] text-correct">
                  ✓ {VIDEO_PACKAGE.titleChars}/60 字符（平台硬规则校验通过）
                </p>

                <p className="mt-3 text-[10.5px] tracking-wider text-ink-mute uppercase">
                  开场钩子（3 选 1）
                </p>
                <ul className="mt-1 space-y-1">
                  {VIDEO_PACKAGE.hooks.map((hook, i) => (
                    <li key={i} className="text-[11px] leading-[1.7] text-ink-soft">
                      {hook}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-[10.5px] tracking-wider text-ink-mute uppercase">
                  秒级分镜 · 字幕
                </p>
                <ul className="mt-1 space-y-1.5">
                  {VIDEO_PACKAGE.scenes.map((scene) => (
                    <li key={scene.sec} className="text-[11px] leading-[1.7]">
                      <span className="mr-1.5 inline-block rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[9.5px] text-ink-mute">
                        {scene.sec}
                      </span>
                      <span className="text-ink-soft">{scene.visual}</span>
                      <span className="mt-0.5 block text-[10.5px] text-ink-mute">
                        字幕：{scene.caption}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-3 text-[10.5px] tracking-wider text-ink-mute uppercase">
                  话题标签 · 封面文案
                </p>
                <p className="mt-1 text-[11px] text-accent">{VIDEO_PACKAGE.hashtags.join(" ")}</p>
                <p className="mt-1 text-[11px] text-ink-soft">
                  封面：{VIDEO_PACKAGE.coverText}
                </p>
              </div>
            </div>
          ) : (
            <ol className="mt-4 space-y-3">
              <StepRow
                n={1}
                title="写一段中文口播稿"
                hint="20 字以上即可；讲一个点就好——美食、节日、城市、非遗都行。"
              />
              <StepRow
                n={2}
                title="选平台与时长"
                hint="YouTube Shorts / TikTok，30 秒或 60 秒；语气可选温和讲述 / 快节奏 / 纪录片旁白。"
              />
              <StepRow
                n={3}
                title="生成英文发布包"
                hint="英文标题（超 60 字符自动标红）+ 3 个开场钩子 + 秒级分镜 + 字幕 + 标签 + 封面文案。"
              />
              <StepRow
                n={4}
                title="照包拍摄发布"
                hint="按分镜拍片、把字幕压上去就能发；发布包可导出 Markdown 存档。"
              />
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
