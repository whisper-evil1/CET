"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 每日签到：导航里的入口 + 进站自动弹窗 + 签到后的庆祝彩蛋。
 *
 * 三个刻意的决定：
 * 1. 弹窗挂到 document.body（portal）。header 上有 backdrop-blur，
 *    它会成为 fixed 后代的包含块，弹窗会被锁在导航条里。
 * 2. 自动弹窗一天只弹一次（sessionStorage 记账），否则每次点导航都糊脸。
 * 3. 失败一律静默：签到是锦上添花，不能因为它挂掉把整站交互拖住。
 */

type Week = { day: string; label: string; signed: boolean; isToday: boolean };
type Egg = { index: number; title: string; en: string; zh: string };
type State = {
  signedToday: boolean;
  streak: number;
  totalDays: number;
  day: string;
  week: Week[];
  egg: Egg;
};

type ApiBody<T> = { code: number; message: string; data: T | null };

/** 纸屑：位置/延迟/颜色全部写死，避免每次渲染跳动 */
const CONFETTI = [
  { left: 6, delay: 0, color: "#e7b6b0", w: 6, h: 9 },
  { left: 14, delay: 120, color: "#b9c9e2", w: 7, h: 7 },
  { left: 22, delay: 60, color: "#cdbfe3", w: 5, h: 10 },
  { left: 30, delay: 200, color: "#f0d3ae", w: 7, h: 8 },
  { left: 38, delay: 30, color: "#bfd6c8", w: 6, h: 6 },
  { left: 46, delay: 160, color: "#e7b6b0", w: 8, h: 7 },
  { left: 54, delay: 90, color: "#b9c9e2", w: 5, h: 9 },
  { left: 62, delay: 240, color: "#cdbfe3", w: 7, h: 8 },
  { left: 70, delay: 20, color: "#f0d3ae", w: 6, h: 6 },
  { left: 78, delay: 180, color: "#bfd6c8", w: 7, h: 9 },
  { left: 86, delay: 70, color: "#e7b6b0", w: 5, h: 8 },
  { left: 94, delay: 150, color: "#b9c9e2", w: 6, h: 7 },
];

const WEEK_NAME = ["日", "一", "二", "三", "四", "五", "六"];

function dateLabel(day: string) {
  const [y, m, d] = day.split("-").map((n) => Number(n));
  if (!y || !m || !d) return day;
  const wd = new Date(y, m - 1, d).getDay();
  return `${m} 月 ${d} 日 · 周${WEEK_NAME[wd] ?? ""}`;
}

export function SignInCenter() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 拉一次今日状态；未登录（401）就安静退出，不弹任何东西
  useEffect(() => {
    let alive = true;
    fetch("/api/signin", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as ApiBody<State>;
      })
      .then((body) => {
        if (!alive || !body?.data) return;
        setState(body.data);
        if (body.data.signedToday) return;
        // 背单词页不自动弹：那里是「进来就开始背」的场景，一张签到卡片正好压在
        // 第一个词上面，得先关掉才能看题。不写 sessionStorage 就等于没消耗今天的
        // 额度，回到首页/其它页照样会弹一次。
        // 背单词已并入生词本（/vocab），两处都不自动弹。
        const p = window.location.pathname;
        if (p.startsWith("/study") || p.startsWith("/vocab")) return;
        const key = `signin:auto:${body.data.day}`;
        try {
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, "1");
        } catch {
          // 隐私模式下 sessionStorage 可能抛错，照常自动弹
        }
        window.setTimeout(() => setOpen(true), 900);
      })
      .catch(() => {
        /* 签到状态拿不到不影响页面其它功能 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 打开时锁滚动 + ESC 关闭
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openDialog = useCallback(() => {
    setMessage("");
    setOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/signin", { method: "POST", headers: { accept: "application/json" } });
      const body = (await res.json()) as ApiBody<State & { isNew?: boolean }>;
      if (!res.ok || !body.data) {
        setMessage(body.message || "签到没成功，稍后再试一次");
        return;
      }
      setState(body.data);
      setCelebrate(true);
    } catch {
      setMessage("网络不太稳，稍后再试一次");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const alreadySigned = state?.signedToday ?? false;
  const dayLabel = useMemo(() => (state ? dateLabel(state.day) : ""), [state]);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="signin-chip"
        aria-haspopup="dialog"
        aria-label={alreadySigned ? "查看今日签到" : "去签到"}
      >
        <span className={alreadySigned ? "signin-dot is-done" : "signin-dot"} aria-hidden="true" />
        签到
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="signin-mask"
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="signin-panel">
              <button
                type="button"
                ref={closeRef}
                onClick={() => setOpen(false)}
                className="signin-close"
                aria-label="关闭签到弹窗"
              >
                ×
              </button>

              {celebrate ? (
                <div className="signin-celebrate">
                  <div className="signin-confetti-field" aria-hidden="true">
                    {CONFETTI.map((c, i) => (
                      <span
                        key={i}
                        className="signin-confetti"
                        style={{
                          left: `${c.left}%`,
                          width: c.w,
                          height: c.h,
                          background: c.color,
                          animationDelay: `${c.delay}ms`,
                        }}
                      />
                    ))}
                  </div>

                  <p className="signin-kicker">CHECKED IN</p>
                  <h2 id="signin-title" className="signin-title">
                    签到成功
                  </h2>
                  <p className="signin-sub">
                    {state?.streak ?? 1} 天连着来，今天也没有断。
                  </p>

                  <div className="signin-egg">
                    <p className="signin-egg-title">{state?.egg.title ?? "今日彩蛋"}</p>
                    <p className="signin-egg-en">{state?.egg.en ?? ""}</p>
                    <p className="signin-egg-zh">{state?.egg.zh ?? ""}</p>
                  </div>

                  <button type="button" className="signin-primary" onClick={() => setOpen(false)}>
                    收下，去练一关
                  </button>
                </div>
              ) : (
                <div className="signin-body">
                  <p className="signin-kicker">DAILY CHECK-IN</p>
                  <h2 id="signin-title" className="signin-title">
                    {alreadySigned ? "今天已经签过" : "今日签到"}
                  </h2>
                  <p className="signin-sub">{dayLabel}</p>

                  <div className="signin-week">
                    {(state?.week ?? []).map((d) => (
                      <div key={d.day} className="signin-week-item">
                        <span className="signin-week-label">{d.label}</span>
                        <span
                          className={`signin-week-dot${d.signed ? " is-signed" : ""}${
                            d.isToday ? " is-today" : ""
                          }`}
                        >
                          {d.signed ? "✓" : d.day.slice(-2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="signin-stats">
                    <div>
                      <p className="signin-stat-value">{state?.streak ?? 0}</p>
                      <p className="signin-stat-label">连续天数</p>
                    </div>
                    <span className="signin-stat-line" aria-hidden="true" />
                    <div>
                      <p className="signin-stat-value">{state?.totalDays ?? 0}</p>
                      <p className="signin-stat-label">累计签到</p>
                    </div>
                  </div>

                  {alreadySigned ? (
                    <>
                      <p className="signin-note">彩蛋已经收好了，明天再来开一颗。</p>
                      <button type="button" className="signin-ghost" onClick={() => setOpen(false)}>
                        知道了
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="signin-primary"
                        onClick={submit}
                        disabled={busy}
                      >
                        {busy ? "签到中…" : "签到"}
                      </button>
                      <p className="signin-note">每天签一次，会随机揭晓一颗英文彩蛋。</p>
                    </>
                  )}

                  {message && <p className="signin-error">{message}</p>}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
