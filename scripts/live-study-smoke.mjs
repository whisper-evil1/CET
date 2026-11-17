/**
 * 线上「背单词」版块冒烟（纯 HTTP，不开浏览器）。
 *
 * 为什么用 HTTP 而不是浏览器：线上容器冷启动期间网关会回一张过渡页，
 * 浏览器脚本容易把过渡页误判成「页面没内容」。账号、书架、加词这些是接口行为，
 * 用带会话 cookie 的请求直接问最准；页面层只确认状态码与关键文案。
 *
 * 覆盖：
 *   1. 注册 / 登录（账号可用）
 *   2. GET  /api/books        —— 自动建默认书 + 三类书并存
 *   3. POST /api/books        —— 新建书
 *   4. POST /api/books/:id/words —— 加词进指定书
 *   5. GET  /api/books/:id/words —— 词真的在里面
 *   6. GET  /study            —— 页面 200，不再 307（说明路由已上线）
 *   7. DELETE /api/books/:id  —— 收尾删掉验收书
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.LIVE_EMAIL ?? "live-study@qq.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "Live2026#study";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jarFrom = (res, jar) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function signIn() {
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
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
    redirect: "manual",
  });
  jarFrom(res, jar);
  return jar;
}

const api = async (jar, path, init = {}) => {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      "user-agent": UA,
      cookie: cookieHeader(jar),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON：多半是网关过渡页 */
  }
  return { status: res.status, json, text };
};

/* ---------- 1. 账号 ---------- */
let jar = await signIn();
const hasSession = [...jar.keys()].some((k) => /session-token/.test(k));

if (!hasSession) {
  // 账号不存在就注册一个
  const reg = await fetch(url("/api/auth/register"), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "线上验收" }),
  });
  const regJson = await reg.json().catch(() => null);
  check("首次注册账号", regJson?.code === 0 || reg.status === 409, `HTTP ${reg.status} ${regJson?.message ?? ""}`);
  jar = await signIn();
}
check("线上拿到会话", [...jar.keys()].some((k) => /session-token/.test(k)), [...jar.keys()].join(",") || "无");

/* ---------- 2. 书架 ---------- */
const list = await api(jar, "/api/books");
const books = list.json?.data?.books ?? [];
check("GET /api/books 返回书架", list.json?.code === 0 && Array.isArray(books), `HTTP ${list.status}`);
check(
  "自动建了默认词书",
  books.some((b) => b.kind === "custom" && b.isDefault),
  books.map((b) => `${b.id}${b.isDefault ? "*" : ""}`).join(" "),
);
check(
  "阅读生词与四六级高频都在",
  books.some((b) => b.id === "reading") && books.some((b) => b.id === "exam:cet4-core"),
  books.map((b) => b.id).join(" "),
);

/* ---------- 3. 新建书 ---------- */
const name = `线上验收${Date.now().toString().slice(-6)}`;
const created = await api(jar, "/api/books", { method: "POST", body: JSON.stringify({ name }) });
const bookId = created.json?.data?.book?.id;
check("POST /api/books 新建词书", created.json?.code === 0 && Boolean(bookId), name);

/* ---------- 4. 加词 ---------- */
const add = await api(jar, `/api/books/${encodeURIComponent(bookId)}/words`, {
  method: "POST",
  body: JSON.stringify({ words: ["smokecheck"] }),
});
check("往新书里加词", add.json?.code === 0, add.json?.message ?? "");

/* ---------- 5. 词在里面 ---------- */
const words = await api(jar, `/api/books/${encodeURIComponent(bookId)}/words`);
const list2 = words.json?.data?.words ?? [];
check("加进去的词读得出来", list2.some((w) => w.word === "smokecheck"), `共 ${list2.length} 个`);

/* ---------- 6. /study 页面 ---------- */
const page = await fetch(url("/study"), {
  headers: { "user-agent": UA, cookie: cookieHeader(jar) },
  redirect: "manual",
});
const html = await page.text();
check("/study 已上线（200 而非 307）", page.status === 200, `HTTP ${page.status}`);
check("/study 是 Next 页面而不是过渡页", /_next\/static/.test(html), `${html.length} 字节`);

/* ---------- 7. 收尾 ---------- */
const del = await api(jar, `/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
check("删除验收词书", del.json?.code === 0, del.json?.message ?? "");

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上背单词冒烟 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
