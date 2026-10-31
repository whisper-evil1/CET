"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/" })}
      className="rounded-full border border-line px-4 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-wrong hover:text-wrong"
    >
      退出登录
    </button>
  );
}
