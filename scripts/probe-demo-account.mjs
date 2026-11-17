/**
 * 探针：确认「一键体验」要用的演示账号在当前实例上真的能登录。
 *
 * 为什么单独一个脚本：演示账号能不能登，决定登录页那个按钮是真能用
 * 还是点了就报错。给评委演示时失败一次就够难看，所以每次发布后都要探一遍。
 *
 * 用法：
 *   node scripts/probe-demo-account.mjs                      # 探线上
 *   LIVE_BASE=http://127.0.0.1:3055 node scripts/probe-demo-account.mjs   # 探本地
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const jarFrom = (res, jar) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function tryLogin(email, password) {
  const jar = new Map();
  const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
  jarFrom(csrfRes, jar);
  const { csrfToken } = await csrfRes.json();

  const res = await fetch(url("/api/auth/callback/credentials"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      cookie: cookieHeader(jar),
      origin: BASE,
      referer: url("/login"),
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
    redirect: "manual",
  });
  jarFrom(res, jar);

  const sessionCookie = [...jar.keys()].find((k) => /session-token$/.test(k));
  const hasSession = Boolean(sessionCookie && jar.get(sessionCookie));

  let who = "";
  if (hasSession) {
    const me = await fetch(url("/api/auth/session"), {
      headers: { "user-agent": UA, cookie: cookieHeader(jar) },
    })
      .then((r) => r.json())
      .catch(() => null);
    who = me?.user?.email ?? me?.user?.name ?? "";
  }

  return { status: res.status, hasSession, who };
}

const candidates = [
  ["demo@cet.local", "demo1234"],
  ["live-study@qq.com", process.env.LIVE_PASSWORD ?? "Live2026#study"],
];

let ok = 0;
for (const [email, password] of candidates) {
  const r = await tryLogin(email, password);
  const pass = r.hasSession;
  if (pass) ok += 1;
  console.log(`${pass ? "✓" : "✗"} ${email} — status=${r.status} 会话=${r.hasSession ? "已建立" : "无"}${r.who ? ` 身份=${r.who}` : ""}`);
}

console.log(`\n可用演示账号 ${ok}/${candidates.length}`);
process.exit(ok > 0 ? 0 : 1);
