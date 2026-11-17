"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { PASSWORD_HINT, passwordIssue } from "@/lib/password-policy";
import { ForgotPasswordPhone } from "@/components/forgot-password-phone";

/**
 * 「我的 → 修改密码」里的找回通道。
 *
 * 为什么要有它：修改密码要求先填当前密码（这是对的，防止手机被临时借走就能改密码），
 * 但人一旦忘了当前密码，原表单就成了死路 —— 站内没有任何出口，
 * 只能退出登录、去登录页点「忘记密码」，再收码、再登回来。
 * 明明人已经在这个页面里，却要绕一圈才能做同一件事，这是设计缺陷。
 *
 * 所以这里直接给出口：不发明文密码、也不放开「不填旧密码也能改」，
 * 而是换成另一种本人凭证 —— 短信码或邮箱码。两条路径的凭证不同但强度相当，
 * 都不是「谁坐在这个浏览器前谁就能改」。
 *
 * 为什么两个渠道都要有（而不是只留邮箱）：
 * 本站有一批账号只有手机号、从没绑邮箱（合成邮箱 138…@phone.local 收不到信）。
 * 对这些人，只做邮箱通道等于没有找回功能。手机号是他们唯一能证明「我是我」的凭据。
 *
 * 为什么号码锁死、不可编辑：
 * 这一屏是改「我自己」的密码，允许换号就等于允许「给别人的号/邮箱发码 → 改别人的账号」。
 * 要换账号请走登录页的忘记密码，那里本来就要求输账号。
 *
 * 为什么不跳转到登录页的重置视图：
 * 那是给「还没进门的人」用的，成功后要自动登录一次；人已经登录着，
 * 再走一遍登录只会多一次闪烁和一次会话重建，还会丢掉「我的」页当前的滚动位置。
 */
type Props = {
  /** 当前账号邮箱；只读，不允许在这里改成别的地址 */
  email: string;
  /** 当前账号手机号；没有则手机渠道引导去绑定 */
  phone: string | null;
  /** 手机号占位的假邮箱，收不到信，得先去绑真实邮箱 */
  syntheticEmail: boolean;
  /** 去打开上面的「绑定邮箱」面板 */
  onBindEmail: () => void;
  /** 去打开上面的「绑定手机号」面板 */
  onBindPhone: () => void;
  /** 密码已改好，收起本面板 */
  onDone: () => void;
  onCancel: () => void;
};

type Channel = "phone" | "email";

type Sent = {
  delivered: boolean;
  /** 没配邮件服务时服务端回传的验证码，直接显示出来，否则演示环境走不通 */
  devCode?: string;
  ttlSec: number;
};

