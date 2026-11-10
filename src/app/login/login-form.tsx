"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ApiError, postJson } from "@/lib/api-client";
import { checkEmail, parseEmail } from "@/lib/email-rules";

/**
 * 登录 / 注册。
 *
 * v2.6 起多了两件事，都是「先校验、再发请求」的类型：
 *   1. 邮箱格式当场给结论（不只是浏览器那句英文气泡）—— 判断逻辑和文案
 *      全部来自 src/lib/email-rules.ts，和服务端 zod 用的是同一套；
 *   2. 邮箱验证码：注册必填，登录可选（密码登录 / 验证码登录两个子模式）。
 *
 * 两个约束不能破：
 *   - 默认视图仍是「登录 + 密码」，且 email / password / submit 三个选择器不变，
 *     否则 scripts/lib/login.mjs 里那套 e2e 登录会全部失效；
 *   - 「发送验证码」按钮必须是 type="button"，不能抢走表单的第一次 submit。
 */

type Mode = "login" | "register";
type LoginMethod = "password" | "code";

type SendCodeData = {
  email: string;
  purpose: Mode;
  delivered: boolean;
  channel: "resend" | "console";
  ttlSec: number;
  resendAfterSec: number;
  devCode?: string;
};

const inputClass =
  "w-full rounded-[8px] border bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [method, setMethod] = useState<LoginMethod>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 邮箱即时校验：只有「碰过」之后才提示，避免刚点进来就一片红
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailIssue, setEmailIssue] = useState<string | null>(null);

  // 验证码：发送中 / 冷却剩余秒数 / 结果提示
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [codeNote, setCodeNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const timerRef = useRef<number | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const safeNext = nextPath.startsWith("/") ? nextPath : "/";
  const needsCode = mode === "register" || method === "code";

  useEffect(() => {
    if (cooldown <= 0) return;
    timerRef.current = window.setInterval(() => {
      setCooldown((v) => {
        if (v <= 1) {
          if (timerRef.current !== null) window.clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 邮箱校验分两档：
   *   - 注册 / 验证码登录：必须能收信，走 checkEmail（结构 + 白名单）
   *   - 密码登录：老账号可能挂在 demo@cet.local 这类非白名单域名上，
   *     只判结构（parseEmail），否则演示账号会被自己的前端拦住。
   */
  const validateEmail = useCallback(
    (value: string) => {
      const strict = mode === "register" || method === "code";
      const checked = strict ? checkEmail(value) : parseEmail(value);
      setEmailIssue(checked.ok ? null : checked.message);
      return checked;
    },
    [mode, method],
  );

  const resetTransient = () => {
    setError(null);
    setCodeNote(null);
  };

  const sendCode = async () => {
    if (sending || cooldown > 0) return;
    setEmailTouched(true);
    const checked = validateEmail(email);
    if (!checked.ok) {
      setCodeNote(null);
      return;
    }

    setSending(true);
    setError(null);
    try {
      const data = await postJson<SendCodeData>("/api/auth/email-code", {
        email: checked.email,
        purpose: mode,
      });
      setCooldown(data.resendAfterSec || 60);
      setCodeNote(
        data.delivered
          ? { tone: "ok", text: `验证码已发到 ${data.email}，${Math.round(data.ttlSec / 60)} 分钟内有效` }
          : {
              tone: "warn",
              text: `当前未配置邮件服务，本次验证码：${data.devCode ?? "（见服务端日志）"}`,
            },
      );
      // 码发出去后光标直接落到验证码框，用户不用自己找
      window.setTimeout(() => codeInputRef.current?.focus(), 60);
    } catch (err) {
      setCodeNote(null);
      setError(err instanceof ApiError ? err.message : "验证码发送失败，请稍后重试");
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;

    setEmailTouched(true);
    const checked = validateEmail(email);
    if (!checked.ok) return;

    if (needsCode && code.trim().length !== 6) {
      setError("验证码是 6 位数字，先点「发送验证码」拿到码再填进来");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (mode === "register") {
        await postJson("/api/auth/register", {
          email: checked.email,
          password,
          code: code.trim(),
          name: name.trim() || undefined,
        });
      }

      const result = await signIn("credentials", {
        email: checked.email,
        ...(mode === "login" && method === "code"
          ? { code: code.trim() }
          : { password }),
        redirect: false,
      });

      if (result?.error) {
        setError(
          mode === "register"
            ? "注册成功但自动登录失败，请手动登录一次"
            : method === "code"
              ? "验证码不对或已过期，重新获取一枚再试"
              : "邮箱或密码不对，再试一次",
        );
        return;
      }

      router.replace(safeNext);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = () => {
    setMode("login");
    setMethod("password");
    setEmail("demo@cet.local");
    setPassword("demo1234");
    setEmailTouched(false);
    setEmailIssue(null);
    setError(null);
    setCodeNote(null);
  };

  const showEmailIssue = emailTouched && emailIssue;

  return (
    <div className="w-full max-w-[360px]">
      <div className="mb-8 flex gap-1 rounded-full border border-line p-1">
        {(
          [
            { key: "login", label: "登录" },
            { key: "register", label: "注册" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setMode(tab.key);
              setCode("");
              setCooldown(0);
              resetTransient();
            }}
            className={`flex-1 rounded-full py-1.5 text-[12.5px] transition-colors ${
              mode === tab.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <h2 className="font-serif text-[24px] leading-tight text-ink">
        {mode === "login" ? "继续你的刷题进度" : "创建一个账号"}
      </h2>
      <p className="mt-1.5 text-[12.5px] text-ink-mute">
        {mode === "login"
          ? "登录后会同步作答、生词与笔记"
          : "邮箱验证码 + 密码，30 秒搞定"}
      </p>

      {/* 登录方式切换：只在登录下出现，注册恒走验证码 */}
      {mode === "login" && (
        <div className="mt-5 flex items-center gap-1 text-[12px]">
          {(
            [
              { key: "password", label: "密码登录" },
              { key: "code", label: "验证码登录" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setMethod(item.key);
                setCode("");
                setCooldown(0);
                resetTransient();
              }}
              className={`rounded-[7px] px-2.5 py-1 transition-colors ${
                method === item.key
                  ? "bg-[#eef2f8] font-medium text-ink"
                  : "text-ink-mute hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {mode === "register" && (
          <Field label="昵称">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={20}
              placeholder="小明"
              className={`${inputClass} border-line`}
            />
          </Field>
        )}

        <Field label="邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailTouched) validateEmail(event.target.value);
            }}
            onBlur={() => {
              setEmailTouched(true);
              validateEmail(email);
            }}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={Boolean(showEmailIssue)}
            aria-describedby={showEmailIssue ? "email-issue" : undefined}
            className={`${inputClass} ${
              showEmailIssue ? "border-wrong focus:border-wrong" : "border-line"
            }`}
          />
          {showEmailIssue && (
            <span id="email-issue" className="mt-1.5 block text-[11.5px] leading-[1.6] text-wrong">
              {emailIssue}
            </span>
          )}
        </Field>

        {needsCode && (
          <Field label="邮箱验证码">
            <div className="flex items-stretch gap-2">
              <input
                ref={codeInputRef}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="6 位数字"
                className={`${inputClass} min-w-0 flex-1 border-line font-mono tracking-[0.16em]`}
              />
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={sending || cooldown > 0}
                className="shrink-0 rounded-[8px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-[#c9d2e0] hover:text-ink disabled:opacity-45"
              >
                {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
              </button>
            </div>
            {codeNote && (
              <span
                className={`mt-1.5 block text-[11.5px] leading-[1.6] ${
                  codeNote.tone === "warn" ? "text-wrong" : "text-ink-mute"
                }`}
              >
                {codeNote.text}
              </span>
            )}
          </Field>
        )}

        {(mode === "register" || method === "password") && (
          <Field label="密码">
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={`${inputClass} border-line`}
            />
          </Field>
        )}

        {error && (
          <p className="rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] text-wrong">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
        >
          {loading
            ? "处理中…"
            : mode === "register"
              ? "注册并登录"
              : method === "code"
                ? "用验证码登录"
                : "登录"}
        </button>
      </form>

      <button
        type="button"
        onClick={fillDemo}
        className="mt-4 w-full text-center text-[12px] text-ink-mute underline-offset-4 hover:text-ink hover:underline"
      >
        用演示账号一键填入（demo@cet.local / demo1234）
      </button>

      <p className="mt-3 text-[11px] leading-[1.7] text-ink-mute">
        收不到验证码？先确认邮箱域名在支持范围内（QQ、163、Gmail、Outlook、iCloud 等），
        再检查垃圾邮件文件夹。
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
