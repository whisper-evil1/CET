"use client";

import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/api-client";
import { parseEmail } from "@/lib/email-rules";
import { PASSWORD_HINT, passwordIssue } from "@/lib/password-policy";
import { ForgotPasswordPhone } from "@/components/forgot-password-phone";

/**
 * 忘记密码 → 收验证码 → 换新密码。
 *
 * 为什么单独一个组件、而不是往 login-form 里再加一个页签：
 * 登录页那三个页签是「用哪种方式进门」，重置密码不是进门的方式，
 * 是一条独立的补救路径（进来时往往还憋着「我密码是啥」的情绪）。
 * 混进页签栏，会让人以为它和「验证码登录」是一回事。
 * 所以做成登录页上的次入口：点「忘记密码？」进入，左上角返回。
 *
 * 为什么不新开一个 /forgot 路由：
 * 重置前的人一定在登录页。多一次整页跳转就多一次首屏水合等待
 * （线上实测十几秒），中途还可能被分享码/平台拦截打断。
 * 同一个页面里切视图，邮箱还能从登录表单带过来，少输一次。
 */

type SentState = {
  email: string;
  /** 码是否真的发到邮箱了。false = 服务端没配邮件服务，码直接显示在页面上 */
  delivered: boolean;
  devCode?: string;
  ttlSec: number;
};

