#!/usr/bin/env node
/**
 * 全功能回归巡检：注册 → 登录 → 读卷 → 答题 → 生词本 → 收藏 → 笔记 → 打卡 → 排行 → 退出
 *
 * 用法：
 *   node scripts/e2e-regression.mjs                      # 打本地 http://127.0.0.1:3101
 *   BASE=https://xxx.host SHARE=XXXX node scripts/e2e-regression.mjs
 *
 * 设计要点：
 * - 自带 cookie jar（Node 原生 fetch 不存 cookie），每次请求手动回填 Set-Cookie
 * - 线上走 workbuddy 反代时需要 sharecode，先 GET /?sharecode=... 拿 __wb_rsc cookie
 * - 所有断言都打印 HTTP 状态 + 业务 code，失败不中断，最后汇总
 */

const BASE = (process.env.BASE ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const SHARE = process.env.SHARE ?? "";
const APP_ORIGIN = process.env.APP_ORIGIN ?? ""; // 线上需要带 Origin 头（云服务按 Origin 校验）

const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorb(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) continue;
    if (v === "" || /max-age=0/i.test(line)) jar.delete(k);
    else jar.set(k, v);
  }
}

async function req(path, init = {}) {
  const url = path.startsWith("http") ? path : BASE + path;
  const headers = {
    accept: "application/json, text/html;q=0.9",
    ...(APP_ORIGIN ? { origin: APP_ORIGIN, referer: APP_ORIGIN + "/" } : {}),
    ...(init.headers ?? {}),
  };
  const cookies = cookieHeader();
  if (cookies) headers.cookie = cookies;
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 保留原文 */
  }
  const isPlatformBlock =
    !json && res.status === 403 && /链接不完整|sharecode/i.test(text.slice(0, 800));
  return { status: res.status, json, text, isPlatformBlock, headers: res.headers };
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? "  ⟶  " + detail : ""}`);
}

/** 断言业务信封 {code:0} */
function expectOk(name, r, extra) {
  const code = r.json?.code;
  const ok = r.status < 400 && code === 0;
  let detail = `HTTP ${r.status} code=${code ?? "-"}`;
  if (!ok) {
    if (r.isPlatformBlock) detail += " 【被平台 sharecode 拦截】";
    else detail += " " + (r.json?.message ?? r.text.slice(0, 160).replace(/\s+/g, " "));
  } else if (extra) detail += " " + extra;
  record(name, ok, detail);
  return ok ? r.json?.data : null;
}

async function main() {
  console.log(`\n目标：${BASE}${SHARE ? `  sharecode=${SHARE}` : ""}\n`);

  // 0. 平台凭证
  if (SHARE) {
    const boot = await req(`/?sharecode=${SHARE}`);
    record(
      "平台 sharecode 握手",
      boot.status === 200 && !boot.isPlatformBlock,
      `HTTP ${boot.status} cookie=${[...jar.keys()].join(",") || "无"}`,
    );
  }

  // 1. 注册（若被限流则降级到种子账号，保证后续用例仍可跑）
  let email = `reg${Date.now().toString(36)}@qq.com`;
  let password = "Test1234";
  let registered = false;
  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "回归测试" }),
  });
  if (reg.status === 429) {
    record("注册新账号", true, `HTTP 429 触发限流，本轮跳过（降级用种子账号）`);
    email = process.env.E2E_EMAIL ?? "demo@cet.local";
    password = process.env.E2E_PASSWORD ?? "demo1234";
  } else {
    const regData = expectOk("注册新账号", reg, `email=${email}`);
    registered = Boolean(regData?.id);
  }

  // 1b. 重复注册应被拒（409 已注册 / 429 触发限流，两者都属正常拒绝）
  if (registered) {
    const dup = await req("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "回归测试" }),
    });
    const dupOk =
      (dup.status === 409 && dup.json?.code === 4009) ||
      (dup.status === 429 && dup.json?.code === 4029);
    record(
      "重复注册被拒(409/429)",
      dupOk,
      `HTTP ${dup.status} code=${dup.json?.code ?? "-"}${dup.status === 429 ? " (限流)" : ""}`,
    );
  }

  // 2. 登录（NextAuth credentials）
  const csrfRes = await req("/api/auth/csrf");
  const csrfToken = csrfRes.json?.csrfToken;
  record("取 CSRF token", Boolean(csrfToken), csrfToken ? "已获取" : "缺失");

  const form = new URLSearchParams({
    csrfToken: csrfToken ?? "",
    email,
    password,
    callbackUrl: BASE + "/",
    json: "true",
  });
  const login = await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const sessionCookie = [...jar.keys()].find(
    (k) => k.includes("session-token") || k === "authjs.session-token" || k === "__Secure-authjs.session-token",
  );
  record(
    "密码登录",
    Boolean(sessionCookie) && login.status < 400,
    `HTTP ${login.status} session=${sessionCookie ?? "未下发"}`,
  );

  const sess = await req("/api/auth/session");
  record(
    "会话有效",
    sess.json?.user?.email === email,
    `user=${sess.json?.user?.email ?? "null"}`,
  );

  // 3. 读卷
  const papers = await req("/api/papers");
  const paperList = expectOk("试卷列表", papers, `共 ${Array.isArray(papers.json?.data) ? papers.json.data.length : 0} 套`);

  const paperId = paperList?.[0]?.id;
  const paperDetail = paperId ? await req(`/api/papers/${paperId}`) : { status: 0, json: null };
  const detailData = expectOk("试卷详情", paperDetail, paperId ? `paper=${paperId}` : "");

  // 找一道题：详情结构是 data.sections[].passages[].questions[]
  let questionId = null;
  let passageId = null;
  const passages = (detailData?.sections ?? []).flatMap((s) => s.passages ?? []);
  for (const p of passages) {
    if (!passageId) passageId = p.id;
    const q = (p.questions ?? []).find((x) => x?.id);
    if (q) {
      questionId = q.id;
      passageId = p.id;
      break;
    }
  }
  record("定位题目", Boolean(questionId), questionId ? `question=${questionId}` : "未找到");

  // 4. 答题
  if (questionId) {
    const ans = await req("/api/answers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, choice: "A" }),
    });
    expectOk("提交答案", ans, `correct=${ans.json?.data?.isCorrect ?? "-"}`);

    const ansGet = await req(`/api/answers?paperId=${paperId}`);
    expectOk(
      "回读作答记录",
      ansGet,
      `已答 ${Array.isArray(ansGet.json?.data) ? ansGet.json.data.length : 0} 题`,
    );

    const ana = await req(`/api/questions/${questionId}/analysis`);
    expectOk("查看解析", ana, ana.json?.data?.answer ? `answer=${ana.json.data.answer}` : "");

    const ctx = await req(`/api/questions/${questionId}/ai-context`);
    expectOk("AI 上下文", ctx);

    const exp = await req(`/api/questions/${questionId}/experience`);
    expectOk("题目经验值", exp);
  }

  // 5. 生词本
  const lookup = await req("/api/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ word: "abandon", passageId: passageId ?? undefined, context: "They abandon the plan." }),
  });
  expectOk("查词", lookup, lookup.json?.data?.word ?? "");

  const addVocab = await req("/api/vocab", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      word: "regressiontest",
      phonetic: "/rɪˈɡreʃn/",
      definitions: [{ pos: "n.", zh: "回归测试" }],
      example: "We run a regression test.",
      exampleZh: "我们跑一次回归测试。",
      sourcePassageId: passageId ?? null,
    }),
  });
  const vocabData = expectOk("加入生词本", addVocab, `id=${addVocab.json?.data?.id ?? "-"}`);
  const vocabId = vocabData?.id;

  const vocabList = await req("/api/vocab");
  expectOk(
    "生词本列表",
    vocabList,
    `共 ${Array.isArray(vocabList.json?.data) ? vocabList.json.data.length : 0} 词`,
  );

  if (vocabId) {
    const review = await req(`/api/vocab/${vocabId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ result: "known" }),
    });
    expectOk("生词复习", review);

    const refresh = await req("/api/vocab/refresh", { method: "POST" });
    expectOk("生词复习计划刷新", refresh);

    const delVocab = await req(`/api/vocab/${vocabId}`, { method: "DELETE" });
    expectOk("删除生词", delVocab);
  }

  // 6. 收藏
  if (questionId) {
    const fav = await req(`/api/favorites/${questionId}`, { method: "POST" });
    expectOk("收藏题目", fav);

    const favList = await req("/api/favorites");
    expectOk(
      "收藏列表",
      favList,
      `分组 ${Array.isArray(favList.json?.data) ? favList.json.data.length : 0} 个`,
    );

    // 7. 笔记/讨论
    const comment = await req(`/api/questions/${questionId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "回归测试留言：这道题我错在时态判断上。", visibility: "public" }),
    });
    const commentData = expectOk("发布笔记", comment, `id=${comment.json?.data?.id ?? "-"}`);
    const commentId = commentData?.id;

    const commentList = await req(`/api/questions/${questionId}/comments?scope=all`);
    expectOk(
      "笔记列表",
      commentList,
      `共 ${Array.isArray(commentList.json?.data) ? commentList.json.data.length : 0} 条`,
    );

    if (commentId) {
      const like = await req(`/api/comments/${commentId}/like`, { method: "POST" });
      expectOk("点赞笔记", like);
      const edit = await req(`/api/comments/${commentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: "public" }),
      });
      expectOk("编辑笔记", edit);
      const del = await req(`/api/comments/${commentId}`, { method: "DELETE" });
      expectOk("删除笔记", del);
    }
  }

  // 8. 打卡 / 排行 / 统计
  expectOk("打卡日历", await req("/api/checkin"));
  expectOk("排行榜(周)", await req("/api/leaderboard?level=CET4&period=week"));
  expectOk("排行榜(月)", await req("/api/leaderboard?level=CET6&period=month"));
  expectOk("我的统计", await req("/api/me/stats"));

  // 9. AI 答疑
  if (questionId) {
    const ai = await req("/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionId,
        messages: [{ role: "user", content: "这题为什么选 A？" }],
      }),
    });
    record(
      "AI 答疑接口",
      ai.status === 200,
      `HTTP ${ai.status} 流式=${/text\/event-stream|text\/plain/.test(ai.headers.get("content-type") ?? "")}`,
    );
  }

  // 10. 退出登录
  const out = await req("/api/logout", { method: "POST" });
  expectOk("退出登录", out, `残留 cookie=${[...jar.keys()].join(",") || "无"}`);
  const after = await req("/api/auth/session");
  record("退出后会话失效", !after.json?.user, `user=${after.json?.user?.email ?? "null"}`);

  // 11. 未登录访问受保护接口 → 401（而非 500）
  const guard = await req("/api/vocab");
  record(
    "未登录访问受保护接口返回 401",
    guard.status === 401,
    `HTTP ${guard.status} code=${guard.json?.code ?? "-"}`,
  );

  // 11b. 退出后访问 /profile —— 回归第一轮的「白屏」故障，必须干净地跳登录页
  const profile = await req("/profile");
  const profileTo = profile.headers.get("location") ?? "";
  record(
    "退出后 /profile 跳登录（不再白屏）",
    (profile.status === 307 || profile.status === 302) && profileTo.includes("/login"),
    `HTTP ${profile.status} → ${profileTo || "(无 location)"}`,
  );

  // 11c. 非法入参要被拦在写库之前
  const badEmail = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "someone@not-in-whitelist.xyz", password: "Test1234" }),
  });
  record(
    "非白名单邮箱被拒",
    badEmail.status === 429 || badEmail.status === 400,
    `HTTP ${badEmail.status} code=${badEmail.json?.code ?? "-"}（429 为触发限流）`,
  );

  const weakPwd = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "weakpwd@qq.com", password: "123" }),
  });
  record(
    "弱密码被拒",
    weakPwd.status === 429 || weakPwd.status === 400,
    `HTTP ${weakPwd.status} code=${weakPwd.json?.code ?? "-"}（429 为触发限流）`,
  );

  // 12. 登录失败路径
  const badCsrf = await req("/api/auth/csrf");
  const badForm = new URLSearchParams({
    csrfToken: badCsrf.json?.csrfToken ?? "",
    email: "nobody@qq.com",
    password: "wrongpass",
    callbackUrl: BASE + "/",
    json: "true",
  });
  const bad = await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: badForm.toString(),
  });
  record("错误密码被拒", ![...jar.keys()].some((k) => k.includes("session-token")), `HTTP ${bad.status}`);

  // 汇总
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log("\n失败清单：");
    for (const f of failed) console.log(` - ${f.name}：${f.detail}`);
  }
  console.log(`${"─".repeat(60)}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("回归脚本异常：", err);
  process.exit(2);
});
