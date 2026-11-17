/**
 * 延迟探针（本地生产服务 next start）。
 *
 * 口径说明：本机 loopback，绝对数值比公网乐观，只用于对比各路由的相对开销、
 * 发现异常慢的页面/接口。测量项为 TTFB（首字节）与 Total（读完响应体）。
 *
 * 用法：BASE_URL=http://127.0.0.1:3000 node scripts/latency-probe.mjs
 */
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

async function call(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const total = performance.now() - t0;
  return { status: res.status, ttfb, total, text };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function measure(label, method, path, { cookie, body, runs = 7 } = {}) {
  // 预热一次，避免首个请求的 Prisma 连接/模块惰性加载污染统计
  await call(method, path, { cookie, body });
  const ttfb = [];
  const total = [];
  let status = 0;
  for (let i = 0; i < runs; i++) {
    const r = await call(method, path, { cookie, body });
    status = r.status;
    ttfb.push(r.ttfb);
    total.push(r.total);
  }
  return {
    label,
    status,
    ttfb: median(ttfb),
    total: median(total),
    min: Math.min(...total),
    max: Math.max(...total),
  };
}

async function main() {
  // 造一个有数据的会话（可用 USER_ID 复用已存在账号，避开注册限流）
  let id = (process.env.USER_ID || "").trim();
  if (!id) {
    const email = `lat_${Date.now()}@qq.com`;
    const reg = await call("POST", "/api/auth/register", {
      body: { email, password: "Passw0rd!", name: "延迟测试" },
    });
    id = JSON.parse(reg.text)?.data?.id ?? "";
  }
  if (!id) throw new Error("没有可用账号，无法继续测延迟（传 USER_ID 或等注册限流窗口）");
  const token = execFileSync("node", ["scripts/dev-session.mjs", id], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const cookie = `authjs.session-token=${token}`;

  // 制造一条错题，让 /api/mistakes 与 /mistakes 有内容
  const papers = JSON.parse((await call("GET", "/api/papers", { cookie })).text);
  const paperId = papers?.data?.[0]?.id;
  const detail = JSON.parse((await call("GET", `/api/papers/${paperId}`, { cookie })).text);
  const q = detail?.data?.sections?.[0]?.passages?.[0]?.questions?.[0];
  if (q) {
    await call("POST", "/api/answers", { cookie, body: { questionId: q.id, choice: "A" } });
  }

  const rows = [];
  rows.push(await measure("页面 / 首页", "GET", "/", { runs: 7 }));
  rows.push(await measure("页面 /cet4 列表", "GET", "/cet4", { runs: 7 }));
  rows.push(await measure("页面 /login 登录", "GET", "/login", { runs: 7 }));
  rows.push(await measure("页面 /mistakes 错题本", "GET", "/mistakes", { cookie, runs: 7 }));
  rows.push(await measure("页面 /profile 我的", "GET", "/profile", { cookie, runs: 7 }));
  rows.push(await measure("页面 /vocab 生词本", "GET", "/vocab", { cookie, runs: 7 }));
  rows.push(await measure("页面 /favorites 收藏", "GET", "/favorites", { cookie, runs: 7 }));
  rows.push(await measure("页面 /leaderboard 排行", "GET", "/leaderboard", { cookie, runs: 7 }));
  rows.push(await measure(`页面 /practice 练习`, "GET", `/practice/${paperId}`, { cookie, runs: 7 }));
  rows.push(await measure("接口 GET /api/papers", "GET", "/api/papers", { cookie, runs: 7 }));
  rows.push(await measure("接口 GET /api/mistakes", "GET", "/api/mistakes", { cookie, runs: 7 }));
  rows.push(await measure("接口 GET /api/leaderboard", "GET", "/api/leaderboard", { cookie, runs: 7 }));
  rows.push(await measure("接口 POST /api/mistakes/analyze", "POST", "/api/mistakes/analyze", { cookie, body: {}, runs: 3 }));

  console.log("\n路由".padEnd(34) + "状态".padEnd(6) + "TTFB(中位)".padEnd(12) + "总耗时(中位)".padEnd(14) + "范围");
  console.log("-".repeat(90));
  for (const r of rows) {
    console.log(
      r.label.padEnd(30) +
        String(r.status).padEnd(8) +
        `${r.ttfb.toFixed(0)} ms`.padEnd(14) +
        `${r.total.toFixed(0)} ms`.padEnd(16) +
        `${r.min.toFixed(0)}–${r.max.toFixed(0)} ms`,
    );
  }
  console.log("\n注：本机 loopback 测量，非公网真实时延；POST analyze 含 mock 打字机节奏（约 1–2 秒）。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
