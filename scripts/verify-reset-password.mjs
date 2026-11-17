/**
 * 验收：忘记密码 → 邮箱验证码 → 重置密码。
 *
 * 这份脚本只走 HTTP，不碰页面，验的是「接口这一层到底有没有把关」：
 *   1. 注册一个一次性账号（旧密码 oldpass123）
 *   2. 发一枚 purpose=reset 的验证码
 *   3. 错码 → 必须拒绝
 *   4. 弱密码（ab1）→ 必须拒绝，且**不能**消耗验证码的试错次数
 *   5. 正确码 + 合规新密码 → 必须成功
 *   6. 同一枚码再用一次 → 必须拒绝（一次性）
 *   7. 用新密码走 NextAuth 登录 → 必须拿到会话 cookie
 *   8. 用旧密码登录 → 必须失败
 *   9. 给没注册过的邮箱发重置码 → 必须 404（不能白等一封改不了任何东西的信）
 *  10. 给白名单外的域名（demo@cet.local）发重置码 → 必须拒绝
 *
 * 第 4 条是最容易被写错的一条：如果「新密码不合规」放在验码之后，
 * 用户连改三次格式就把验证码试废了，还得重新等一分钟。所以这里专门验：
 * 弱密码失败之后，同一枚码仍然有效。
 *
 * 用法：
 *   本地 dev 实例   BASE=http://127.0.0.1:3100 node scripts/verify-reset-password.mjs
 *   本地生产实例   BASE=http://127.0.0.1:3055 node scripts/verify-reset-password.mjs
 *   线上（带分享码）LIVE_BASE=https://… SHARE_CODE=XXXX node scripts/verify-reset-password.mjs
 *
 * 注意：脚本会在库里留下一个 reset-test-*@qq.com 账号（末尾自动清理，加 --keep 可保留）。
 */
import { PrismaClient } from "@prisma/client";

