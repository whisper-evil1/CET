"use client";

import Link from "next/link";
import { StarRow } from "./game-hud";

/**
 * 配对四连共用的「开局卡 / 结算卡」。
 *
 * 四个游戏的规则不同，但开局要交代的东西完全一样（几条说明 + 一个开始按钮），
 * 结算要展示的东西也完全一样（星级 + 三个数字 + 错词 + 再来一局）。
 * 这层统一之后，四个游戏页面的视觉节奏和文案口径不会各写一套。
 *
 * 开始按钮是**必需**的，不只是仪式感：听音辨词和拼写达人要用 Web Audio /
 * 语音合成发声，浏览器要求先有一次用户手势，否则首次播放会被静默拦掉。
 */

export function GameIntro({
  bullets,
  cta,
  onStart,
  note,
}: {
  bullets: string[];
  cta: string;
  onStart: () => void;
  note?: string;
}) {
  return (
    <div className="card-soft mt-5 p-6 sm:p-8">
      <p className="text-[10.5px] tracking-[0.24em] g-blue uppercase">Ready</p>
      <h2 className="mt-2 font-serif text-[22px] g-ink">准备好了就开始</h2>
      <ul className="mt-4 space-y-2">
        {bullets.map((line) => (
          <li key={line} className="flex gap-2 text-[12.5px] leading-[1.8] g-mute">
            <span aria-hidden="true" className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#c9d2e0]" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-3 text-[11.5px] leading-[1.7] g-mute">{note}</p>}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onStart} className="btn-game">
          {cta}
        </button>
        <Link href="/arcade" className="btn-game-ghost">
          回游戏厅
        </Link>
      </div>
    </div>
  );
}

export type ResultStat = { label: string; value: string };

export function GameResult({
  headline,
  subline,
  stars,
  stats,
  wrong,
  wrongTitle,
  onAgain,
  againLabel = "再来一局",
}: {
  headline: string;
  subline?: string;
  stars: number;
  stats: ResultStat[];
  wrong?: { word: string; answer: string }[];
  wrongTitle?: string;
  onAgain: () => void;
  againLabel?: string;
}) {
  return (
    <div className="card-soft mt-5 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] tracking-[0.24em] g-blue uppercase">Round clear</p>
          <h2 className="mt-2 font-serif text-[23px] g-ink">{headline}</h2>
          {subline && <p className="mt-1.5 text-[12.5px] leading-[1.8] g-mute">{subline}</p>}
        </div>
        <StarRow stars={stars} size={22} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {stats.map((cell) => (
          <div key={cell.label} className="min-w-0 rounded-[12px] border g-line px-3 py-2.5">
            <p className="text-[10.5px] g-mute">{cell.label}</p>
            <p className="mt-1 truncate font-mono text-[17px] leading-none font-semibold g-ink">
              {cell.value}
            </p>
          </div>
        ))}
      </div>

      {wrong && wrong.length > 0 && (
        <div className="mt-5">
          <p className="text-[12px] g-mute">{wrongTitle ?? "这几个没记住，已经排到下一轮复习："}</p>
          <ul className="mt-2 divide-y divide-[#eef1f6] border-t g-line">
            {wrong.map((item) => (
              <li key={item.word} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
                <span className="font-mono text-[13.5px] font-medium g-ink">{item.word}</span>
                <span className="min-w-0 text-[12px] g-mute">{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5">
        <button type="button" onClick={onAgain} className="btn-game">
          {againLabel}
        </button>
        <Link href="/arcade" className="btn-game-ghost">
          回游戏厅
        </Link>
        <Link href="/vocab" className="btn-game-ghost">
          看生词本
        </Link>
      </div>
    </div>
  );
}

export function GameLoading({ text }: { text: string }) {
  return <div className="card-soft mt-5 p-10 text-center text-[13px] g-mute">{text}</div>;
}

export function GameError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="card-soft mt-5 p-8 text-center">
      <p className="text-[13.5px] text-wrong">{text}</p>
      <button type="button" onClick={onRetry} className="btn-game mt-4">
        重试
      </button>
    </div>
  );
}
