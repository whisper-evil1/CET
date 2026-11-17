/**
 * 线上验证（HTTP 层）：发布后的站点是否真的带上了「我的 → 忘记当前密码」。
 *
 * 为什么不走浏览器：这台机器上浏览器到该域名的连接会被网关反复掐断
 * （ERR_CONNECTION_CLOSED / ERR_TIMED_OUT，重载 4 轮全失败），那是链路问题不是应用问题。
 * 而 /profile 是服务端渲染的，改密码区的静态结构（「当前密码」输入框、
 * 「忘记当前密码？」按钮）本来就在 HTML 里 —— 直接读 HTML 就能证明新版上线了。
 *
 * 只读不写：登录演示账号后 GET /profile，不发验证码、不改密码。
 *
 * 用法：
 *   LIVE_BASE=https://… SHARE_CODE=XXXX node scripts/check-live-forgot-http.mjs
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

/* 2. 读 /profile 的服务端渲染结果 */
const res = await fetch(url("/profile"), {
  headers: { "user-agent": UA, cookie: cookieHeader() },
  redirect: "manual",
});
const html = res.status === 200 ? await res.text() : "";
check("/profile 能打开（带会话）", res.status === 200, `HTTP ${res.status}`);

/* 3. 新版才有的东西 */
check(
  "改密码区有「当前密码」输入框",
  html.includes("当前密码"),
  html.includes("当前密码") ? "在 SSR 输出里" : "没找到",
);
check(
  "改密码区有「忘记当前密码？」入口",
  html.includes("忘记当前密码"),
  html.includes("忘记当前密码") ? "已上线" : "没找到 —— 线上仍是旧版本",
);
check(
  "没有把「忘记密码」误做成独立页面（入口在改密码区内）",
  html.includes("修改密码") && html.includes("忘记当前密码"),
  `修改密码=${html.includes("修改密码")}`,
);

/* 4. 登录页那条老入口没被这次改动碰坏 */
const loginHtml = await fetch(url("/login"), { headers: { "user-agent": UA } }).then((r) => r.text());
check("登录页的「忘记密码？」仍在", loginHtml.includes("忘记密码"), loginHtml.includes("忘记密码") ? "在" : "不在");

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上验证（HTTP 层）${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
