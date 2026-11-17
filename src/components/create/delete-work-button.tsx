"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

/** 作品库的删除按钮：删完刷新服务端列表（router.refresh），不做乐观更新只删不刷 */
export function DeleteWorkButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("删除这件作品？删除后不可恢复。")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/create/${id}`, { method: "DELETE" });
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void remove()}
      disabled={busy}
      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-mute transition-colors hover:border-wrong hover:text-wrong disabled:opacity-50"
    >
      {busy ? "删除中" : "删除"}
    </button>
  );
}