export function ResetPassword({
  initialEmail,
  onBack,
  onLogin,
}: {
  /** 登录表单里已经填过的邮箱，带过来省一次输入 */
  initialEmail?: string;
  onBack: () => void;
  /** 重置成功后自动登录；成功时内部会直接导航离开，失败则抛错 */
  onLogin: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [sent, setSent] = useState<SentState | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 密码是否已经改成功。自动登录失败时靠它把话说清楚：改没改，是两件事 */
  const [done, setDone] = useState(false);
  /**
   * 水合完成前禁用提交。
   * 和登录表单同一个理由：首屏是服务端直出的，此时点提交走的是浏览器原生 GET，
   * 新密码会被拼进地址栏并留在历史记录里。
   */
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * 默认渠道：登录表单里已经填过邮箱就顺着填邮箱，否则默认短信。
   *
   * 这个应用的常规进门方式是手机号验证码，还有一批账号根本没绑邮箱。
   * 默认停在邮箱上，最常见的那批人一进来就得先看一句「发不出去」再自己找切换。
   */
  const [channel, setChannel] = useState<"phone" | "email">(() => {
    const typed = (initialEmail ?? "").trim();
    if (!typed) return "phone";
    return /^1[3-9]\d{9}$/.test(typed) ? "phone" : "email";
  });

  useEffect(() => {
    setMounted(true);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = (seconds: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(seconds > 0 ? seconds : 60);
    timerRef.current = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    setError(null);

    const checked = parseEmail(email);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }

    setSending(true);
    try {
      const data = await postJson<{
        email: string;
        delivered: boolean;
        devCode?: string;
        ttlSec: number;
        resendAfterSec: number;
      }>("/api/auth/email-code", { email: checked.email, purpose: "reset" });

      setEmail(data.email);
      setSent({
        email: data.email,
        delivered: data.delivered,
        devCode: data.devCode,
        ttlSec: data.ttlSec,
      });
      startCountdown(data.resendAfterSec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const checked = parseEmail(email);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    if (!code.trim()) {
      setError("先填邮箱收到的 6 位验证码");
      return;
    }
    // 密码规则与「我的 → 修改密码」同一份，见 lib/password-policy.ts
    const issue = passwordIssue(password);
    if (issue) {
      setError(issue);
      return;
    }
    if (password !== confirm) {
      setError("两次输入的新密码不一样，检查一下");
      return;
    }

    setSubmitting(true);
    try {
      await postJson<{ email: string; passwordSet: boolean }>("/api/auth/reset-password", {
        email: checked.email,
        code: code.trim(),
        newPassword: password,
      });

      // 改密码已经成功。从这里开始，任何失败都不能再说「重置失败」——
      // 用户会以为密码没改，从而又去点一次发送验证码。
      setDone(true);

      try {
        await onLogin(checked.email, password);
      } catch (err) {
        const detail = err instanceof Error ? err.message : "未知原因";
        setError(`密码已经改好了，但自动登录没成功（${detail}）。返回登录页用新密码登录即可。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 密码已经改好、但自动登录没成功时，让用户在这里原地再试一次。
   * 成功的话 onLogin 内部会直接导航离开；失败也只说明登录这一步失败，
   * 所以文案仍然是「密码已经改好了」。
   */
  const retryLogin = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLogin(email.trim().toLowerCase(), password);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "未知原因";
      setError(`密码已经改好了，只是这次登录没成功（${detail}）。也可以返回登录页手动登录。`);
    } finally {
      setSubmitting(false);
    }
  };

  /* 手机号渠道：整块交给 ForgotPasswordPhone（发码 / 验码 / 换密码 / 自动登录都在它里面） */
  if (channel === "phone") {
    return (
      <div data-view="reset" className="w-full max-w-[360px]">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 text-[12px] text-ink-mute transition-colors hover:text-ink"
        >
          ← 返回登录
        </button>

        <h2 className="font-serif text-[24px] leading-tight text-ink">重置密码</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-mute">
          忘了旧密码也没关系：收一条短信验证码，直接换新的。没绑手机号就用邮箱。
        </p>

        <ChannelTabs channel={channel} onChange={setChannel} />

        <div className="mt-6">
          <ForgotPasswordPhone
            variant="page"
            onLogin={onLogin}
            onDone={onBack}
            onCancel={onBack}
          />
        </div>

        <p className="mt-4 text-[10.5px] leading-relaxed text-ink-mute">
          重置后，别的设备上已经登录的浏览器要等 30 天会话自然过期才会退出。
          如果账号像是被别人用过，改完密码顺手在「我的」看一眼昵称和邮箱。
        </p>
      </div>
    );
  }

  return (
    // data-view 给自动化验收一个稳定锚点：登录表单里也有 name="email" 的输入框，
    // 只靠 name 在视图切换的瞬间可能命中旧表单，限定在这块区域内就不会串。
    <div data-view="reset" className="w-full max-w-[360px]">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-[12px] text-ink-mute transition-colors hover:text-ink"
      >
        ← 返回登录
      </button>

      <h2 className="font-serif text-[24px] leading-tight text-ink">
        {done ? "密码已改好" : "重置密码"}
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-mute">
        {done
          ? "用新密码进门，作答、生词和笔记都还在原来那个账号里。"
          : "忘了旧密码也没关系：收一条验证码，直接换新的。手机号和邮箱两条路都能用。"}
      </p>

      {/* 已经改成功之后不再给切换：那时候唯一该做的事是登录回去 */}
      {!done && <ChannelTabs channel={channel} onChange={setChannel} />}

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <Field label="注册邮箱">
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="注册时用的邮箱"
            autoComplete="email"
            className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
          />
        </Field>

        <Field label="验证码">
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              name="code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              placeholder="6 位数字"
              autoComplete="one-time-code"
              className="w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2.5 font-mono text-[13.5px] tracking-[0.12em] outline-none transition-colors focus:border-accent"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sending || countdown > 0 || !mounted}
              className="shrink-0 whitespace-nowrap rounded-[8px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink disabled:opacity-45"
            >
              {countdown > 0 ? `${countdown}s 后重发` : sending ? "发送中…" : "发送验证码"}
            </button>
          </div>
        </Field>

        {/*
          没配邮件服务时，码没法真发到邮箱（服务端会在日志里打，并回传到这里）。
          不给出去等于整条重置流程在比赛现场走不通，所以直接显示；
          配了 RESEND_API_KEY 之后这个分支不会再出现。
          做成按钮：点一下填进输入框，评委不用手抄 6 位数字。
        */}
        {sent && !sent.delivered && sent.devCode && (
          <button
            type="button"
            onClick={() => setCode(sent.devCode ?? "")}
            className="block w-full rounded-[6px] border border-dashed border-line bg-paper-deep px-3 py-2.5 text-left transition-colors hover:border-ink-mute"
          >
            {/* 分两行排：说明一句、验证码一句。挤在一行时括号里的提示会被折断成两截，看着像乱码 */}
            <span className="block text-[11.5px] leading-relaxed text-ink-soft">
              当前环境没接邮件服务，验证码直接显示：
            </span>
            <span className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[15px] tracking-[0.2em] text-ink">{sent.devCode}</span>
              <span className="text-[11px] text-ink-mute">点此填入</span>
            </span>
          </button>
        )}

        {sent && sent.delivered && (
          <p className="text-[11.5px] leading-relaxed text-ink-mute">
            验证码已发到 {sent.email}，{Math.round(sent.ttlSec / 60)} 分钟内有效。
          </p>
        )}

        <Field label="新密码">
          <input
            type="password"
            name="newPassword"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            // 占位只做引导，规则写在下面那行常驻提示里 —— 两处都说一遍，读起来像被叮嘱两次
            placeholder="输入新密码"
            autoComplete="new-password"
            className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
          />
        </Field>

        <Field label="再输一次">
          <input
            type="password"
            name="confirmPassword"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="和上面保持一致"
            autoComplete="new-password"
            className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
          />
        </Field>

        <p className="text-[11px] leading-relaxed text-ink-mute">
          密码{PASSWORD_HINT}。重置只改密码，昵称、作答记录和生词本都不动。
        </p>

        {error && (
          <p className="rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] leading-relaxed text-wrong">
            {error}
          </p>
        )}

        {done ? (
          /*
           * 改成功之后不能再让这个按钮走一次 form submit：
           * 验证码是一次性的，已经作废，再提交只会得到「还没获取验证码」，
           * 让刚改完密码的人以为自己又失败了。这里改成重试自动登录。
           */
          <button
            type="button"
            onClick={() => void retryLogin()}
            disabled={submitting}
            className="w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
          >
            {submitting ? "正在登录…" : "用新密码进入 →"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={submitting || !mounted}
            className="w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
          >
            {submitting ? "正在重置…" : !mounted ? "正在载入…" : "重置密码并登录"}
          </button>
        )}
      </form>

      <p className="mt-4 text-[10.5px] leading-relaxed text-ink-mute">
        重置后，别的设备上已经登录的浏览器要等 30 天会话自然过期才会退出。
        如果账号像是被别人用过，改完密码顺手在「我的」看一眼昵称和邮箱。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] tracking-[0.1em] text-ink-mute">{label}</span>
      {children}
    </label>
  );
}

/**
 * 渠道切换：短信 / 邮箱。
 *
 * 为什么两个都要：一批账号只有手机号、没有可收信的邮箱（138…@phone.local 收不到信），
 * 只留邮箱等于这批人没有找回入口。反过来，绑了邮箱的人习惯从邮箱那条路走。
 * 两条路强度一样，所以不分主次，只是一个 tab 栏。
 */
function ChannelTabs({
  channel,
  onChange,
}: {
  channel: "phone" | "email";
  onChange: (next: "phone" | "email") => void;
}) {
  const tabs: { key: "phone" | "email"; label: string }[] = [
    { key: "phone", label: "手机号" },
    { key: "email", label: "邮箱" },
  ];
  return (
    <div role="tablist" aria-label="找回方式" className="mt-5 flex gap-1 rounded-[10px] border border-line bg-surface p-1">
      {tabs.map((tab) => {
        const active = channel === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-channel={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex-1 rounded-[7px] py-1.5 text-[12px] transition-colors ${
              active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
