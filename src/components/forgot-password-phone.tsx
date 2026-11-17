"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { cloud, cloudReady } from "@/lib/cloud";
import { PASSWORD_HINT, passwordIssue } from "@/lib/password-policy";

/**
 * 忘记密码的**手机号**通道。
 *
 * 为什么必须补这条路：短信验证码登录是本站的主要进门方式，一批账号只有手机号、
 * 连邮箱都没绑。以前的「忘记密码」只有邮箱一条路，对这些人等于没有找回功能 ——
 * 只能去「我的」现绑一个邮箱，可他们恰恰连密码都忘了、根本进不去。
 *
 * 凭证从哪来：和绑定手机号、验证码登录共用同一套 —— 浏览器用云 SDK 发码验码，
 * 拿到 accessToken 交给服务端，服务端再拿它去云端换身份。手机号本身自报无效。
 *
 * 两种用法（variant）：
 *   - inline：嵌在「我的 → 修改密码」里。号码是账号已绑的那个，只读锁定，
 *     因为这一屏改的是「我自己」的密码，能换号就等于能改别人的；
 *     没绑手机号时给一个「去绑定手机号」的出口。
 *   - page：登录页的「忘记密码」。人还没进门，站里不知道他是谁，
 *     号码必须手输；改完顺手用「手机号 + 新密码」自动登录一次。
 */
type Props = {
  /** 已知号码（我的页）；为空时按 variant 决定是手输还是引导去绑定 */
  phone?: string | null;
  variant?: "inline" | "page";
  /** 嵌在别的面板里时不要自带外框（渠道切换栏已经在外层了） */
  bare?: boolean;
  /** inline 且账号没绑手机号时，跳去上面的绑定面板 */
  onBindPhone?: () => void;
  /** 密码已落库 */
  onDone: () => void;
  onCancel: () => void;
  /** page 变体：改完之后用新密码自动登录；失败由本组件兜住，不改结论 */
  onLogin?: (identifier: string, password: string) => Promise<void>;
};

