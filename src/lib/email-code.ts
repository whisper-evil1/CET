import { checkEmail, parseEmail } from "./email-rules";
import { sendEmailCode, type MailChannel } from "./mailer";

/**
 * 邮箱验证码：签发、校验、限流。
 *
 * 存储故意放在进程内存里，而不是新建一张 Prisma 表 —— 两个原因：
 *   1. 验证码生命周期只有 5 分钟，进程重启重发一次的成本几乎为零；
 *   2. 加表要 db push，线上已有用户的库要跟着迁移，为一张临时表不值得。
 * 代价是**多实例部署时签发和校验必须落在同一个进程**。本项目是单机 server.cjs，
 * 满足这个前提；将来上多实例时，把 store 换成 Redis（接口不用改）即可。
 */

export type CodePurpose = "login" | "register";

/** 验证码有效期 */
export const CODE_TTL_MS = 5 * 60 * 1000;
/** 同一邮箱同一用途的重发冷却 */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** 同一封码允许试错的次数，超了必须重新获取 —— 防止六位数被穷举 */
export const MAX_ATTEMPTS = 5;

type Entry = {
  code: string;
  purpose: CodePurpose;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
};

const store = new Map<string, Entry>();

const keyOf = (purpose: CodePurpose, email: string) => `${purpose}:${email}`;

/** 顺手清掉过期条目，避免长期运行后 Map 无限增长 */
function sweep(now: number) {
  if (store.size < 2000) return;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/** 6 位数字，用 crypto 而不是 Math.random —— 后者可预测 */
function randomCode(): string {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export type IssueResult =
  | { ok: true; code: string; ttlSec: number; resendAfterSec: number }
  | { ok: false; reason: "cooldown"; retryAfterSec: number };

/**
 * 签发一枚验证码。冷却期内重复请求不重发，直接告诉调用方还要等几秒。
 * 每次签发都会覆盖旧码 —— 用户点两次「发送」，只有最后一封是有效的。
 */
export function issueCode(email: string, purpose: CodePurpose): IssueResult {
  const now = Date.now();
  sweep(now);

  const key = keyOf(purpose, email);
  const existing = store.get(key);
  if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSec: Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000)),
    };
  }

  const code = randomCode();
  store.set(key, {
    code,
    purpose,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    lastSentAt: now,
  });

  return {
    ok: true,
    code,
    ttlSec: Math.floor(CODE_TTL_MS / 1000),
    resendAfterSec: Math.floor(RESEND_COOLDOWN_MS / 1000),
  };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "expired" | "mismatch" | "too-many"; message: string };

/**
 * 校验验证码。
 *
 * 成功即作废（一次性）：同一枚码不能既注册又登录，也不能重放。
 * 失败不销毁，让用户在 5 分钟内改一位再试，但累计错 5 次就作废并提示重新获取。
 */
export function verifyCode(email: string, purpose: CodePurpose, input: string): VerifyResult {
  const now = Date.now();
  const key = keyOf(purpose, email);
  const entry = store.get(key);

  if (!entry) {
    return { ok: false, reason: "missing", message: "还没获取验证码，先点「发送验证码」" };
  }
  if (entry.expiresAt <= now) {
    store.delete(key);
    return { ok: false, reason: "expired", message: "验证码已过期（有效 5 分钟），请重新获取" };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return { ok: false, reason: "too-many", message: "错误次数过多，验证码已作废，请重新获取" };
  }

  const value = (input ?? "").trim();
  if (!value) {
    return { ok: false, reason: "missing", message: "请填写邮箱收到的 6 位验证码" };
  }

  if (value !== entry.code) {
    entry.attempts += 1;
    store.set(key, entry);
    const left = MAX_ATTEMPTS - entry.attempts;
    return {
      ok: false,
      reason: "mismatch",
      message: left > 0 ? `验证码不对，还能再试 ${left} 次` : "错误次数过多，验证码已作废，请重新获取",
    };
  }

  store.delete(key);
  return { ok: true };
}

/** 冷却状态查询：前端「发送验证码」按钮的倒计时初值用 */
export function cooldownLeft(email: string, purpose: CodePurpose): number {
  const entry = store.get(keyOf(purpose, email));
  if (!entry) return 0;
  const left = RESEND_COOLDOWN_MS - (Date.now() - entry.lastSentAt);
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export type SendResult = {
  /** 码真的离开服务器了吗（false 时走的是控制台回显） */
  delivered: boolean;
  channel: MailChannel;
  ttlSec: number;
  resendAfterSec: number;
  /** 仅在没配邮件服务时返回，页面拿它直接显示，保证本地也能把流程走完 */
  devCode?: string;
};

/**
 * 签发 + 投递。邮箱格式在这里再校验一次 —— 路由层已经校验过，
 * 但这个函数也会被别处调用，宁可贵一点也不要给非法地址发信。
 */
export async function sendCodeTo(
  rawEmail: string,
  purpose: CodePurpose,
): Promise<{ ok: true; data: SendResult } | { ok: false; message: string; retryAfterSec?: number }> {
  const checked = checkEmail(rawEmail);
  if (!checked.ok) return { ok: false, message: checked.message };

  const issued = issueCode(checked.email, purpose);
  if (!issued.ok) {
    return {
      ok: false,
      message: `验证码刚发过，${issued.retryAfterSec} 秒后可以重发`,
      retryAfterSec: issued.retryAfterSec,
    };
  }

  const mail = await sendEmailCode(checked.email, issued.code, purpose);
  return {
    ok: true,
    data: {
      delivered: mail.delivered,
      channel: mail.channel,
      ttlSec: issued.ttlSec,
      resendAfterSec: issued.resendAfterSec,
      devCode: mail.delivered ? undefined : issued.code,
    },
  };
}

/** 规范化邮箱（登录/注册入库前统一用它，避免大小写分裂出两个账号） */
export function normalizeEmail(raw: string): string {
  const parsed = parseEmail(raw);
  return parsed.ok ? parsed.email : raw.trim().toLowerCase();
}
