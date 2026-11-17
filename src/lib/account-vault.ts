import crypto from "node:crypto";
import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { CLOUD_PUBLIC_CONFIG, CLOUD_ENABLED } from "./cloud-config";
import { isPhone, normalizePhone } from "./phone";

/**
 * 账号保险库 —— 解决「每次发布后账号不见、只能重新注册」。
 *
 * 问题链条：
 *   发布沙箱的 $HOME 不保证跨发布保留，SQLite 运行时库因此可能整库重置；
 *   User 行没了 → 浏览器里的 JWT 指向空气 → 用户被踢回登录页；
 *   而本地库里也没有这个邮箱了，于是他只能用「注册」再开一个新账号，
 *   旧的作答、生词全部挂在废账号下面。表现就是「记不住我密码」。
 *
 * 做法：把「能重建这个账号的最小信息」加密后存到云数据库，
 * 本地库哪怕被清空，登录或会话校验时都能原样把账号重建回来（连 id 都不变，
 * 所以旧 JWT 依然指得回同一个人，作答与生词本也就跟着回来了）。
 *
 * 存什么、怎么存：
 *   key  = sha256(pepper : email)   —— pepper 来自服务端密钥，库里没有明文邮箱
 *   blob = AES-256-GCM(iv | tag | ciphertext)，载荷是 { userId, email, name, passwordHash }
 *
 * 为什么即使这张表对 anon 可读也安全：
 *   1. 读出任何一行都只是「一串哈希 + 一段密文」，邮箱、昵称、bcrypt 摘要全部不可见；
 *   2. 密钥只存在于服务端环境变量，攻击者拿到密文也没有解密入口；
 *   3. 表是只追加的（只有 SELECT / INSERT 策略，没有 UPDATE / DELETE），
 *      无法改写或删除别人的历史，最多插入无关键垃圾行。
 *
 * 失败策略：保险库是旁路。云不可达时一律返回 null / false，登录照常走本地库。
 */

const TABLE = "app_account_vault";
/** 单次调用硬超时。登录是用户在屏幕前等的动作，不能被旁路拖住 */
const TIMEOUT_MS = 5000;

/** 服务端密钥：优先专用变量，其次复用 AUTH_SECRET，最后退回进程内固定串（开发用） */
const SECRET =
  process.env.ACCOUNT_VAULT_SECRET?.trim() ||
  process.env.AUTH_SECRET?.trim() ||
  "cet-reader-account-vault-dev-only";

const AES_KEY = crypto.createHash("sha256").update(`aes:${SECRET}`).digest();
const PEPPER = crypto.createHash("sha256").update(`pepper:${SECRET}`).digest("hex");

export type VaultRecord = {
  userId: string;
  email: string;
  /** 绑定的手机号；没有就是 null */
  phone?: string | null;
  name: string | null;
  /** bcrypt 摘要，与本地库同一份，不是明文 */
  passwordHash: string;
};

export const accountVaultEnabled = Boolean(
  CLOUD_ENABLED && CLOUD_PUBLIC_CONFIG.endpoint && CLOUD_PUBLIC_CONFIG.publishableKey,
);

/** 邮箱 → 保险库主键。同一邮箱永远得到同一个 key，跨进程稳定 */
export function vaultKeyFor(email: string): string {
  return crypto.createHash("sha256").update(`${PEPPER}:${email.trim().toLowerCase()}`).digest("hex");
}

function seal(record: VaultRecord): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", AES_KEY, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function open(blob: string): VaultRecord | null {
  try {
    const raw = Buffer.from(blob, "base64");
    if (raw.length < 29) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", AES_KEY, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as Partial<VaultRecord>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.passwordHash !== "string"
    ) {
      return null;
    }
    return {
      userId: parsed.userId,
      email: parsed.email,
      phone: typeof parsed.phone === "string" ? parsed.phone : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
      passwordHash: parsed.passwordHash,
    };
  } catch {
    return null;
  }
}

type CloudClient = ReturnType<typeof createWorkBuddyCloud>;
let client: CloudClient | null = null;

function getClient(): CloudClient | null {
  if (!accountVaultEnabled) return null;
  if (client) return client;
  const endpoint = CLOUD_PUBLIC_CONFIG.endpoint;
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

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vault_timeout")), ms);
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

/** 本轮进程内已经确认写成功的 key，避免每次登录都往云上追加一行 */
const saved = new Set<string>();

/**
 * 把账号写进保险库。幂等：同进程同 key 只写一次（改密码时用 force 绕过）；失败静默。
 *
 * 有手机号时写**两行**：一行按邮箱、一行按手机号。
 * 因为恢复账号时手里可能只有一个手机号（用户只记得手机号登录），
 * 而邮箱是登录之后才知道的 —— 只按邮箱存，手机号这条恢复路径就断了。
 */
export async function saveAccountToVault(
  input: VaultRecord,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.passwordHash || !input.userId) return false;

  // 手机号键统一用 11 位，否则 `+86 138…` 和 `138…` 会写成两把不同的钥匙，
  // 换设备时按手机号恢复就找不到这个人
  const phone = input.phone ? normalizePhone(input.phone) || null : null;
  const keys = [vaultKeyFor(email)];
  if (phone) keys.push(vaultKeyFor(phone));

  const cloud = getClient();
  if (!cloud) return false;

  const record = seal({ ...input, email, phone });
  let wrote = false;

  for (const key of keys) {
    if (!options.force && saved.has(key)) {
      wrote = true;
      continue;
    }
    try {
      const table = cloud.database.from(TABLE) as unknown as {
        insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
      };
      const { error } = await withTimeout(
        Promise.resolve(table.insert({ key, blob: record })),
        TIMEOUT_MS,
      );
      if (error) {
        console.warn(`[account-vault] 写入失败 → ${String((error as { message?: string }).message ?? error)}`);
        continue;
      }
      saved.add(key);
      wrote = true;
    } catch (error) {
      console.warn(`[account-vault] 写入异常 → ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return wrote;
}

/**
 * 按邮箱**或手机号**取最近一条账号记录。
 * 取不到（云端没有 / 网络失败 / 解密失败）返回 null。
 */
export async function loadAccountFromVault(identifier: string): Promise<VaultRecord | null> {
  // 用户可能输入 `+86 138…`：先按手机号归一，再按邮箱小写
  const asPhone = normalizePhone(identifier);
  const normalized = (isPhone(asPhone) ? asPhone : identifier.trim().toLowerCase());
  if (!normalized) return null;

  const cloud = getClient();
  if (!cloud) return null;

  try {
    const table = cloud.database.from(TABLE) as unknown as {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => {
            limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
          };
        };
      };
    };

    const { data, error } = await withTimeout(
      Promise.resolve(
        table
          .select("blob")
          .eq("key", vaultKeyFor(normalized))
          .order("created_at", { ascending: false })
          .limit(1),
      ),
      TIMEOUT_MS,
    );

    if (error) {
      console.warn(`[account-vault] 读取失败 → ${String((error as { message?: string }).message ?? error)}`);
      return null;
    }
    const rows = Array.isArray(data) ? data : [];
    const blob = (rows[0] as { blob?: unknown } | undefined)?.blob;
    if (typeof blob !== "string") return null;

    const record = open(blob);
    // 解密成功即视为同进程已确认，后续登录不必重复写
    if (record) saved.add(vaultKeyFor(normalized));
    return record;
  } catch (error) {
    console.warn(`[account-vault] 读取异常 → ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
