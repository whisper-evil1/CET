import { logout } from "@/lib/logout-action";

/**
 * 退出登录按钮。
 * 用 form + server action 触发，不走客户端 signOut，避免反代环境下的 CSRF 崩溃。
 */
export function LogoutButton() {
  return (
    <form action={logout}>
      <button
        type="submit"
        className="rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-wrong hover:text-wrong"
      >
        退出登录
      </button>
    </form>
  );
}
