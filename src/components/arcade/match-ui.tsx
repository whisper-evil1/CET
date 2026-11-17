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
  onBack,
  backLabel = "回游戏厅",
  large = false,
}: {
  bullets: string[];
  cta: string;
  onStart: () => void;
  note?: string;
  /** 嵌在别的页面里时用它返回（比如生词本里的背词模式）；不传就回游戏厅 */
  onBack?: () => void;
  backLabel?: string;
  /** 大号版：背单词板块用，字号与间距整体放大一档 */
  large?: boolean;
}) {
  return (
    <div className={`card-soft mx-auto mt-5 w-full max-w-[860px] ${large ? "p-8 sm:p-10" : "p-6 sm:p-8"}`}>
      <p className={`tracking-[0.24em] g-blue uppercase ${large ? "text-[12.5px]" : "text-[10.5px]"}`}>Ready</p>
      <h2 className={`mt-2.5 font-serif g-ink ${large ? "text-[28px]" : "text-[22px]"}`}>准备好了就开始</h2>
      <ul className={`mt-5 ${large ? "space-y-3" : "space-y-2"}`}>
        {bullets.map((line) => (
          <li key={line} className={`flex gap-2.5 leading-[1.8] g-mute ${large ? "text-[15.5px]" : "text-[12.5px]"}`}>
            <span aria-hidden="true" className={`mt-[7px] shrink-0 rounded-full bg-[#c9d2e0] ${large ? "h-[7px] w-[7px]" : "h-[5px] w-[5px]"}`} />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
      {note && <p className={`mt-4 leading-[1.7] g-mute ${large ? "text-[13.5px]" : "text-[11.5px]"}`}>{note}</p>}
      <div className="mt-7 flex flex-wrap items-center gap-3.5">
        <button type="button" onClick={onStart} className={large ? "btn-game-lg" : "btn-game"}>
          {cta}
        </button>
        {onBack ? (
          <button type="button" onClick={onBack} className={large ? "btn-game-ghost-lg" : "btn-game-ghost"}>
            {backLabel}
          </button>
        ) : (
          <Link href="/arcade" className={large ? "btn-game-ghost-lg" : "btn-game-ghost"}>
            {backLabel}
          </Link>
        )}
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
  onBack,
  backLabel = "回游戏厅",
  large = false,
}: {
  headline: string;
  subline?: string;
  stars: number;
  stats: ResultStat[];
  wrong?: { word: string; answer: string }[];
  wrongTitle?: string;
  onAgain: () => void;
  againLabel?: string;
  /** 嵌在别的页面里时用它返回；不传就回游戏厅 */
  onBack?: () => void;
  backLabel?: string;
  /** 大号版：背单词板块用 */
  large?: boolean;
}) {
  return (
    <div className={`card-soft mx-auto mt-5 w-full max-w-[860px] ${large ? "p-8 sm:p-10" : "p-6 sm:p-8"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`tracking-[0.24em] g-blue uppercase ${large ? "text-[12.5px]" : "text-[10.5px]"}`}>Round clear</p>
          <h2 className={`mt-2.5 font-serif g-ink ${large ? "text-[29px]" : "text-[23px]"}`}>{headline}</h2>
          {subline && <p className={`mt-2 leading-[1.8] g-mute ${large ? "text-[15px]" : "text-[12.5px]"}`}>{subline}</p>}
        </div>
        <StarRow stars={stars} size={large ? 28 : 22} />
      </div>

      <div className={`mt-6 grid grid-cols-3 ${large ? "gap-3" : "gap-2.5"}`}>
        {stats.map((cell) => (
          <div key={cell.label} className={`min-w-0 rounded-[12px] border g-line ${large ? "px-4 py-3.5" : "px-3 py-2.5"}`}>
            <p className={`g-mute ${large ? "text-[12.5px]" : "text-[10.5px]"}`}>{cell.label}</p>
            <p className={`mt-1.5 truncate font-mono leading-none font-semibold g-ink ${large ? "text-[21px]" : "text-[17px]"}`}>
              {cell.value}
            </p>
          </div>
        ))}
      </div>

      {wrong && wrong.length > 0 && (
        <div className="mt-6">
          <p className={`g-mute ${large ? "text-[14px]" : "text-[12px]"}`}>{wrongTitle ?? "这几个没记住，已经排到下一轮复习："}</p>
          <ul className="mt-2.5 divide-y divide-[#eef1f6] border-t g-line">
            {wrong.map((item) => (
              <li key={item.word} className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-1 ${large ? "py-2.5" : "py-2"}`}>
                <span className={`font-mono font-medium g-ink ${large ? "text-[16px]" : "text-[13.5px]"}`}>{item.word}</span>
                <span className={`min-w-0 g-mute ${large ? "text-[14px]" : "text-[12px]"}`}>{item.answer}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`mt-7 flex flex-wrap ${large ? "gap-3" : "gap-2.5"}`}>
        <button type="button" onClick={onAgain} className={large ? "btn-game-lg" : "btn-game"}>
          {againLabel}
        </button>
        {onBack ? (
          <>
            <button type="button" onClick={onBack} className={large ? "btn-game-ghost-lg" : "btn-game-ghost"}>
              {backLabel}
            </button>
          </>
        ) : (
          <>
            <Link href="/arcade" className={large ? "btn-game-ghost-lg" : "btn-game-ghost"}>
              {backLabel}
            </Link>
            <Link href="/vocab" className={large ? "btn-game-ghost-lg" : "btn-game-ghost"}>
              看生词本
            </Link>
          </>
        )}
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
