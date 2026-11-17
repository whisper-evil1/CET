"use client";

/**
 * 演示账号一键登录卡片（比赛演示期用，可整体移除）。
 *
 * 为什么单独一个文件：这是临时功能，比赛结束后要能干净删掉。
 * 移除方式：删除本文件 + `login-form.tsx` 里两处引用
 * （`import { DemoLogin } ...` 和 `<DemoLogin ... />`）。别处没有依赖。
 *
 * 设计取舍：
 *   - 放在表单**上方**：打开登录页第一眼就看到，评委不用滚动、不用注册。
 *   - 账号密码明文显示：这是公开的演示号，藏着反而让人要去翻文档。
 *   - 单点直达：点按钮直接登录，不需要「先填入再点登录」两步。
 *   - 失败有出路：演示号登录失败时明确提示改用自己的账号注册，不让人卡死。
 */

/** 演示账号。改这里就能换号，不用动登录逻辑。 */
export const DEMO_ACCOUNT = {
  email: "demo@cet.local",
  password: "demo1234",
} as const;

export function DemoLogin({
  onLogin,
  busy,
  disabled,
  error,
}: {
  /** 由登录页提供，复用同一套登录流程，避免两处实现走岔 */
  onLogin: () => void;
  busy: boolean;
  /** 页面还没挂载完成时禁用：此时点了不会有反应，禁掉比假死好 */
  disabled: boolean;
  error: string | null;
}) {
  return (
    <section
      aria-label="演示账号"
      className="mb-7 rounded-[10px] border border-line bg-paper-deep/60 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10.5px] tracking-[0.24em] text-accent uppercase">Demo</p>
        <span className="text-[10.5px] text-ink-mute">免注册 · 直接进</span>
      </div>

      <p className="mt-2 font-serif text-[15px] leading-snug text-ink">
        先用演示账号看一眼，全程不用注册
      </p>
      <p className="mt-1.5 text-[11.5px] leading-[1.75] text-ink-soft">
        里面已经有一份作答、生词和签到记录，点进去就能看到完整的界面效果。
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11.5px]">
        <dt className="text-ink-mute">账号</dt>
        <dd className="text-ink">{DEMO_ACCOUNT.email}</dd>
        <dt className="text-ink-mute">密码</dt>
        <dd className="text-ink">{DEMO_ACCOUNT.password}</dd>
      </dl>

      <button
        type="button"
        onClick={onLogin}
        disabled={disabled || busy}
        className="mt-3 w-full rounded-[8px] bg-ink py-2.5 text-[13px] text-paper transition-opacity hover:opacity-88 disabled:opacity-45"
      >
        {/*
          未挂载时不要只是变灰：线上容器首屏脚本要几秒到二十几秒才跑完，
          灰按钮会让人以为坏了、点了没反应。写上「正在载入」，
          至少等待这件事是可见的。
        */}
        {disabled ? "正在载入…" : busy ? "正在进入演示账号…" : "一键进入演示账号 →"}
      </button>

      {error && (
        <p className="mt-2.5 rounded-[6px] bg-wrong-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-wrong">
          {error}
        </p>
      )}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-ink-mute">
        演示账号是公用的，请不要往里存私人内容。想留自己的数据，用下面的表单注册。
      </p>
    </section>
  );
}
