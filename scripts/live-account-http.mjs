/**
 * 线上账号链路（纯 HTTP，不开浏览器）。
 *
 * 为什么要单独写一个：线上容器冷启动不稳，浏览器验收容易撞上「正在启动」页假红，
 * 但「账号到底有没有真的进库、登录到底通不通」是可以用 HTTP 直接问清楚的：
 *   1. 取 csrf → 走 NextAuth 的 credentials 回调，用邮箱 + 密码换会话 cookie；
 *   2. 拿这个 cookie 调 /api/account/profile，看返回的是不是那个人；
 *   3. 再用错密码试一次，必须被拒。
 *
 * 这样即使浏览器那头不稳，账号部分也有硬证据。
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.LIVE_EMAIL;
const PASSWORD = process.env.LIVE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("需要 LIVE_EMAIL / LIVE_PASSWORD");
  process.exit(2);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

function jarFrom(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** NextAuth credentials 登录，返回 cookie jar */
async function signIn(password) {
  const jar = new Map();
  const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
  jarFrom(csrfRes, jar);
  const { csrfToken } = await csrfRes.json();

  const body = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password,
    callbackUrl: `${BASE}/`,
    json: "true",
  });
  const res = await fetch(url("/api/auth/callback/credentials"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      cookie: cookieHeader(jar),
      origin: BASE,
      referer: url("/login"),
    },
    body,
    redirect: "manual",
  });
  jarFrom(res, jar);
  const text = await res.text();
  return { jar, status: res.status, text: text.slice(0, 160) };
}

/* 1) 正确密码 */
const good = await signIn(PASSWORD);
const hasSession = [...good.jar.keys()].some((k) => /session-token/.test(k));
check("线上密码登录拿到会话", hasSession, `status=${good.status} cookies=${[...good.jar.keys()].join(",") || "无"}`);

/* 2) 用会话读账号 */
const profRes = await fetch(url("/api/account/profile"), {
  headers: { "user-agent": UA, cookie: cookieHeader(good.jar) },
});
const profText = await profRes.text();
let prof = null;
try {
  prof = JSON.parse(profText);
} catch {
  /* 非 JSON：可能又是启动页 */
}
const data = prof?.data;
check("会话能读到账号资料", prof?.code === 0 && data?.email === EMAIL, prof?.message ?? profText.slice(0, 100));
if (data) {
  check("账号带手机号字段（可空）", "phone" in data, `phone=${JSON.stringify(data.phone)}`);
  check("账号带 passwordSet 标记", typeof data.passwordSet === "boolean", `passwordSet=${data.passwordSet}`);
  console.log("   账号:", JSON.stringify(data).slice(0, 220));
}

/* 3) 错密码必须被拒 */
const bad = await signIn(`${PASSWORD}-wrong`);
const badSession = [...bad.jar.keys()].some((k) => /session-token/.test(k));
check("错误密码登不进去", !badSession, `status=${bad.status}`);

/* 4) 未登录访问资料接口要 401 */
const anon = await fetch(url("/api/account/profile"), { headers: { "user-agent": UA } });
const anonJson = await anon.json().catch(() => ({}));
check("未登录读资料被拒", anonJson.code === 4001, `HTTP ${anon.status} code=${anonJson.code}`);

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上账号链路 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
