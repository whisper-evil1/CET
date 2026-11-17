"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { DemoLogin, DEMO_ACCOUNT } from "@/components/demo-login";
import { ResetPassword } from "@/components/reset-password";
import { postJson } from "@/lib/api-client";
import { cloud, cloudReady } from "@/lib/cloud";

/**
 * 四个视图：登录 / 注册 / 验证码登录 / 重置密码。
 *
 * reset 不进页签栏 —— 页签回答的是「用哪种方式进门」，重置密码不是进门方式，
 * 而是忘了密码时的补救路径。它由密码框下面的「忘记密码？」进入。
 */
type Mode = "login" | "register" | "otp" | "reset";

type OtpChallenge = { verificationId: string; isExistingUser: boolean };

/** 上次登录用过的邮箱，存在本机，下次打开直接填好 */
const REMEMBER_KEY = "cet.login.email";

/**
 * 让浏览器记住这次密码。
 *
 * 关键差异：NextAuth 的 signIn() 是 fetch 提交，页面不发生导航，
 * Chrome / Edge 的密码管理器因此**不会**弹出「保存密码」——这就是用户说的
 * 「他记不住我密码」。Credential Management API 是唯一能在这种场景下主动写入的入口，
 * 不支持的内核（Safari / 部分国产内核）静默跳过，不影响登录。
 */
