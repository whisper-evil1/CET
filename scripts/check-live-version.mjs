/**
 * 判断线上当前跑的是不是最新构建。
 *
 * 为什么需要它：发布接口返回成功 ≠ 线上真的换了代码。平台会复用沙箱，
 * 构建产物或进程可能还是上一版，之前就吃过「源码改了、线上没变」的亏。
 *
 * 判据用 /api/ai/chat 的 X-AI-Mode：
 *   旧版在没有服务端 Key 时返回 mock（会吐一段「演示模式」假解析）；
 *   新版返回 unavailable（明确表示没接上模型，前端据此显示重试）。
 * 这个头只有新代码才会有，比看构建产物时间之类的间接证据可靠得多。
 */
const BASE = (process.env.CHECK_BASE || "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SHARE = process.env.CHECK_SHARE || "";
const EMAIL = process.env.CHECK_EMAIL || "demo@cet.local";
const PASSWORD = process.env.CHECK_PASSWORD || "demo1234";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const withShare = (p) => (SHARE ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : "");

const jar = new Map();
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

let csrfToken = "";
for (let i = 0; i < 4 && !csrfToken; i += 1) {
  const res = await fetch(BASE + withShare("/api/auth/csrf"), { headers: { "user-agent": UA } });
  absorb(res);
  try {
    csrfToken = JSON.parse(await res.text()).csrfToken ?? "";
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!csrfToken) {
  console.log("✗ 拿不到 csrfToken（网关拦截），稍后重试");
  process.exit(1);
}

const login = await fetch(BASE + withShare("/api/auth/callback/credentials"), {
  method: "POST",
  redirect: "manual",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    cookie: cookie(),
    "user-agent": UA,
  },
  body: new URLSearchParams({ email: EMAIL, password: PASSWORD, csrfToken, callbackUrl: withShare("/"), json: "true" }),
});
absorb(login);
const loggedIn = [...jar.keys()].some((k) => /session-token/.test(k));
console.log(`登录：${loggedIn ? "成功" : "失败"}`);

const paper = await (
  await fetch(BASE + withShare("/api/papers/paper-cet4-2024-12"), { headers: { "user-agent": UA } })
).json();
const qid =
  paper?.data?.sections?.[0]?.passages?.[0]?.questions?.[0]?.id ??
  "paper-cet4-2024-12-p1-q46";

const chat = await fetch(BASE + withShare("/api/ai/chat"), {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookie(), "user-agent": UA },
  body: JSON.stringify({ questionId: qid, messages: [{ role: "user", content: "这道题怎么解？" }] }),
});

const mode = chat.headers.get("X-AI-Mode");
const reason = chat.headers.get("X-AI-Reason") ?? "";
const text = await chat.text();

console.log(`X-AI-Mode: ${mode || "(无)"}${reason ? ` / reason=${reason}` : ""}`);
console.log(`正文开头: ${text.replace(/\s+/g, " ").slice(0, 70)}`);

const isNew = mode === "unavailable" || mode === "live";
const hasFakeDemo = /演示模式|AI_API_KEY/.test(text);

if (isNew && !hasFakeDemo) {
  console.log("\n✓ 线上已是新构建（AI 通道语义正确，不再有演示模式假内容）");
  process.exit(0);
}
console.log("\n✗ 线上仍是旧构建（还在用 mock 语义）");
process.exit(1);
