import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { CLOUD_PUBLIC_CONFIG } from "./cloud-config";

/**
 * 验证码登录的事件日志（云端 otp_events 表，只写不读）。
 *
 * 目的：登录失败时，用户只能看到一句提示，排障却需要知道「哪一步、什么状态码」。
 * 这里把阶段与结果异步写到云端，运维侧用管理工具读取即可，不阻塞登录。
 *
 * 记录内容只有阶段/结果/状态码/来源，不含手机号、邮箱、token。
 */
const client = createWorkBuddyCloud({
  endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
  publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
  storage: undefined,
  fetch: (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    // 服务端 Node 请求不会自带 Origin，云端按来源校验，必须补。
    if (!headers.has("origin")) headers.set("origin", CLOUD_PUBLIC_CONFIG.endpoint);
    return fetch(input, { ...init, headers });
  },
});

export type OtpEvent = {
  stage: "probe" | "provider" | "db";
  ok: boolean;
  status?: number | null;
  reason?: string | null;
  origin?: string | null;
};

export function logOtpEvent(event: OtpEvent): void {
  try {
    const table = client.database.from("otp_events") as unknown as {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
    };
    Promise.resolve(
      table.insert({
        stage: event.stage,
        ok: event.ok,
        status: event.status ?? null,
        reason: event.reason ?? null,
        origin: event.origin ?? null,
      }),
    ).catch(() => {
      /* 日志是旁路，失败不影响登录 */
    });
  } catch {
    /* 初始化失败同样忽略 */
  }
}
