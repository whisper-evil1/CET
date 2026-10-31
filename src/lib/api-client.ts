/** 客户端请求封装：统一解包 { code, message, data }，错误统一抛 ApiError */

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

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  let envelope: ApiEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope || envelope.code !== 0 || envelope.data === null) {
    const message =
      envelope?.message ??
      (response.status === 401 ? "请先登录" : `请求失败（HTTP ${response.status}）`);
    throw new ApiError(message, envelope?.code ?? response.status);
  }

  return envelope.data;
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
