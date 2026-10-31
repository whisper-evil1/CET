// 临时验证脚本：线上 ai-context 服务端链路（node fetch 带 Origin 绕过反代 CSRF 检查）
import { writeFileSync } from "node:fs";

const BASE = "https://cet-reading-82947.app.workbuddy.host";
let cookieJar = "";

function mergeSetCookie(res) {
  const sc = res.headers.get("set-cookie");
  if (!sc) return;
  for (const part of sc.split(/,\s*(?=[^=]+=)/)) {
    const nv = part.split(";")[0].trim();
    if (nv) cookieJar = cookieJar ? `${cookieJar}; ${nv}` : nv;
  }
}

const out = [];
const log = (s) => {
  console.log(s);
  out.push(s);
};

// 统一带上 Origin/Referer，模拟浏览器跨域头，绕过反代的来源校验
function headers(extra = {}) {
  return {
    Origin: BASE,
    Referer: `${BASE}/`,
    Cookie: cookieJar,
    ...extra,
  };
}

try {
  // 注册（已存在则 409，不影响后续登录）
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email: "qa4@demo.com", password: "qa123456", name: "QA4" }),
  });
  log(`register: ${reg.status} ${(await reg.text()).slice(0, 60)}`);

  // csrf
  const csrf = await fetch(`${BASE}/api/auth/csrf`, { headers: headers() });
  mergeSetCookie(csrf);
  const { csrfToken } = await csrf.json();
  log(`csrf token: ${csrfToken.slice(0, 12)}...`);

  // 登录
  const login = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams({
      csrfToken,
      email: "qa4@demo.com",
      password: "qa123456",
      callbackUrl: `${BASE}/`,
      json: "true",
    }).toString(),
    redirect: "manual",
  });
  mergeSetCookie(login);
  log(`login: ${login.status}`);

  // ai-context 未登录对照
  const saved = cookieJar;
  cookieJar = "";
  const noAuth = await fetch(`${BASE}/api/questions/cmvvypl5v0000mlo8e756qq7y/ai-context`, {
    headers: headers(),
  });
  log(`ai-context no-cookie: ${noAuth.status}`);
  cookieJar = saved;

  // ai-context 登录后
  const ctx = await fetch(`${BASE}/api/questions/cmvvypl5v0000mlo8e756qq7y/ai-context`, {
    headers: headers(),
  });
  const ctxText = await ctx.text();
  log(`ai-context with-cookie: ${ctx.status}`);
  log(`ai-context body: ${ctxText.slice(0, 280)}`);
} catch (e) {
  log(`ERR: ${e?.message ?? e}`);
}

writeFileSync("./verify-out.txt", out.join("\n"));
