/** 客户端请求封装：统一解包 { code, message, data }，错误统一抛 ApiError */

import { withSharecode, isPlatformBlock } from "./share-code";

export type ApiEnvelope<T> = { code: number; message: string; data: T | null };

export class ApiError extends Error {
  constructor(
    message: string,
    public code: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 平台拦截专用错误码：sharecode / __wb_rsc 凭证丢失时，平台返回 403 HTML
 * 「链接不完整」页，请求没到应用层。前端要识别这种情况并引导用户回分享链接。
 * 用一个独立的 code 让上层能精确匹配，区别于应用层业务码。
 */
export const PLATFORM_BLOCK_CODE = -1;

/**
 * 检测到平台拦截时，除了抛错，还广播一个全局事件，让 ShareCodeSync 组件
 * 有机会自动把页面跳回带 sharecode 的入口链接，而不是停在错误提示上。
 */
function notifyPlatformBlock() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cet:platform-block"));
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  // 1. 给相对路径自动补 sharecode 参数，作为 __wb_rsc cookie 丢失时的兜底通道
  const url = withSharecode(input);

  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  // 2. 先识别平台层 403 HTML 拦截：应用层绝不会返回 HTML，一定是 JSON
  const contentType = response.headers.get("content-type");
  if (isPlatformBlock(response, contentType)) {
    notifyPlatformBlock();
    throw new ApiError(
      "访问分享链接的凭证已失效，正在为你重新打开…",
      PLATFORM_BLOCK_CODE,
    );
  }

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  // 3. 应用层返回了非 JSON（理论上不该发生，但平台偶发 5xx HTML 也会走到这）
  if (!response.ok || !envelope || envelope.code !== 0) {
    const message =
      envelope?.message ??
      (response.status === 401 ? "请先登录" : `请求失败（HTTP ${response.status}）`);
    throw new ApiError(message, envelope?.code ?? response.status);
  }

  return envelope.data as T;
}

export const postJson = <T,>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: "POST", body: JSON.stringify(body) });

export const patchJson = <T,>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: "PATCH", body: JSON.stringify(body) });

export const del = <T,>(url: string) => apiFetch<T>(url, { method: "DELETE" });

/** DELETE with JSON body（按 word 删除生词用） */
export const delJson = <T,>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: "DELETE", body: JSON.stringify(body) });

/** SWR fetcher */
export const swrFetcher = <T,>(url: string) => apiFetch<T>(url);
