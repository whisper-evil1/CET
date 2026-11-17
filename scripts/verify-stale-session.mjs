/**
 * 验证「会话有效但用户已不存在」这个边界。
 *
 * 背景：会话是无状态 JWT，token 能通过校验不代表数据库里还有这个人。
 * 线上曾经就是这么坏的 —— 题库换版重建库，User 行没了，用户的 cookie 还在，
 * 于是一路写到外键约束上，对外返回 500「服务器开小差了」，用户完全不知道该怎么办。
 *
 * 期望行为：这种情况按未登录处理（401），前端引导重新登录，而不是抛 500。
 *
 * 用法（需本地已启动服务）：
 *   node scripts/verify-stale-session.mjs
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const BASE = (process.env.CHECK_BASE || "http://127.0.0.1:3998").replace(/\/$/, "");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function record(ok, label, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const jar = new Map();
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

const email = `stale-${Date.now()}@cet.local`;
const password = "stale1234";

try {
  /* ---------- 准备一个临时账号 ---------- */
  await prisma.user.create({
    data: {
      id: `u-stale-${Date.now()}`,
      email,
      password: await bcrypt.hash(password, 10),
      name: "会话失效测试",
    },
  });

  /* ---------- 登录 ---------- */
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { "user-agent": UA } });
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
      "user-agent": UA,
    },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${BASE}/`, json: "true" }),
  });
  absorb(loginRes);
  const loggedIn = [...jar.keys()].some((k) => /session-token/.test(k));
  record(loggedIn, "用临时账号登录成功");

  /* ---------- 基线：正常写入应该成功 ---------- */
  const okWrite = await fetch(`${BASE}/api/vocab`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(), "user-agent": UA },
    body: JSON.stringify({ word: "baseline", definitions: [{ pos: "n.", zh: "基线" }] }),
  });
  const okBody = await okWrite.json().catch(() => null);
  record(okWrite.status === 200 && okBody?.code === 0, "正常账号：加入生词本成功", `HTTP ${okWrite.status}`);

  /* ---------- 删掉用户，模拟「库被重建」 ---------- */
  await prisma.user.delete({ where: { email } });

  /* ---------- 关键断言：不能是 500 ---------- */
  const staleWrite = await fetch(`${BASE}/api/vocab`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(), "user-agent": UA },
    body: JSON.stringify({ word: "afterdelete", definitions: [{ pos: "n.", zh: "删除后" }] }),
  });
  const staleBody = await staleWrite.json().catch(() => null);
  const msg = staleBody?.message ?? "";
  const trace = staleWrite.headers.get("X-Err-Trace") ?? "";

  record(
    staleWrite.status !== 500,
    "用户已删除：不再返回 500",
    `HTTP ${staleWrite.status}${trace ? ` trace=${trace}` : ""}`,
  );
  record(
    staleWrite.status === 401 && /登录/.test(msg),
    "用户已删除：按未登录处理（引导重新登录）",
    msg || "(无 message)",
  );

  /* ---------- 提交答案同样不能 500 ---------- */
  const q = await prisma.question.findFirst({ select: { id: true } });
  if (q) {
    const ansRes = await fetch(`${BASE}/api/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(), "user-agent": UA },
      body: JSON.stringify({ questionId: q.id, choice: "A" }),
    });
    record(ansRes.status !== 500, "用户已删除：提交答案返回 401 而非 500", `HTTP ${ansRes.status}`);
  }

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
} catch (err) {
  console.error("测试异常:", err);
  fail += 1;
} finally {
  await prisma.user.deleteMany({ where: { email } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
