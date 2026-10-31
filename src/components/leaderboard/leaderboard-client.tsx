"use client";

import { useState } from "react";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import type { CheckinData, LeaderboardEntry } from "@/lib/types";

type Level = "CET4" | "CET6";
type Period = "week" | "month";

type LeaderboardPayload = {
  list: LeaderboardEntry[];
  me: (LeaderboardEntry & { rank: number | null }) | null;
};

const MEDAL = ["🥇", "🥈", "🥉"];

export function LeaderboardClient() {
  const [level, setLevel] = useState<Level>("CET4");
  const [period, setPeriod] = useState<Period>("week");

  const { data, isLoading } = useSWR<LeaderboardPayload>(
    `/api/leaderboard?level=${level}&period=${period}`,
    swrFetcher,
  );
  const { data: checkin } = useSWR<CheckinData>("/api/checkin", swrFetcher);

  const list = data?.list ?? [];
  const me = data?.me ?? null;

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-paper p-1">
          {(["CET4", "CET6"] as Level[]).map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                level === lv ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {lv === "CET4" ? "四级" : "六级"}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-line bg-paper p-1">
          {(["week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-colors ${
                period === p ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
              }`}
            >
              {p === "week" ? "周榜" : "月榜"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-ink-mute">
          {period === "week" ? "本周" : "本月"} · 积分 = 答题×2 + 答对×3 + 打卡×10 + 生词×1
        </span>
      </div>

      {/* 打卡卡 */}
      <CheckinCard data={checkin} />

      {/* 榜单 */}
      <section className="rounded-lg border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-serif text-[16px] text-ink">
            {level === "CET4" ? "四级" : "六级"}
            {period === "week" ? "周榜" : "月榜"}
          </h2>
          <span className="text-[11px] text-ink-mute">
            共 {list.length} 人上榜
          </span>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-[13px] text-ink-mute">加载中…</div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-ink-mute">
            还没有人上榜，去刷 5 道题抢占榜首吧
          </div>
        ) : (
          <>
            {/* 前三名领奖台 */}
            <Podium list={list} />
            <div className="divide-y divide-line">
              {list.slice(3).map((entry) => (
                <RankRow key={entry.userId} entry={entry} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* 我的排名 */}
      {me && (
        <section className="sticky bottom-4 rounded-lg border border-accent/40 bg-accent/5 shadow-sm">
          <div className="flex items-center gap-4 px-5 py-3.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[13px] font-bold text-white">
              {me.rank ?? "—"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink">我的排名</p>
              <p className="text-[11px] text-ink-mute">
                答题 {me.questionCount} · 正确率 {me.accuracy}% · 打卡 {me.checkinDays} 天 · 生词 {me.newVocab}
              </p>
            </div>
            <div className="text-right">
              <p className="font-serif text-[20px] text-ink">{Math.round(me.totalScore)}</p>
              <p className="text-[10px] tracking-[0.14em] text-ink-mute">积分</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Podium({ list }: { list: LeaderboardEntry[] }) {
  const [first, second, third] = list;
  const items = [second, first, third].filter(Boolean) as LeaderboardEntry[];
  const heights = ["h-16", "h-24", "h-12"];
  const order = [1, 0, 2]; // 2nd, 1st, 3rd

  return (
    <div className="flex items-end justify-center gap-3 px-5 py-8">
      {items.map((entry, i) => (
        <div key={entry.userId} className="flex w-28 flex-col items-center gap-2">
          <span className="text-[22px]">{MEDAL[order[i]]}</span>
          <p className="max-w-full truncate text-[12px] text-ink">{entry.userName ?? "匿名"}</p>
          <p className="font-serif text-[15px] text-ink">{Math.round(entry.totalScore)}</p>
          <div className={`flex w-full ${heights[i]} items-start justify-center rounded-t-md bg-paper-deep pt-2`}>
            <span className="text-[11px] text-ink-mute">{entry.rank}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RankRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <span className="w-6 text-center font-mono text-[13px] text-ink-mute">{entry.rank}</span>
      <span className="grid h-7 w-7 place-items-center rounded-full bg-paper-deep text-[11px] text-ink">
        {(entry.userName ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">{entry.userName ?? "匿名"}</p>
        <p className="text-[11px] text-ink-mute">
          答题 {entry.questionCount} · 正确率 {entry.accuracy}% · 打卡 {entry.checkinDays} 天
        </p>
      </div>
      <span className="font-serif text-[15px] text-ink">{Math.round(entry.totalScore)}</span>
    </div>
  );
}

function CheckinCard({ data }: { data: CheckinData | undefined }) {
  if (!data) {
    return (
      <section className="rounded-lg border border-line bg-paper px-5 py-8 text-center text-[13px] text-ink-mute">
        加载打卡数据…
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-[16px] text-ink">本月打卡</h2>
          <p className="mt-1 text-[12px] text-ink-mute">
            当天任意级别答题满 5 题即打卡，无需手动点击
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <p className="font-serif text-[22px] leading-none text-ink">{data.monthDays}</p>
            <p className="mt-1 text-[10px] tracking-[0.14em] text-ink-mute">本月天数</p>
          </div>
          <div>
            <p className="font-serif text-[22px] leading-none text-ink">{data.streak}</p>
            <p className="mt-1 text-[10px] tracking-[0.14em] text-ink-mute">连续天数</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["CET4", "CET6"] as const).map((lv) => (
          <div
            key={lv}
            className={`rounded-md border px-3 py-2 text-[12px] ${
              data.checkedIn[lv]
                ? "border-correct/40 bg-correct/10 text-correct"
                : "border-line text-ink-soft"
            }`}
          >
            {lv === "CET4" ? "四级" : "六级"} · 今日 {data.today[lv]}/5
            {data.checkedIn[lv] ? "  ✓ 已打卡" : "  继续加油"}
          </div>
        ))}
      </div>

      {/* 日历 */}
      <div className="mt-5 grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(7,minmax(0,1fr))]">
        {data.calendar.map((day) => {
          const checked = day.levels.length > 0;
          return (
            <div
              key={day.date}
              title={`${day.date}${checked ? ` · ${day.levels.join("、")}` : ""}`}
              className={`grid aspect-square place-items-center rounded text-[11px] ${
                checked
                  ? "bg-accent text-white"
                  : "bg-paper-deep text-ink-mute"
              }`}
            >
              {Number(day.date.slice(-2))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
