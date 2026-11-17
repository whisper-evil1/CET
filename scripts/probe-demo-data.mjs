/**
 * 探针：看一眼演示账号里的数据，判断「评委点进去看到的是活的还是空的」。
 *
 * 只读，不写任何东西。输出各接口的数量级，够判断「有没有内容」即可。
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const jar = new Map();
const jarFrom = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
jarFrom(csrfRes);
const { csrfToken } = await csrfRes.json();
const loginRes = await fetch(url("/api/auth/callback/credentials"), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    cookie: cookie(),
    origin: BASE,
    referer: url("/login"),
  },
  body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE}/`, json: "true" }),
  redirect: "manual",
});
jarFrom(loginRes);

const get = async (p) => {
  const r = await fetch(url(p), { headers: { "user-agent": UA, cookie: cookie() } });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 就留 null */
  }
  return { status: r.status, json, text };
};

const probe = async (label, p, pick) => {
  const r = await get(p);
  let detail = "";
  try {
    detail = pick ? pick(r.json, r.text) : `status=${r.status}`;
  } catch (e) {
    detail = `解析失败 ${String(e).slice(0, 40)}`;
  }
  console.log(`${r.status === 200 ? "✓" : "✗"} ${label} — ${detail}`);
};

await probe("生词本", "/api/vocab?limit=5", (j) => {
  const d = j?.data ?? j;
  const items = d?.items ?? d ?? [];
  return `共 ${Array.isArray(items) ? items.length : (d?.total ?? "?")} 条：${(items.slice?.(0, 4) ?? []).map((x) => x.word ?? x.w).join(", ") || "空"}`;
});
await probe("词书", "/api/books", (j) => (j?.books ?? j?.data?.books ?? []).map((b) => `${b.name}(${b.count ?? 0})`).join(" / ") || "空");
await probe("错题", "/api/mistakes", (j) => {
  const d = j?.data ?? j;
  return `类型=${Array.isArray(d) ? "数组" : Object.keys(d ?? {}).join(",")} 长度=${Array.isArray(d) ? d.length : "?"}`;
});
await probe("收藏", "/api/favorites", (j) => {
  const d = j?.data ?? j;
  return `组数=${Array.isArray(d) ? d.length : "?"}`;
});
await probe("签到", "/api/signin", (j) => JSON.stringify(j?.data ?? j)?.slice(0, 220) ?? "");
await probe("统计", "/api/me/stats", (j) => JSON.stringify(j?.data ?? j)?.slice(0, 260) ?? "");
await probe("词组队列", "/api/vocab/queue?limit=5", (j) => {
  const d = j?.data ?? j;
  const items = d?.items ?? d ?? [];
  return `共 ${Array.isArray(items) ? items.length : "?"} 个待复习`;
});
