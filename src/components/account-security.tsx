"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api-client";
import { cloud, cloudReady } from "@/lib/cloud";
import { ForgotPasswordInline } from "@/components/forgot-password-inline";

type Props = {
  email: string;
  phone: string | null;
  passwordSet: boolean;
  syntheticEmail: boolean;
};

type Kind = "phone" | "email";

type Challenge = { verificationId: string; isExistingUser: boolean };

/**
 * 「我的」页里的账号安全区。
 *
 * 三件事：看当前绑了哪些登录方式、补绑手机号/邮箱、自助改密码。
 *
 * 绑定为什么要验证码：手机号是「谁的号谁能收到短信」，客户端自报不算数。
 * 这里用云 SDK 发码验码，再让服务端拿 token 去云端换身份，
 * 确认号码确实是本人的才写进账号。
 */
export function AccountSecurity({ email, phone, passwordSet, syntheticEmail }: Props) {
  const router = useRouter();

  // ---- 改密码 ----
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  /**
   * 忘了当前密码时改走验证码。
   *
   * 有当前密码框却没有出口，是这一屏原来的缺陷：人忘了旧密码就只能退出登录、
   * 去登录页再走一遍忘记密码 —— 明明已经坐在这个页面里。
   */
  const [forgot, setForgot] = useState(false);

  // ---- 绑定 ----
  const [binding, setBinding] = useState<Kind | null>(null);
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [bindBusy, setBindBusy] = useState(false);
  const [bindMsg, setBindMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

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

  const openBind = (kind: Kind) => {
    setBinding(kind);
    setTarget("");
    setCode("");
    setChallenge(null);
    setBindMsg(null);
  };

  const sendCode = async () => {
    if (sendBusy || countdown > 0 || !binding) return;
    setBindMsg(null);
    if (!cloudReady || !cloud) {
      setBindMsg({ tone: "err", text: "当前环境未启用云服务，暂时只能改密码。" });
      return;
    }
    const value = target.trim();
    if (binding === "phone" && !/^1[3-9]\d{9}$/.test(value)) {
      setBindMsg({ tone: "err", text: "请输入正确的 11 位手机号" });
      return;
    }
    if (binding === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setBindMsg({ tone: "err", text: "请输入正确的邮箱地址" });
      return;
    }

    setSendBusy(true);
    try {
      const sent = await cloud.auth.sendOtp(binding === "phone" ? { phone: value } : { email: value });
      if (sent.error || !sent.data) {
        setBindMsg({ tone: "err", text: sent.error?.message ?? "验证码发送失败，请稍后再试" });
        return;
      }
      setChallenge({
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      });
      startCountdown();
      setBindMsg({ tone: "ok", text: "验证码已发出，请查收" });
    } catch (err) {
      setBindMsg({ tone: "err", text: err instanceof Error ? err.message : "验证码发送失败" });
    } finally {
      setSendBusy(false);
    }
  };

  const confirmBind = async () => {
    if (bindBusy || !binding || !challenge) return;
    const value = target.trim();
    if (!/^\d{4,8}$/.test(code.trim())) {
      setBindMsg({ tone: "err", text: "请输入收到的验证码" });
      return;
    }
    setBindBusy(true);
    setBindMsg(null);
    try {
      const verified = await cloud!.auth.verifyOtp({
        verificationId: challenge.verificationId,
        token: code.trim(),
        isExistingUser: challenge.isExistingUser,
        ...(binding === "phone" ? { phone: value } : { email: value }),
      });
      if (verified.error) {
        setBindMsg({ tone: "err", text: verified.error.message ?? "验证码不正确或已过期" });
        return;
      }

      const accessToken = await cloud!.auth.getAccessToken();
      if (!accessToken) {
        setBindMsg({ tone: "err", text: "云端会话获取失败，请重新获取验证码" });
        return;
      }

      await postJson("/api/account/bind", {
        kind: binding,
        [binding]: value,
        accessToken,
        originHint: window.location.origin,
      });

      setBindMsg({ tone: "ok", text: binding === "phone" ? "手机号已绑定" : "邮箱已绑定" });
      setBinding(null);
      router.refresh();
    } catch (err) {
      setBindMsg({ tone: "err", text: err instanceof Error ? err.message : "绑定失败" });
    } finally {
      setBindBusy(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pwdBusy) return;
    setPwdMsg(null);

    if (next.length < 8) return setPwdMsg({ tone: "err", text: "新密码至少 8 位" });
    if (!/[a-zA-Z]/.test(next) || !/\d/.test(next)) {
      return setPwdMsg({ tone: "err", text: "新密码要同时包含字母和数字" });
    }
    if (next !== confirm) return setPwdMsg({ tone: "err", text: "两次输入的新密码不一致" });

    setPwdBusy(true);
    try {
      await postJson("/api/account/password", {
        currentPassword: current || undefined,
        newPassword: next,
      });
      setPwdMsg({
        tone: "ok",
        text: passwordSet ? "密码已更新，下次用新密码登录" : "密码已设置，以后可以用邮箱 + 密码登录了",
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      router.refresh();
    } catch (err) {
      setPwdMsg({ tone: "err", text: err instanceof Error ? err.message : "修改失败" });
    } finally {
      setPwdBusy(false);
    }
  };

  const maskPhone = phone ? `${phone.slice(0, 3)} **** ${phone.slice(-4)}` : null;

  return (
    <section className="mt-10">
      <h2 className="font-serif text-[18px] text-ink">账号与安全</h2>
      <p className="mt-1 text-[12px] text-ink-mute">
        手机号和邮箱可以同时绑在同一个账号上，用哪个登录都进这一个号。
      </p>

      <div className="mt-4 divide-y divide-line border-y border-line">
        {/* 邮箱 */}
        <div className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-[0.14em] text-ink-mute">邮箱</p>
            <p className="mt-1 truncate font-mono text-[13px] text-ink">
              {syntheticEmail ? "未绑定（当前是手机号占位）" : email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openBind("email")}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            {syntheticEmail ? "绑定邮箱" : "换绑邮箱"}
          </button>
        </div>

        {/* 手机号 */}
        <div className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] tracking-[0.14em] text-ink-mute">手机号</p>
            <p className="mt-1 font-mono text-[13px] text-ink">{maskPhone ?? "未绑定"}</p>
          </div>
          <button
            type="button"
            onClick={() => openBind("phone")}
            className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            {phone ? "换绑手机" : "绑定手机号"}
          </button>
        </div>
      </div>

      {/* 绑定表单 */}
      {binding && (
        <div className="mt-4 rounded-[10px] border border-line bg-paper-deep p-4">
          <p className="text-[13px] text-ink">
            绑定{binding === "phone" ? "手机号" : "邮箱"}
            <span className="ml-2 text-[11.5px] text-ink-mute">
              验证码会发到{binding === "phone" ? "这个号码" : "这个邮箱"}
            </span>
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode={binding === "phone" ? "numeric" : "email"}
              type={binding === "phone" ? "tel" : "email"}
              placeholder={binding === "phone" ? "11 位手机号" : "you@example.com"}
              className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sendBusy || countdown > 0}
              className="shrink-0 rounded-[6px] bg-ink px-3 py-2 text-[12px] text-paper disabled:opacity-40"
            >
              {countdown > 0 ? `${countdown}s` : sendBusy ? "发送中…" : "获取验证码"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={8}
              placeholder="6 位验证码"
              className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 font-mono text-[13px] tracking-[0.3em] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={confirmBind}
              disabled={bindBusy || !challenge}
              className="shrink-0 rounded-[6px] bg-accent px-4 py-2 text-[12px] text-paper disabled:opacity-40"
            >
              {bindBusy ? "绑定中…" : "确认绑定"}
            </button>
            <button
              type="button"
              onClick={() => setBinding(null)}
              className="shrink-0 px-2 py-2 text-[12px] text-ink-mute hover:text-ink"
            >
              取消
            </button>
          </div>

          {bindMsg && (
            <p className={`mt-2 text-[12px] ${bindMsg.tone === "ok" ? "text-correct" : "text-wrong"}`}>
              {bindMsg.text}
            </p>
          )}
        </div>
      )}

      {/* 改密码 */}
      {forgot ? (
        <div className="mt-8">
          <h3 className="font-serif text-[15px] text-ink">忘记当前密码</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
            不用输旧密码：收一条短信或邮件验证码，验证是你本人之后，直接换一个新的。
            手机号和邮箱两条路都能用，哪个方便走哪个。
          </p>
          <ForgotPasswordInline
            email={email}
            phone={phone}
            syntheticEmail={syntheticEmail}
            onBindEmail={() => {
              setForgot(false);
              openBind("email");
            }}
            onBindPhone={() => {
              setForgot(false);
              openBind("phone");
            }}
            onDone={() => {
              setForgot(false);
              setPwdMsg({ tone: "ok", text: "密码已更新，下次登录用新密码" });
              router.refresh();
            }}
            onCancel={() => setForgot(false)}
          />
        </div>
      ) : (
      <form onSubmit={changePassword} className="mt-8">
        <h3 className="font-serif text-[15px] text-ink">
          {passwordSet ? "修改密码" : "设置密码"}
        </h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-mute">
          {passwordSet
            ? "改完旧密码立即失效；换设备时用新密码登录，作答与生词跟账号走。"
            : "你一直用验证码登录，账号还没有密码，所以不用填旧的 —— 直接设一个新的就行。"}
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {passwordSet && (
            <div className="flex items-center gap-3 sm:col-span-2">
              <input
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                type="password"
                autoComplete="current-password"
                placeholder="当前密码"
                className="min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
              {/* 忘了旧密码的出口，就在要填它的地方 —— 而不是让人自己找去登录页 */}
              <button
                type="button"
                onClick={() => {
                  setPwdMsg(null);
                  setForgot(true);
                }}
                className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-mute transition-colors hover:text-accent"
              >
                忘记当前密码？
              </button>
            </div>
          )}
          <input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="新密码（至少 8 位，含字母和数字）"
            className="rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent sm:col-span-2"
          />
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder="再输一次新密码"
            className="rounded-[6px] border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:border-accent sm:col-span-2"
          />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={pwdBusy}
            className="rounded-full bg-ink px-4 py-2 text-[12.5px] text-paper disabled:opacity-40"
          >
            {pwdBusy ? "保存中…" : passwordSet ? "保存新密码" : "设置密码"}
          </button>
          {pwdMsg && (
            <span className={`text-[12px] ${pwdMsg.tone === "ok" ? "text-correct" : "text-wrong"}`}>
              {pwdMsg.text}
            </span>
          )}
        </div>
      </form>
      )}
    </section>
  );
}
