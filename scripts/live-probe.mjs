/**
 * 线上失败项的独立定性探针：
 *   1) 未登录 + 带分享凭证 → 应用层应返回 401（而不是平台层的 403）
 *   2) 不含 <script> 但含 HTML 标签的留言 → 应用层 XSS 清洗是否生效
 * 用法：node scripts/live-probe.mjs
 */
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = "https://cet-reading-02555.app.workbuddy.host";
const SHARE = "XRRLK7HGZP";
const QID = "paper-cet4-2024-12-q46";

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const cookieName = "__Secure-authjs.session-token";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "小明", email: "demo@cet.local" },
  secret,
  salt: cookieName,
  maxAge: 3600,
});
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARE}`;

// 1) 未登录（不带任何 cookie），但 URL 带分享凭证
const anon = await fetch(url(`/api/questions/${QID}/experience`));
console.log("未登录 + 分享凭证 → /experience 状态:", anon.status, anon.status === 401 ? "✅ 应用层 401" : "⚠️ 非 401");

const anonVocab = await fetch(url("/api/vocab"));
console.log("未登录 + 分享凭证 → /api/vocab 状态:", anonVocab.status);

// 2) 已登录，提交含 HTML 标签与零宽字符的私密笔记（WAF 放行载荷）
const payload = "  <b>粗体</b>只有我能看到的笔记\u200b  ";
const create = await fetch(url(`/api/questions/${QID}/comments`), {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `${cookieName}=${token}` },
  body: JSON.stringify({ content: payload, visibility: "private" }),
});
const created = await create.json().catch(() => null);
const content = created?.data?.content ?? "";
console.log("提交含标签的私密笔记 →", create.status);
console.log("  返回内容:", JSON.stringify(content));
console.log("  标签已剥离:", !String(content).includes("<"), "| 零宽字符已剥离:", !String(content).includes("\u200b"));

// 3) 清理
if (created?.data?.id) {
  const del = await fetch(url(`/api/comments/${created.data.id}`), {
    method: "DELETE",
    headers: { cookie: `${cookieName}=${token}` },
  });
  console.log("清理测试留言 →", del.status);
}

// 4) XSS 载荷本身是否被平台 WAF 拦截
const xss = await fetch(url(`/api/questions/${QID}/comments`), {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `${cookieName}=${token}` },
  body: JSON.stringify({ content: "<script>alert(1)</script>", visibility: "private" }),
});
const xssText = await xss.text();
console.log(
  "提交 <script> 载荷 →",
  xss.status,
  xssText.includes("WAF") ? "（平台 WAF 拦截页，请求未到达应用）" : xssText.slice(0, 120),
);