export function ForgotPasswordPhone({
  phone,
  variant = "inline",
  bare = false,
  onBindPhone,
  onDone,
  onCancel,
  onLogin,
}: Props) {
  const locked = Boolean(phone);
  const [target, setTarget] = useState(phone ?? "");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [challenge, setChallenge] = useState<{
    verificationId: string;
    isExistingUser: boolean;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const startCountdown = () => {
    if (timer.current) clearInterval(timer.current);
    setCountdown(60);
    timer.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    setError(null);
    setLoginMsg(null);

    if (!cloudReady || !cloud) {
      setError("当前环境未启用云服务，短信发不出去，请改用邮箱找回。");
      return;
    }
    const value = target.trim();
    if (!/^1[3-9]\d{9}$/.test(value)) {
      setError("请输入正确的 11 位手机号");
      return;
    }

    setSending(true);
    try {
      const sent = await cloud.auth.sendOtp({ phone: value });
      if (sent.error || !sent.data) {
        setError(sent.error?.message ?? "验证码发送失败，请稍后重试");
        return;
      }
      setChallenge({
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      });
      startCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setLoginMsg(null);

    const value = target.trim();
    if (!/^1[3-9]\d{9}$/.test(value)) return setError("请输入正确的 11 位手机号");
    if (!challenge) return setError("先点「获取验证码」，收到短信后再填");
    if (!/^\d{4,8}$/.test(code.trim())) return setError("先填短信里的验证码");
    // 规则与「修改密码」表单同一份，见 lib/password-policy.ts
    const issue = passwordIssue(next);
    if (issue) return setError(issue);
    if (next !== confirm) return setError("两次输入的新密码不一样，检查一下");

    setSubmitting(true);
    try {
      if (!cloud || !cloudReady) throw new Error("当前环境未启用云服务");
      const verified = await cloud.auth.verifyOtp({
        verificationId: challenge.verificationId,
        token: code.trim(),
        isExistingUser: challenge.isExistingUser,
        phone: value,
      });
      if (verified.error) {
        setError(verified.error.message ?? "验证码不正确或已过期");
        return;
      }

      const accessToken = await cloud.auth.getAccessToken();
      if (!accessToken) {
        setError("云端会话获取失败，请重新获取验证码");
        return;
      }

      await postJson("/api/auth/reset-password-phone", {
        accessToken,
        phone: value,
        newPassword: next,
        originHint: window.location.origin,
      });

      /*
       * 密码已经落库。从这里往后不管提示成什么样，都不能说「失败」——
       * 否则用户会再发一次码，然后在「验证码已用过」上卡死。
       */
      setDone(true);
      setCode("");
      setNext("");
      setConfirm("");
      setChallenge(null);

      if (variant === "page" && onLogin) {
        try {
          await onLogin(value, next);
        } catch (err) {
          const detail = err instanceof Error ? err.message : "未知原因";
          setLoginMsg(`密码已经改好了，只是自动登录没成功（${detail}）。返回登录页用手机号 + 新密码进入即可。`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- 样式：两种场景各一套，避免把卡片式布局硬塞进表单式页面 ---------- */
  const isPage = variant === "page";
  const inputBase = isPage
    ? "w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none transition-colors focus:border-accent"
    : "min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
  const codeInput = isPage
    ? "w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2.5 font-mono text-[13.5px] tracking-[0.12em] text-ink outline-none transition-colors focus:border-accent"
    : "min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[13px] tracking-[0.3em] text-ink outline-none focus:border-accent";
  const sendBtn = isPage
    ? "shrink-0 whitespace-nowrap rounded-[8px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink disabled:opacity-45"
    : "shrink-0 rounded-[6px] bg-ink px-3 py-2 text-[12px] text-paper disabled:opacity-40";
  const primaryBtn = isPage
    ? "w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
    : "shrink-0 rounded-[6px] bg-accent px-4 py-2 text-[12px] text-paper disabled:opacity-40";
  const hintCls = isPage ? "text-[11px] leading-relaxed text-ink-mute" : "text-[11px] leading-relaxed text-ink-mute";

  const label = (text: string) => (
    <span className="mb-1.5 block text-[11.5px] tracking-[0.1em] text-ink-mute">{text}</span>
  );

  /*
   * 外框：登录页自带排版，嵌进「忘记当前密码」面板时（bare）也不该再套一层边框 ——
   * 三层边框叠在一起，看起来像三个不相干的框。所以只有一个地方决定包不包。
   * 写成普通函数而不是组件：做成组件的话每次渲染都是新类型，输入框会被卸载重建、丢焦点。
   */
  const frame = (node: React.ReactNode) =>
    isPage || bare ? (
      <div data-view="forgot-phone">{node}</div>
    ) : (
      <div data-view="forgot-phone" className="mt-4 rounded-[10px] border border-line bg-paper-deep p-4">
        {node}
      </div>
    );

  /* ---------- 改好了 ---------- */
  if (done) {
    const body = (
      <>
        <p className="text-[13px] text-ink">密码已改好</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-mute">
          {variant === "page"
            ? "回到登录页，用这个手机号 + 新密码就能进；也可以直接收验证码登录。"
            : "这个浏览器还登着，不用重新登录；别的设备下次登录要用新密码。"}
        </p>
        {loginMsg && (
          <p className="mt-2 rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] leading-relaxed text-wrong">
            {loginMsg}
          </p>
        )}
        <div className="mt-3">
          <button type="button" onClick={onDone} className={isPage ? primaryBtn : "rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper"}>
            {variant === "page" ? "返回登录" : "知道了"}
          </button>
        </div>
      </>
    );
    return frame(body);
  }

  /* ---------- 没绑手机号（仅我的页会遇到） ---------- */
  if (!locked && !isPage) {
    return frame(
      <>
        <p className="text-[11.5px] leading-relaxed text-ink-mute">
          这个账号还没绑手机号，短信发不出去。先绑一个常用号码，之后忘密码用短信或邮箱都能自己找回。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onBindPhone}
            className="rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper"
          >
            去绑定手机号
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-2 text-[12px] text-ink-mute hover:text-ink"
          >
            取消
          </button>
        </div>
      </>,
    );
  }

  /* ---------- 表单 ---------- */
  const form = (
    <form onSubmit={submit}>
      {isPage ? (
        <div className="space-y-4">
          <label className="block">
            {label("绑定手机号")}
            <div className="flex gap-2">
              <input
                type="tel"
                name="resetPhone"
                required
                value={target}
                onChange={(event) => setTarget(event.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="11 位手机号"
                autoComplete="tel"
                className={inputBase}
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={sending || countdown > 0}
                className={sendBtn}
              >
                {countdown > 0 ? `${countdown}s 后重发` : sending ? "发送中…" : "获取验证码"}
              </button>
            </div>
          </label>

          <label className="block">
            {label("短信验证码")}
            <input
              inputMode="numeric"
              name="resetPhoneCode"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              maxLength={8}
              placeholder="收到的那几位数字"
              autoComplete="one-time-code"
              className={codeInput}
            />
          </label>

          <label className="block">
            {label("新密码")}
            <input
              type="password"
              name="resetPhoneNewPassword"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
              placeholder="输入新密码"
              autoComplete="new-password"
              className={inputBase}
            />
          </label>

          <label className="block">
            {label("再输一次")}
            <input
              type="password"
              name="resetPhoneConfirm"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="和上面保持一致"
              autoComplete="new-password"
              className={inputBase}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={target}
              name="resetPhone"
              readOnly
              aria-label="接收短信的手机号"
              className="min-w-0 flex-1 cursor-default rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft outline-none"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sending || countdown > 0}
              className={sendBtn}
            >
              {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "发送验证码"}
            </button>
          </div>

          {challenge && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
              短信已发出，没收到就等 {countdown}s 后重发；号码停用了就改用邮箱。
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={code}
              name="resetPhoneCode"
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              maxLength={8}
              placeholder="短信验证码"
              autoComplete="one-time-code"
              className={codeInput}
            />
            <input
              value={next}
              name="resetPhoneNewPassword"
              onChange={(event) => setNext(event.target.value)}
              type="password"
              placeholder="新密码"
              autoComplete="new-password"
              className={inputBase}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={confirm}
              name="resetPhoneConfirm"
              onChange={(event) => setConfirm(event.target.value)}
              type="password"
              placeholder="再输一次新密码"
              autoComplete="new-password"
              className={inputBase}
            />
            <button type="submit" disabled={submitting} className={primaryBtn}>
              {submitting ? "保存中…" : "改密码"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 px-2 py-2 text-[12px] text-ink-mute hover:text-ink"
            >
              取消
            </button>
          </div>
        </>
      )}

      {isPage && (
        <p className={`mt-3 ${hintCls}`}>
          密码{PASSWORD_HINT}。重置只改密码，昵称、作答记录和生词本都不动。
        </p>
      )}
      {!isPage && (
        <p className={`mt-2 ${hintCls}`}>
          密码{PASSWORD_HINT}。改完旧密码立即失效，作答记录和生词都不动。
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] leading-relaxed text-wrong">
          {error}
        </p>
      )}

      {isPage && (
        <div className="mt-4 space-y-2">
          <button type="submit" disabled={submitting} className={primaryBtn}>
            {submitting ? "正在重置…" : "重置密码并登录"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-1 text-[12px] text-ink-mute transition-colors hover:text-ink"
          >
            返回登录
          </button>
        </div>
      )}
    </form>
  );

  return frame(form);
}
