/**
 * 周期与日期工具。
 * 一律按服务器本地时区计算（线上与本机都是 Asia/Shanghai），与用户日历直观一致。
 * SQLite 把 DateTime 存成 UTC，这里用本地 Date 传进去由 driver 转换即可。
 */

export type PeriodType = "week" | "month";

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 当天 00:00:00.000（本地） */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 当月第一天 00:00 */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** 当月最后一天 23:59:59.999 */
export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

/** ISO 周：周一为一周开始 */
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay() === 0 ? 7 : x.getDay(); // Mon=1..Sun=7
  return addDays(x, -(day - 1));
}

export function endOfWeek(d: Date): Date {
  const e = addDays(startOfWeek(d), 7);
  e.setMilliseconds(e.getMilliseconds() - 1);
  return e;
}

/** ISO 周 key：YYYY-Www */
export function weekKey(d: Date): string {
  const date = startOfDay(d);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  const week = 1 + Math.round(((diff / 86400000) - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${pad(week)}`;
}

/** 月 key：YYYY-MM */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function periodKey(type: PeriodType, d: Date): string {
  return type === "week" ? weekKey(d) : monthKey(d);
}

export function periodRange(type: PeriodType, d: Date): { start: Date; end: Date } {
  return type === "week"
    ? { start: startOfWeek(d), end: endOfWeek(d) }
    : { start: startOfMonth(d), end: endOfMonth(d) };
}

/** "YYYY-MM-DD"（本地） */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
