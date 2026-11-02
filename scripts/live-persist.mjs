/**
 * 线上数据持久化验收：
 *   加一条生词 → 记录 → （重新发布）→ 再查 → 仍在 = 数据真的落到云沙箱持久目录了。
 *
 * 用法：
 *   node scripts/live-persist.mjs add     # 写入探针生词
 *   node scripts/live-persist.mjs check   # 检查探针是否还在
 *   node scripts/live-persist.mjs clean   # 清理探针
 */
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.LIVE_BASE ?? "https://cet-reading-02555.app.workbuddy.host";
const SHARE = process.env.LIVE_SHARE ?? "XRRLK7HGZP";
const WORD = "persistprobe";
const action = process.argv[2] ?? "check";

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";

/** https 下 NextAuth 用 __Secure- 前缀，salt 必须与 cookie 名一致 */
async function buildCookies() {
  const pairs = [];
  for (const name of ["__Secure-authjs.session-token", "authjs.session-token"]) {
    const value = await encode({
      token: { uid: "user-demo", sub: "user-demo", name: "小明", email: "demo@cet.local" },
      secret,
      salt: name,
      maxAge: 3600,
    });
    pairs.push(`${name}=${value}`);
  }
  return pairs.join("; ");
}

const cookie = await buildCookies();
const withShare = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARE}`;

async function api(path, init = {}) {
  const res = await fetch(withShare(path), {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const me = await api("/api/me/stats");
console.log("登录态探测 /api/me/stats →", me.status);

if (action === "add") {
  const res = await api("/api/vocab", {
    method: "POST",
    body: JSON.stringify({
      word: WORD,
      definitions: [{ pos: "n.", zh: "持久化探针" }],
      sourceContext: "persistence probe, added before redeploy",
    }),
  });
  console.log("写入探针 →", res.status, JSON.stringify(res.body?.data?.word ?? res.body?.message));
} else if (action === "check") {
  const res = await api("/api/vocab");
  const list = Array.isArray(res.body?.data) ? res.body.data : [];
  const hit = list.find((w) => w.word === WORD);
  console.log("生词总数 →", list.length);
  console.log("探针 persistprobe 是否还在 →", Boolean(hit) ? "✅ 在（数据跨发布保留）" : "❌ 不在（数据被重置）");
  if (hit) console.log("  记录内容:", JSON.stringify({ word: hit.word, zh: hit.definitions[0]?.zh, ctx: hit.sourceContext }));
} else if (action === "clean") {
  const res = await api("/api/vocab", { method: "DELETE", body: JSON.stringify({ word: WORD }) });
  console.log("清理探针 →", res.status, JSON.stringify(res.body?.data));
}