async function rememberPassword(email: string, password: string) {
  try {
    const w = window as unknown as {
      PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential;
      navigator: Navigator & { credentials?: { store?: (c: Credential) => Promise<void> } };
    };
    if (!w.PasswordCredential || !w.navigator.credentials?.store) return;
    await w.navigator.credentials.store(new w.PasswordCredential({ id: email, password, name: email }));
  } catch {
    /* 用户拒绝或内核不支持，忽略 */
  }
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  /**
   * 登录成功后用浏览器原生导航，而不是 router.replace。
   *
   * router.replace 走的是 RSC 请求：容器慢或网络一抖就会静默失败 ——
   * 表现是「密码没错、cookie 也设上了、页面还停在登录页」，
   * 用户会以为密码错了再输一遍。location.replace 是原生导航，
   * 只要 cookie 在就一定进得去；而且同样不把登录页留在历史记录里。
   */
  const hardNavigate = (to: string) => {
    window.location.replace(to);
  };
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  /**
   * 是否已经在浏览器里挂载完成。
   *
   * 首屏是服务端直出的：HTML 里表单和按钮都在，但 onSubmit 还没绑上。
   * 这时候点「登录」，浏览器会按原生表单 GET 提交，密码被拼进地址栏
   * （/login?email=…&password=…），既难看也把密码写进了历史记录和日志。
   * 所以挂载前把提交按钮禁掉，等它变成可点，就一定走的是 fetch。
   */
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 演示账号登录单独一套状态：它失败时提示的是「换个方式进」，和表单密码错要分开说 */
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // 验证码登录状态
  const [channel, setChannel] = useState<"phone" | "email">("phone");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const safeNext = nextPath.startsWith("/") ? nextPath : "/";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 记住上次的邮箱：换设备/清缓存后重开，至少不用重新想当初注册的是哪个地址
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) setEmail(saved);
    } catch {
      /* 隐私模式下 localStorage 会抛错，忽略 */
    }
  }, []);

  const startCountdown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCountdown(60);
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

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setDemoError(null);
    setChallenge(null);
    setCode("");
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    setError(null);

    if (!cloudReady || !cloud) {
      setError("当前环境未启用云服务，验证码登录暂不可用，请使用邮箱密码登录。");
      return;
    }

    const value = target.trim();
    if (channel === "phone" && !/^1\d{10}$/.test(value)) {
      setError("请输入正确的 11 位手机号");
      return;
    }
    if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError("请输入正确的邮箱地址");
      return;
    }

    setSending(true);
    try {
      const sent = await cloud.auth.sendOtp(
        channel === "phone" ? { phone: value } : { email: value },
      );
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

  /**
   * 用邮箱密码登录，成功后就跳走。
   *
   * 抽成函数是因为现在有两个入口会用到它：表单提交和演示账号一键登录。
   * 两处各写一遍的话，改一次跳转方式就得记得改两处——上次「登录成功却停在
   * 登录页」那个问题就是这么来的，所以这里只留一份实现。
   *
   * 失败直接 throw，由调用方决定怎么说这句话（注册场景和普通登录的措辞不同）。
   */
  const loginWithPassword = async (
    accountEmail: string,
    accountPassword: string,
    failHint?: string,
  ) => {
    const result = await signIn("credentials", {
      email: accountEmail,
      password: accountPassword,
      redirect: false,
    });

    if (result?.error) {
      throw new Error(
        failHint ??
          "邮箱或密码不对。改过密码就用新密码；忘了密码点下面的「忘记密码？」，用注册邮箱收个验证码就能重设。",
      );
    }

    // 本地记住邮箱 + 请浏览器记住密码（下次打开直接登录）
    const normalized = accountEmail.trim().toLowerCase();
    try {
      window.localStorage.setItem(REMEMBER_KEY, normalized);
    } catch {
      /* 隐私模式下 localStorage 会抛错，忽略 */
    }
    void rememberPassword(normalized, accountPassword);

    hardNavigate(safeNext);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      if (mode === "otp") {
        if (!cloudReady || !cloud) {
          setError("当前环境未启用云服务，验证码登录暂不可用，请使用邮箱密码登录。");
          return;
        }
        if (!challenge) {
          setError("请先获取验证码");
          return;
        }
        const value = target.trim();
        if (!/^\d{4,8}$/.test(code.trim())) {
          setError("请输入收到的验证码");
          return;
        }

        const verified = await cloud.auth.verifyOtp({
          verificationId: challenge.verificationId,
          token: code.trim(),
          isExistingUser: challenge.isExistingUser,
          ...(channel === "phone" ? { phone: value } : { email: value }),
        });

        if (verified.error) {
          setError(verified.error.message ?? "验证码不正确或已过期");
          return;
        }

        const accessToken = await cloud.auth.getAccessToken();
        if (!accessToken) {
          setError("云会话获取失败，请重新获取验证码");
          return;
        }

        // 先用服务端探针确认这个 token 能换到云端身份，并把失败原因显示出来，
        // 避免只看到「会话建立失败」这种无法定位的提示。
        const probe = (await fetch("/api/auth/otp-probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken, originHint: window.location.origin }),
        })
          .then((res) => res.json())
          .catch(() => null)) as { ok?: boolean; status?: number | null; reason?: string } | null;

        if (!probe?.ok) {
          const detail = [probe?.status ?? "", probe?.reason ?? "network"].filter(Boolean).join(" ");
          setError(`验证通过，但云端身份校验未通过（诊断：${detail}）。`);
          return;
        }

        const result = await signIn("cloud-otp", {
          accessToken,
          originHint: window.location.origin,
          redirect: false,
        });
        if (result?.error) {
          setError("云端身份已确认，但本站会话签发失败（本地账号写入或会话签发异常）。");
          return;
        }

        hardNavigate(safeNext);
        return;
      }

      if (mode === "register") {
        await postJson("/api/auth/register", {
          email,
          password,
          name: name.trim() || undefined,
        });
        await loginWithPassword(email, password, "注册成功但自动登录失败，请手动登录一次");
        return;
      }

      await loginWithPassword(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  /**
   * 演示账号一键登录。
   *
   * 不先「填入再让用户点登录」：给评委看的时候，每多一次点击就多一次出错机会，
   * 而且填进去的明文密码会让人以为要自己核对一遍。
   *
   * 失败时不重复「密码不对」这种没用的提示——演示号被重置是平台侧的事，
   * 用户能做的只有换一个入口，所以直接给换入口的办法。
   */
  const handleDemoLogin = async () => {
    if (demoLoading || !mounted) return;
    setDemoLoading(true);
    setDemoError(null);
    setError(null);
    setMode("login");
    setEmail(DEMO_ACCOUNT.email);
    setPassword(DEMO_ACCOUNT.password);

    try {
      await loginWithPassword(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "未知原因";
      setDemoError(`演示账号这次没进去（${detail}）。用下面的表单注册一个新账号，功能完全一样。`);
      setDemoLoading(false);
    }
  };

  /*
   * 重置密码整块换掉登录视图（页签、演示卡、标题都不要）。
   *
   * 放在所有 hook 之后 return 是安全的：上面的 useState/useEffect 已经按固定顺序执行完，
   * 这里只是渲染分支变化，不会触发「hook 数量不一致」那种错误。
   * 复用 loginWithPassword 而不是在重置组件里再写一遍 signIn：
   * 登录成功要写 localStorage、请浏览器存密码、再原生导航，三件事只该有一份实现。
   */
  if (mode === "reset") {
    return (
      <ResetPassword
        initialEmail={email}
        onBack={() => switchMode("login")}
        onLogin={(accountEmail, accountPassword) =>
          loginWithPassword(
            accountEmail,
            accountPassword,
            "新密码没通过登录校验（可能是网络或会话签发那一步出了问题），密码本身已经改好了",
          )
        }
      />
    );
  }

  const headline =
    mode === "login" ? "继续你的刷题进度" : mode === "register" ? "创建一个账号" : "用验证码登录";
  const subline =
    mode === "login"
      ? "登录后会同步作答、生词与笔记"
      : mode === "register"
        ? "只要邮箱和密码，30 秒搞定"
        : "手机或邮箱收码即可，新用户自动创建账号";

  return (
    <div className="w-full max-w-[360px]">
      <div className="mb-8 flex gap-1 rounded-full border border-line p-1">
        {(
          [
            { key: "login", label: "登录" },
            { key: "register", label: "注册" },
            { key: "otp", label: "验证码" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => switchMode(tab.key)}
            className={`flex-1 rounded-full py-1.5 text-[12.5px] transition-colors ${
              mode === tab.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/*
        演示账号放在标题之前：打开登录页第一块内容就是它，
        评委不用滚动、不用先看一堆说明就知道怎么进去。
        注册/验证码两个页签下不显示——那时候用户已经决定用自己的号了。
      */}
      {mode === "login" && (
        <>
          <DemoLogin
            onLogin={() => void handleDemoLogin()}
            busy={demoLoading}
            disabled={!mounted}
            error={demoError}
          />
          <div className="mb-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="shrink-0 text-[10.5px] tracking-[0.16em] text-ink-mute">
              或用自己的账号
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <h2 className="font-serif text-[24px] leading-tight text-ink">{headline}</h2>
      <p className="mt-1.5 text-[12.5px] text-ink-mute">{subline}</p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        {mode === "otp" ? (
          <>
            <div className="flex gap-1 rounded-[8px] border border-line p-1">
              {(
                [
                  { key: "phone", label: "手机号" },
                  { key: "email", label: "邮箱" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setChannel(item.key);
                    setTarget("");
                    setChallenge(null);
                    setCode("");
                    setError(null);
                  }}
                  className={`flex-1 rounded-[6px] py-1.5 text-[12px] transition-colors ${
                    channel === item.key
                      ? "bg-paper-deep text-ink"
                      : "text-ink-mute hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <Field label={channel === "phone" ? "手机号" : "邮箱"}>
              <input
                type={channel === "phone" ? "tel" : "email"}
                required
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                maxLength={channel === "phone" ? 11 : 64}
                placeholder={channel === "phone" ? "11 位手机号" : "you@example.com"}
                autoComplete={channel === "phone" ? "tel" : "email"}
                className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
              />
            </Field>

            <Field label="验证码">
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  maxLength={8}
                  placeholder="6 位验证码"
                  autoComplete="one-time-code"
                  className="w-full min-w-0 rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={sending || countdown > 0}
                  className="shrink-0 rounded-[8px] border border-line px-3 text-[12px] text-ink-soft transition-colors hover:border-ink-mute hover:text-ink disabled:opacity-45"
                >
                  {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "获取验证码"}
                </button>
              </div>
            </Field>

            {challenge && (
              <p className="text-[11.5px] leading-relaxed text-ink-mute">
                {challenge.isExistingUser
                  ? "验证码已发送，输入后直接登录。"
                  : "验证码已发送，验证通过后将自动创建账号。"}
              </p>
            )}
          </>
        ) : (
          <>
            {mode === "register" && (
              <Field label="昵称">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={20}
                  placeholder="小明"
                  className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
                />
              </Field>
            )}

            {/*
              登录时可填邮箱，也可填绑过的手机号。
              类型用 text 而不是 email：type="email" 在手机上只弹英文键盘，
              数字键要翻两页，用手机号登录的人第一步就被卡住。
            */}
            <Field label={mode === "register" ? "邮箱" : "邮箱 / 手机号"}>
              <input
                id="login-email"
                name="email"
                type="text"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={mode === "register" ? "you@example.com" : "you@example.com 或 11 位手机号"}
                autoComplete="username"
                className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
              />
            </Field>

            <Field label="密码">
              <input
                id="login-password"
                name="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 6 位"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
              />
            </Field>

            {/*
              忘记密码的入口只放在「登录」页签下：
              注册页还用不上（还没账号），验证码页签本来就不需要密码。
              右对齐、弱色、不抢主按钮的注意力，但位置紧跟密码框 ——
              人是输完密码才想起自己忘了的，眼睛正好在这个高度。
            */}
            {mode === "login" && (
              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => switchMode("reset")}
                  className="text-[11.5px] text-ink-mute transition-colors hover:text-ink"
                >
                  忘记密码？
                </button>
              </div>
            )}

            {mode === "login" && (
              <p className="-mt-1 text-[11px] leading-relaxed text-ink-mute">
                登录状态保持 30 天，期间不用重复登录；账号凭据同时存了一份加密备份，
                换设备或站点重新发布后，用原来的邮箱密码照样能登回来。
              </p>
            )}
          </>
        )}

        {error && (
          <p className="rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] text-wrong">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !mounted}
          className="w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
        >
          {loading
            ? "处理中…"
            : mode === "login"
              ? "登录"
              : mode === "register"
                ? "注册并登录"
                : "验证码登录"}
        </button>
      </form>
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
