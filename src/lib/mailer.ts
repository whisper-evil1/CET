import type { CodePurpose } from "./email-code";

/**
 * 验证码投递通道。
 *
 * 现状：项目里原来没有任何邮件配置（.env 里 mail/smtp 一条都搜不到），
 * 所以这里做成「能配就真发、没配就有声地降级」，而不是硬依赖某个服务先跑通再说：
 *
 *   1. 配了 RESEND_API_KEY  → 走 Resend 的 HTTP 接口真发信（零依赖，直接 fetch）
 *   2. 没配                 → 打到服务端日志，并把码回传给接口调用方，
 *                              页面会显示「未配置邮件服务，验证码已直接显示」
 *
 * 为什么优先 Resend：它只要一个 API Key，免费额度够个人用，不需要 SMTP 用户名密码、
 * 不需要自己搭发信服务，也不用装 nodemailer（多一个依赖就多一份构建风险）。
 * 换成别的服务商时，只要在 sendViaResend 旁边再写一个同签名的函数即可，调用方不用动。
 */

export type MailChannel = "resend" | "console";

export type MailResult = {
  /** 真的投递出去了吗。false = 走的是控制台回显 */
  delivered: boolean;
  channel: MailChannel;
  /** 失败原因（不发给用户看，只进日志） */
  error?: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** 发信等待上限：上游卡住时不能让用户点着「发送」一直转圈 */
const SEND_TIMEOUT_MS = 8000;

const FROM = process.env.MAIL_FROM?.trim() || "左文右题 <onboarding@resend.dev>";

const PURPOSE_LABEL: Record<CodePurpose, string> = {
  login: "登录",
  register: "注册",
};

function codeMailHtml(code: string, purpose: CodePurpose): string {
  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;padding:24px;background:#f5f6f9;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e6e9ef;border-radius:16px;padding:28px 26px">
    <p style="margin:0;font-size:12px;letter-spacing:.18em;color:#3882f6;text-transform:uppercase">左文右题</p>
    <h1 style="margin:10px 0 0;font-size:19px;color:#111827">你的${PURPOSE_LABEL[purpose]}验证码</h1>
    <p style="margin:14px 0 0;font-size:13px;line-height:1.8;color:#4b5563">
      在页面上填入下面这 6 位数字即可完成${PURPOSE_LABEL[purpose]}。验证码 5 分钟内有效，且只能用一次。
    </p>
    <p style="margin:18px 0 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:30px;letter-spacing:.34em;color:#111827">${code}</p>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.8;color:#9ca3af">
      不是你本人操作？直接忽略这封邮件即可，你的账号不会有任何变化。
    </p>
  </div>
</body></html>`;
}

async function sendViaResend(to: string, code: string, purpose: CodePurpose, apiKey: string): Promise<MailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `【左文右题】${PURPOSE_LABEL[purpose]}验证码 ${code}`,
        html: codeMailHtml(code, purpose),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { delivered: false, channel: "resend", error: `HTTP ${response.status} ${text.slice(0, 200)}` };
    }
    return { delivered: true, channel: "resend" };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === "AbortError"
          ? `超过 ${SEND_TIMEOUT_MS}ms 未响应`
          : error.message
        : "未知错误";
    return { delivered: false, channel: "resend", error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 发一封验证码邮件。
 *
 * 配置了 RESEND_API_KEY 但发信失败时**不抛错**，而是退回控制台回显：
 * 用户拿不到码就等于整个登录流程断掉，比「码出现在日志里」严重得多。
 * 失败原因写进日志，方便排查 key 过期、域名未验证这类问题。
 */
export async function sendEmailCode(to: string, code: string, purpose: CodePurpose): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (apiKey) {
    const result = await sendViaResend(to, code, purpose, apiKey);
    if (result.delivered) return result;
    console.error(`[mail] Resend 投递失败（${to}）：${result.error ?? "未知原因"}，退回控制台回显`);
  }

  console.log(
    [
      "",
      "========== 邮箱验证码（未配置邮件服务，仅打印到日志） ==========",
      `  收件人：${to}`,
      `  用  途：${PURPOSE_LABEL[purpose]}`,
      `  验证码：${code}   （5 分钟内有效，只能用一次）`,
      "  要真发信：在 .env 里配 RESEND_API_KEY 与 MAIL_FROM 后重启",
      "=============================================================",
      "",
    ].join("\n"),
  );

  return { delivered: false, channel: "console" };
}

/** 当前是否具备真发信能力（接口用来告诉前端「码是发到邮箱还是显示在页面上」） */
export function hasMailChannel(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}
