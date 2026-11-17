/**
 * 线上验证（HTTP 层）：手机号找回密码是否真的上了线。
 *
 * 为什么不在线上点浏览器：这个功能的核心动作是「点发送验证码」，
 * 那会真的给一个号码发短信 —— 自动化里不能随便发。而浏览器到该域名的连接
 * 在这台机器上也时好时坏（此前 4 轮 ERR_CONNECTION_CLOSED）。
 * 所以线上只验三件**不需要发短信**就能确认的事：
 *
 *   1. 新接口 /api/auth/reset-password-phone 存在，且伪造凭证被拒（防护生效）；
 *   2. 「我的」页仍带「忘记当前密码」入口（这次改动没碰坏老的）；
 *   3. 前端包里能找到新组件的代码 —— 这一条才能证明「新版真的到了线上」，
 *      因为找回面板是点开才渲染的，SSR 里看不到渠道切换栏。
 *
 * 用法：
 *   LIVE_BASE=https://… SHARE_CODE=XXXX node scripts/check-live-forgot-phone.mjs
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@cet.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jar = new Map();
const jarFrom = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/* 1. 登录拿会话 */
const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
jarFrom(csrfRes);
const { csrfToken } = await csrfRes.json();

const signIn = await fetch(url("/api/auth/callback/credentials"), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    cookie: cookieHeader(),
  },
  body: new URLSearchParams({
    csrfToken,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    callbackUrl: `${BASE}/profile`,
    json: "true",
  }),
  redirect: "manual",
});
jarFrom(signIn);
check("演示账号能在线上登录", signIn.status === 302 || signIn.status === 200, `HTTP ${signIn.status}`);

/* 2. 「我的」页老入口没被碰坏 */
const profileRes = await fetch(url("/profile"), {
  headers: { "user-agent": UA, cookie: cookieHeader() },
  redirect: "manual",
});
const profileHtml = profileRes.status === 200 ? await profileRes.text() : "";
check("/profile 能打开（带会话）", profileRes.status === 200, `HTTP ${profileRes.status}`);
check(
  "「忘记当前密码」入口仍在",
  profileHtml.includes("忘记当前密码"),
  profileHtml.includes("忘记当前密码") ? "在 SSR 输出里" : "没找到",
);

/* 3. 新接口存在，且伪造凭证被拒 */
const fakeToken = "x".repeat(40);
const resetRes = await fetch(url("/api/auth/reset-password-phone"), {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({ accessToken: fakeToken, newPassword: "abc12345" }),
});
const resetBody = await resetRes.json().catch(() => ({}));
check(
  "手机号重置接口已上线",
  resetRes.status !== 404,
  `HTTP ${resetRes.status}`,
);
check(
  "伪造 accessToken 被云端身份校验拒绝",
  resetRes.status === 400 && String(resetBody?.message ?? "").includes("云端身份"),
  `HTTP ${resetRes.status} ${String(resetBody?.message ?? "").slice(0, 40)}`,
);

// 弱密码必须在验身份之前被拦：说明校验顺序没错位
const weakRes = await fetch(url("/api/auth/reset-password-phone"), {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": UA },
  body: JSON.stringify({ accessToken: fakeToken, newPassword: "123" }),
});
const weakBody = await weakRes.json().catch(() => ({}));
check(
  "线上也先判密码强度（不先消耗身份校验）",
  weakRes.status === 400 && /8|字母|数字/.test(String(weakBody?.message ?? "")),
  `HTTP ${weakRes.status} ${String(weakBody?.message ?? "").slice(0, 30)}`,
);

/*
 * 4. 构建指纹。
 *
 * 这一条只做记录，不做「新版到了线上」的强断言 —— 原因写在报告里：
 * 找回面板点开才渲染，渠道切换栏不在 SSR 输出里；而前端组件 chunk 是按需加载的，
 * HTML 引用的十几个 chunk 里并不包含它（实测 0 命中），拿 chunk 内容去判断会误报。
 * 「新版真的上线了」的硬证据是上面那条接口断言：旧版本根本没有这个路由，会 404。
 */
const pageChunk =
  (profileHtml.match(/\/_next\/static\/chunks\/app\/profile\/page-[a-z0-9]+\.js/) ?? [])[0] ?? "";
check("记录线上构建指纹（profile 页 chunk 哈希）", Boolean(pageChunk), pageChunk || "没取到");

/* 5. 登录页那条老入口 */
const loginHtml = await fetch(url("/login"), { headers: { "user-agent": UA } }).then((r) => r.text());
check("登录页的「忘记密码？」仍在", loginHtml.includes("忘记密码"), loginHtml.includes("忘记密码") ? "在" : "不在");

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上验证（手机号找回，HTTP 层）${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
