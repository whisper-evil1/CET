/**
 * 账号数据隔离验证：A 的私密笔记，B 不可见、不可改、不可删。
 * 用法：BASE_URL=... A_ID=<已有用户> node scripts/e2e-privacy.mjs
 *      （B 会自动注册一个新账号）
 */
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const results = [];
const rec = (n, p, d) => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
};

async function j(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}
const cookieFor = (id) =>
  `authjs.session-token=${execFileSync("node", ["scripts/dev-session.mjs", id], { cwd: process.cwd(), encoding: "utf8" }).trim()}`;

async function main() {
  const A_ID = (process.env.A_ID || "").trim();
  if (!A_ID) throw new Error("需要 A_ID");

  const email = `pv_${Date.now()}@qq.com`;
  const reg = await j("POST", "/api/auth/register", { body: { email, password: "Passw0rd!", name: "B用户" } });
  const B_ID = reg.json?.data?.id;
  rec("注册 B 账号", reg.status === 200 && Boolean(B_ID), `HTTP ${reg.status}`);
  if (!B_ID) return finish();

  const A = cookieFor(A_ID);
  const B = cookieFor(B_ID);

  // 取一道题
  const papers = await j("GET", "/api/papers", { cookie: A });
  const paperId = papers.json?.data?.[0]?.id;
  const detail = await j("GET", `/api/papers/${paperId}`, { cookie: A });
  const qid = detail.json?.data?.sections?.[0]?.passages?.[0]?.questions?.[0]?.id;
  if (!qid) throw new Error("没取到题目");

  // A 发一条私密笔记
  const marker = `PRIV-${Date.now()}`;
  const created = await j("POST", `/api/questions/${qid}/comments`, {
    cookie: A,
    body: { content: marker, visibility: "private" },
  });
  const noteId = created.json?.data?.id;
  rec("A 发私密笔记", created.status === 200 && Boolean(noteId), `HTTP ${created.status}`);
  if (!noteId) return finish();

  // A 自己能看到
  const aSees = await j("GET", `/api/questions/${qid}/comments?scope=all`, { cookie: A });
  const aHas = (aSees.json?.data ?? []).some((c) => c.id === noteId);
  rec("A 自己能看到私密笔记", aHas, `A 可见=${aHas}`);

  // B 看不到（all 与 private 两种 scope 都不能看到 A 的私密笔记）
  const bAll = await j("GET", `/api/questions/${qid}/comments?scope=all`, { cookie: B });
  const bPriv = await j("GET", `/api/questions/${qid}/comments?scope=private`, { cookie: B });
  const bLeakAll = (bAll.json?.data ?? []).some((c) => c.id === noteId);
  const bLeakPriv = (bPriv.json?.data ?? []).some((c) => c.id === noteId);
  rec("B 在 scope=all 看不到 A 的私密笔记", !bLeakAll, `泄漏=${bLeakAll}`);
  rec("B 在 scope=private 看不到 A 的私密笔记", !bLeakPriv, `泄漏=${bLeakPriv}`);

  // B 改 / 删 A 的笔记 → 403
  const bPatch = await j("PATCH", `/api/comments/${noteId}`, { cookie: B, body: { visibility: "public" } });
  rec("B 改 A 的笔记被拒(403)", bPatch.status === 403, `HTTP ${bPatch.status}`);
  const bDel = await j("DELETE", `/api/comments/${noteId}`, { cookie: B });
  rec("B 删 A 的笔记被拒(403)", bDel.status === 403, `HTTP ${bDel.status}`);

  // 公开笔记对 B 可见，但 B 仍不能删
  const pubMarker = `PUB-${Date.now()}`;
  const pub = await j("POST", `/api/questions/${qid}/comments`, {
    cookie: A,
    body: { content: pubMarker, visibility: "public" },
  });
  const pubId = pub.json?.data?.id;
  const bAll2 = await j("GET", `/api/questions/${qid}/comments?scope=all`, { cookie: B });
  const bSeesPub = (bAll2.json?.data ?? []).some((c) => c.id === pubId);
  rec("公开笔记对 B 可见", bSeesPub, `B 可见=${bSeesPub}`);
  const bDelPub = await j("DELETE", `/api/comments/${pubId}`, { cookie: B });
  rec("B 删 A 的公开笔记仍被拒(403)", bDelPub.status === 403, `HTTP ${bDelPub.status}`);

  // 清理：A 删自己的两条
  await j("DELETE", `/api/comments/${noteId}`, { cookie: A });
  await j("DELETE", `/api/comments/${pubId}`, { cookie: A });

  finish();
}

function finish() {
  const p = results.filter(Boolean).length;
  console.log(`\n=== ${p}/${results.length} 通过 ===`);
  if (p !== results.length) process.exit(1);
}
main().catch((e) => { console.error("脚本异常：", e); process.exit(1); });