export function ForgotPasswordInline({
  email,
  phone,
  syntheticEmail,
  onBindEmail,
  onBindPhone,
  onDone,
  onCancel,
}: Props) {
  /**
   * 默认选哪个渠道：有手机号就默认短信。
   *
   * 不是随手排的顺序 —— 这个应用的主要登录方式是手机号验证码，
   * 有一批账号压根没有可收信的邮箱（合成邮箱 138…@phone.local 收不到信）。
   * 默认停在邮箱上，等于让最常见的那批人先看到一句「验证码发不出去」，再自己找切换。
   * 所以「有手机号」和「邮箱是合成的」两种情况下都默认短信。
   */
  const [channel, setChannel] = useState<Channel>(phone || syntheticEmail ? "phone" : "email");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const startCountdown = (seconds: number) => {
    if (timer.current) clearInterval(timer.current);
    setCountdown(seconds > 0 ? seconds : 60);
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

  /** 换渠道时把上一条渠道的临时状态清掉，避免「刚发的邮箱码」被当成短信码用 */
  const switchChannel = (nextChannel: Channel) => {
    if (nextChannel === channel) return;
    setChannel(nextChannel);
    setError(null);
    setSent(null);
    setCode("");
    setCountdown(0);
    if (timer.current) clearInterval(timer.current);
  };

  const sendCode = async () => {
    if (sending || countdown > 0 || syntheticEmail) return;
    setError(null);
    setSending(true);
    try {
      const data = await postJson<{
        delivered: boolean;
        devCode?: string;
        ttlSec: number;
        resendAfterSec: number;
      }>("/api/auth/email-code", { email, purpose: "reset" });
      setSent({ delivered: data.delivered, devCode: data.devCode, ttlSec: data.ttlSec });
      startCountdown(data.resendAfterSec);
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

    if (!code.trim()) return setError("先填邮箱收到的 6 位验证码");
    // 规则与「修改密码」表单同一份，见 lib/password-policy.ts
    const issue = passwordIssue(next);
    if (issue) return setError(issue);
    if (next !== confirm) return setError("两次输入的新密码不一样，检查一下");

    setSubmitting(true);
    try {
      await postJson("/api/auth/reset-password", {
        email,
        code: code.trim(),
        newPassword: next,
      });
      /*
       * 走到这里密码已经落库了。后面无论提示成什么样，都不能再说「失败」——
       * 那会让人以为密码没改，再点一次发送验证码，然后在「验证码已用过」上卡住。
       */
      setDone(true);
      setCode("");
      setNext("");
      setConfirm("");
      setSent(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div data-view="forgot" className="mt-4 rounded-[10px] border border-line bg-paper-deep p-4">
        <p className="text-[13px] text-ink">密码已改好</p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-mute">
          这个浏览器还登着，不用重新登录；别的设备下次登录要用新密码。
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-3 rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper"
        >
          知道了
        </button>
      </div>
    );
  }

  const tabs: { key: Channel; label: string; note?: string }[] = [
    { key: "phone", label: "短信验证码", note: phone ? undefined : "未绑定" },
    { key: "email", label: "邮箱验证码", note: syntheticEmail ? "未绑定" : undefined },
  ];

  return (
    <div data-view="forgot" className="mt-4 rounded-[10px] border border-line bg-paper-deep p-4">
      {/* 渠道切换：两条路的强度一样，选哪条取决于手里能收到什么，界面上不必分主次 */}
      <div role="tablist" aria-label="找回方式" className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const active = channel === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              data-channel={tab.key}
              onClick={() => switchChannel(tab.key)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] transition-colors ${
                active
                  ? "bg-ink text-paper"
                  : "border border-line text-ink-soft hover:border-ink-mute hover:text-ink"
              }`}
            >
              {tab.label}
              {tab.note && (
                <span className={`ml-1.5 text-[10.5px] ${active ? "text-paper/70" : "text-ink-mute"}`}>
                  {tab.note}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {channel === "phone" ? (
          <ForgotPasswordPhone
            phone={phone}
            variant="inline"
            bare
            onBindPhone={onBindPhone}
            onDone={onDone}
            onCancel={onCancel}
          />
        ) : syntheticEmail ? (
          <>
            <p className="text-[11.5px] leading-relaxed text-ink-mute">
              这个账号现在是手机号登录，还没有能收信的邮箱，邮箱验证码发不出去。先绑一个真实邮箱，
              之后忘密码用短信或邮箱都能自己找回。
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={onBindEmail}
                className="rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper"
              >
                去绑定邮箱
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-2 py-2 text-[12px] text-ink-mute hover:text-ink"
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="mt-0">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={email}
                name="resetEmail"
                readOnly
                aria-label="接收验证码的邮箱"
                className="min-w-0 flex-1 cursor-default rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[12.5px] text-ink-soft outline-none"
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={sending || countdown > 0}
                className="shrink-0 rounded-[6px] bg-ink px-3 py-2 text-[12px] text-paper disabled:opacity-40"
              >
                {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "发送验证码"}
              </button>
            </div>

            {sent && !sent.delivered && sent.devCode && (
              <button
                type="button"
                onClick={() => setCode(sent.devCode ?? "")}
                className="mt-2 block w-full rounded-[6px] border border-dashed border-line bg-paper px-3 py-2 text-left transition-colors hover:border-ink-mute"
              >
                <span className="block text-[11px] leading-relaxed text-ink-soft">
                  当前环境没接邮件服务，验证码直接显示：
                </span>
                <span className="mt-0.5 flex items-baseline gap-2">
                  <span className="font-mono text-[14px] tracking-[0.2em] text-ink">{sent.devCode}</span>
                  <span className="text-[11px] text-ink-mute">点此填入</span>
                </span>
              </button>
            )}
            {sent && sent.delivered && (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
                验证码已发到 {email}，{Math.round(sent.ttlSec / 60)} 分钟内有效。
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={code}
                name="resetCode"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                placeholder="6 位验证码"
                autoComplete="one-time-code"
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[13px] tracking-[0.3em] text-ink outline-none focus:border-accent"
              />
              <input
                value={next}
                name="resetNewPassword"
                onChange={(e) => setNext(e.target.value)}
                type="password"
                placeholder="新密码"
                autoComplete="new-password"
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={confirm}
                name="resetConfirm"
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                placeholder="再输一次新密码"
                autoComplete="new-password"
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={submitting}
                className="shrink-0 rounded-[6px] bg-accent px-4 py-2 text-[12px] text-paper disabled:opacity-40"
              >
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

            <p className="mt-2 text-[11px] leading-relaxed text-ink-mute">
              密码{PASSWORD_HINT}。改完旧密码立即失效，作答记录和生词都不动。
            </p>

            {error && (
              <p className="mt-2 rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] leading-relaxed text-wrong">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
