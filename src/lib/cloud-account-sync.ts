import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { CLOUD_PUBLIC_CONFIG, CLOUD_ENABLED } from "./cloud-config";

/**
 * 账号凭据 → 云服务镜像。
 *
 * 为什么不用云 Auth 承担注册：
 *   云服务的 Auth 明确不提供「免验证的密码注册」——signUp 必须携带 OTP 验证令牌，
 *   可用的方式只有 邮箱验证码 / 邮箱+密码（需先验码）/ 微信 / WorkBuddy 账号。
 *   而本应用的注册是「填邮箱 + 密码，立即生效」，中间没有验证码环节。
 *   硬改成验证码注册会改变产品形态，所以身份仍由本地库承担，
 *   云侧改用 Database 存一份凭据镜像，保证账号不会随沙箱重建而丢失。
 *
 * 镜像里存什么：
 *   email 原文 + bcrypt 单向摘要（与本地库同一份 hash，不是明文）。
 *   bcrypt 本身是刻意慢的单向函数，即使被读走也不能反推密码——
 *   但仍按「凭据」对待，把表的读权限彻底关掉（见下方 RLS 说明）。
 *
 * 表的权限（public.app_accounts，已在云侧建好）：
 *   INSERT  允许 anon / authenticated，并用 WITH CHECK 卡住邮箱格式与 bcrypt 摘要形状
 *   SELECT  USING (false) —— 任何客户端角色都查不出任何一行
 *   UPDATE / DELETE 未建策略 —— 默认拒绝，只能追加，不能改写历史
 *   于是这张表对应用来说只写不读：能证明「已同步」，也拿不走别人的凭据。
 *   需要导出/恢复时走管理侧（exec_sql）由运营方操作，不在应用运行时暴露。
 *
 * 失败策略：
 *   同步是「尽力而为」的旁路，绝不阻断注册或登录。
 *   云服务抖动、超时、限流都只记一条 warn，本地账号照常可用。
 */

const TABLE = "app_accounts";
/** 单次同步的硬超时。注册是用户坐在屏幕前等的动作，不能被旁路拖住 */
const SYNC_TIMEOUT_MS = 6000;

type CloudClient = ReturnType<typeof createWorkBuddyCloud>;

let client: CloudClient | null = null;
/** 进程内已确认同步过的本地账号 id，避免每次登录都打一次云 */
const synced = new Set<string>();

export const cloudAccountSyncEnabled = CLOUD_ENABLED && Boolean(
  CLOUD_PUBLIC_CONFIG.endpoint && CLOUD_PUBLIC_CONFIG.publishableKey,
);

function getClient(): CloudClient | null {
  if (!cloudAccountSyncEnabled) return null;
  if (client) return client;

  const endpoint = CLOUD_PUBLIC_CONFIG.endpoint;
  /**
   * 云服务按 Origin 精确匹配 publishableKey。浏览器发请求时 Origin 由浏览器自动带上，
   * Node 的 fetch 不会——不补这个头，服务端侧调用会被当成来源不符直接拒绝。
   * 这里只补 Origin，不碰 Authorization，凭据仍由 SDK 自己按 publishableKey 处理。
   */
  const withOrigin: typeof fetch = (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("origin")) headers.set("origin", endpoint);
    return fetch(input, { ...init, headers });
  };

  client = createWorkBuddyCloud({
    endpoint,
    publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
    fetch: withOrigin,
  });
  return client;
}

export type CloudAccountInput = {
  localUserId: string;
  email: string;
  name: string | null;
  /** bcrypt 摘要，与本地库同一份 */
  passwordHash: string;
  source?: "register" | "login" | "backfill";
};

export type CloudAccountResult = {
  ok: boolean;
  /** 已在云端存在（唯一键冲突），视为同步成功 */
  alreadyExists?: boolean;
  reason?: string;
};

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cloud_sync_timeout")), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** 把一条账号凭据推到云数据库。幂等：重复插入按「已同步」处理。 */
export async function syncAccountToCloud(input: CloudAccountInput): Promise<CloudAccountResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.passwordHash || !input.localUserId) {
    return { ok: false, reason: "missing_field" };
  }
  if (synced.has(input.localUserId)) return { ok: true, alreadyExists: true };

  const cloud = getClient();
  if (!cloud) return { ok: false, reason: "cloud_not_configured" };

  try {
    /**
     * SDK 的 from().insert() 返回的是 PostgrestFilterBuilder —— thenable 但不是 Promise，
     * 也不会自动推导本表的行类型（项目没生成 database.types）。这里把这一层的形状收窄成
     * 最小接口：只需要一个可 await 的 { error } 信封，其余交给 SDK。
     */
    const table = cloud.database.from(TABLE) as unknown as {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
    };

    const { error } = await withTimeout(
      Promise.resolve(
        table.insert({
          local_user_id: input.localUserId,
          email,
          name: input.name,
          password_hash: input.passwordHash,
          password_algo: "bcrypt",
          source: input.source ?? "register",
        }),
      ),
      SYNC_TIMEOUT_MS,
    );

    if (error) {
      /**
       * SDK 会把 PostgreSQL 的 SQLSTATE 加一层前缀，实际拿到的是 "DATABASE_23505"。
       * 只判裸码 "23505" 会永远匹配不上，重复注册就被当成失败刷告警——
       * 所以这里按「结尾」匹配，裸码与带前缀两种形态都能认。
       */
      const raw = String((error as { code?: string }).code ?? "");
      const sqlState = raw.replace(/^DATABASE_/, "");
      // 23505 = unique_violation，冲突键是 local_user_id：
      // 说明这个本地账号之前已经同步过，等价于同步完成。
      // 邮箱本身不是唯一键 —— 同一邮箱重新注册（换了一份密码摘要）会追加新行而不是被挡下，
      // 这样「最新一行」始终对应该邮箱当前的凭据，镜像不会停在旧密码上。
      if (sqlState === "23505") {
        synced.add(input.localUserId);
        return { ok: true, alreadyExists: true };
      }
      const reason = `${raw || "error"}: ${(error as { message?: string }).message ?? ""}`.trim();
      console.warn(`[cloud-account] 同步失败 ${email.replace(/(.{2}).*(@.*)/, "$1***$2")} → ${reason}`);
      return { ok: false, reason };
    }

    synced.add(input.localUserId);
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[cloud-account] 同步异常 ${email.replace(/(.{2}).*(@.*)/, "$1***$2")} → ${reason}`,
    );
    return { ok: false, reason };
  }
}