const BASE = (
  process.env.LIVE_BASE ??
  process.env.BASE ??
  process.env.LOCAL_BASE ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");
const SHARE = process.env.SHARE_CODE ?? "";
const KEEP = process.argv.includes("--keep");
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 统一解包 { code, message, data }；网络层异常也收成同样形状，方便断言 */
async function api(path, init) {
  try {
    const res = await fetch(withShare(path), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body, raw: text.slice(0, 200) };
  } catch (error) {
    return { status: 0, body: null, raw: String(error).slice(0, 200) };
  }
}

const post = (path, payload) => api(path, { method: "POST", body: JSON.stringify(payload) });

/**
 * 走 NextAuth 的 credentials 回调，看这次「登录」成不成立。
 * 成功：302 且 Location 里没有 error，并种下 session token；
 * 失败：302 到 /login?error=CredentialsSignin（v5 也可能回 200 JSON，两种都认）。
 */
async function tryLogin(email, password) {
  const csrfRes = await fetch(withShare("/api/auth/csrf"));
  const csrfBody = await csrfRes.json().catch(() => ({}));
  const csrfToken = csrfBody?.csrfToken;
  if (!csrfToken) return { ok: false, detail: "拿不到 csrfToken" };

  const cookie = (csrfRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const res = await fetch(withShare("/api/auth/callback/credentials"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${BASE}/`,
    }),
    redirect: "manual",
  });

  const location = res.headers.get("location") ?? "";
  const setCookie = (res.headers.getSetCookie?.() ?? []).join(";");
  const sessionIssued = /session-token/i.test(setCookie);
  const failed = /error=/i.test(location);

  /*
   * 判据只认 session cookie。
   * 一开始写成「302 且没 error 就算成功」，结果旧密码那次也被判通过 ——
   * NextAuth 在失败与成功后都可能 302，唯一可靠的区别是「有没有种下 session token」。
   */
  return {
    ok: !failed && sessionIssued,
    status: res.status,
    location: location.slice(0, 120),
    sessionIssued,
  };
}

const stamp = Date.now().toString(36);
const EMAIL = `reset-test-${stamp}@qq.com`;
const OLD_PASSWORD = "oldpass123";
const NEW_PASSWORD = "newpass456";

console.log(`目标：${BASE}`);
console.log(`测试账号：${EMAIL}\n`);

// ---- 1. 注册 ----
const reg = await post("/api/auth/register", { email: EMAIL, password: OLD_PASSWORD, name: "重置测试" });
check("注册一次性账号", reg.status === 200 && reg.body?.code === 0, `HTTP ${reg.status} ${reg.body?.message ?? reg.raw}`);

// ---- 2. 发重置码 ----
const sent = await post("/api/auth/email-code", { email: EMAIL, purpose: "reset" });
const devCode = sent.body?.data?.devCode;
check(
  "发 purpose=reset 验证码",
  sent.status === 200 && sent.body?.code === 0 && Boolean(devCode),
  `HTTP ${sent.status}，码=${devCode ?? "无（已配置真实邮件服务，本脚本需要 devCode 才能继续）"}`,
);
if (!devCode) {
  console.log("\n没有 devCode，后续步骤无法自动执行：请临时取消 RESEND_API_KEY，或从服务端日志取码手动验。");
  process.exit(1);
}

// ---- 3. 错码必须被拒 ----
const wrong = (String(Number(devCode) + 1).padStart(6, "0")).slice(-6);
const wrongRes = await post("/api/auth/reset-password", {
  email: EMAIL,
  code: wrong === devCode ? "000000" : wrong,
  newPassword: NEW_PASSWORD,
});
check(
  "错误验证码被拒绝",
  wrongRes.status === 400 && wrongRes.body?.code === 4000,
  `HTTP ${wrongRes.status} ${wrongRes.body?.message ?? ""}`,
);

// ---- 4. 弱密码被拒，且不消耗验证码次数 ----
const weak = await post("/api/auth/reset-password", {
  email: EMAIL,
  code: devCode,
  newPassword: "ab1",
});
check(
  "弱密码被拒绝且提示具体原因",
  weak.status === 400 && /至少 8 位|字母|数字/.test(weak.body?.message ?? ""),
  `HTTP ${weak.status} ${weak.body?.message ?? ""}`,
);

// ---- 5. 正确码 + 合规密码 ----
const okRes = await post("/api/auth/reset-password", {
  email: EMAIL,
  code: devCode,
  newPassword: NEW_PASSWORD,
});
check(
  "正确码 + 合规密码重置成功",
  okRes.status === 200 && okRes.body?.code === 0,
  `HTTP ${okRes.status} ${okRes.body?.message ?? okRes.raw}`,
);
check(
  "弱密码那一步没有消耗掉验证码（上一步能成功即证明）",
  okRes.status === 200,
  "验证码在密码校验之后才被消费",
);

// ---- 6. 同一枚码不能重放 ----
const replay = await post("/api/auth/reset-password", {
  email: EMAIL,
  code: devCode,
  newPassword: "another789",
});
check(
  "验证码一次性，不能重放",
  replay.status === 400 && replay.body?.code === 4000,
  `HTTP ${replay.status} ${replay.body?.message ?? ""}`,
);

// ---- 7. 新密码能登录 ----
const newLogin = await tryLogin(EMAIL, NEW_PASSWORD);
check(
  "新密码可以登录",
  newLogin.ok,
  `HTTP ${newLogin.status} location=${newLogin.location} session=${newLogin.sessionIssued}`,
);

// ---- 8. 旧密码不能再登录 ----
const oldLogin = await tryLogin(EMAIL, OLD_PASSWORD);
check("旧密码已失效", !oldLogin.ok, `HTTP ${oldLogin.status} location=${oldLogin.location}`);

// ---- 9. 未注册邮箱不发重置码 ----
const ghost = await post("/api/auth/email-code", {
  email: `nobody-${stamp}@qq.com`,
  purpose: "reset",
});
check(
  "未注册邮箱不发送重置码（404）",
  ghost.status === 404 && ghost.body?.code === 4004,
  `HTTP ${ghost.status} ${ghost.body?.message ?? ""}`,
);

// ---- 10. 白名单外域名被挡 ----
const badDomain = await post("/api/auth/email-code", { email: "demo@cet.local", purpose: "reset" });
check(
  "白名单外域名拒绝发码（不给出改不了密码的码）",
  badDomain.status === 400 && badDomain.body?.code === 4000,
  `HTTP ${badDomain.status} ${badDomain.body?.message ?? ""}`,
);

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log("未通过：");
  for (const item of failed) console.log(`  - ${item.name}`);
}

// ---- 清理 ----
if (!KEEP) {
  try {
    const prisma = new PrismaClient();
    await prisma.user.delete({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(`已清理测试账号 ${EMAIL}`);
  } catch (error) {
    console.log(`清理测试账号失败（不影响结论）：${String(error).slice(0, 120)}`);
  }
}

process.exit(failed.length ? 1 : 0);
