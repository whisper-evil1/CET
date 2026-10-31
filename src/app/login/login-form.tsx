"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { postJson } from "@/lib/api-client";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeNext = nextPath.startsWith("/") ? nextPath : "/";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      if (mode === "register") {
        await postJson("/api/auth/register", {
          email,
          password,
          name: name.trim() || undefined,
        });
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(
          mode === "register"
            ? "注册成功但自动登录失败，请手动登录一次"
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
    setEmail("demo@cet.local");
    setPassword("demo1234");
    setError(null);
  };

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
              setError(null);
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
        {mode === "login" ? "登录后会同步作答、生词与笔记" : "只要邮箱和密码，30 秒搞定"}
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
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

        <Field label="邮箱">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[13.5px] outline-none transition-colors focus:border-accent"
          />
        </Field>

        <Field label="密码">
          <input
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

        {error && (
          <p className="rounded-[6px] bg-wrong-soft px-3 py-2 text-[12px] text-wrong">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[8px] bg-ink py-2.5 text-[13.5px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
        >
          {loading ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </form>

      <button
        type="button"
        onClick={fillDemo}
        className="mt-4 w-full text-center text-[12px] text-ink-mute underline-offset-4 hover:text-ink hover:underline"
      >
        用演示账号一键填入（demo@cet.local / demo1234）
      </button>
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
