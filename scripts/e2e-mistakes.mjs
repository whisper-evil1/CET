/**
 * 错题功能端到端验证（本地生产服务）。
 *
 * 覆盖：
 *  1. 未登录访问 /api/mistakes 与 /api/mistakes/analyze → 401
 *  2. 注册测试账号（白名单邮箱）→ 用 dev-session 生成合法会话 cookie
 *  3. 取一套卷子的题目 → 故意提交错误选项（保证产生错题）
 *  4. GET /api/mistakes → 聚合与清单校验（wrongCount>=1、choice 与 answer 不一致）
 *  5. POST /api/mistakes/analyze → 流式返回非空正文
 *  6. GET /mistakes（带会话）→ 200 且服务端已渲染「错题本 / 错题清单」
 *
 * 用法：BASE_URL=http://127.0.0.1:3000 node scripts/e2e-mistakes.mjs
 */
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || process.env.BASE || "http://127.0.0.1:3000").replace(/\/$/, "");

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

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
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（页面 HTML / 流式文本） */
  }
  return { res, text, json };
}

function makeCookie(userId) {
  const token = execFileSync("node", ["scripts/dev-session.mjs", userId], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  return `authjs.session-token=${token}`;
}

async function main() {
  // 1) 未登录 401
  {
    const a = await j("GET", "/api/mistakes");
    const b = await j("POST", "/api/mistakes/analyze", { body: {} });
    record(
      "未登录 /api/mistakes 返回 401",
      a.res.status === 401,
      `HTTP ${a.res.status}`,
    );
    record(
      "未登录 /api/mistakes/analyze 返回 401",
      b.res.status === 401,
      `HTTP ${b.res.status}`,
    );
  }

  // 2) 注册
  const email = `mtest_${Date.now()}@qq.com`;
  const password = "Passw0rd!";
  const reg = await j("POST", "/api/auth/register", {
    body: { email, password, name: "错题测试" },
  });
  const userId = reg.json?.data?.id;
  record("注册测试账号", reg.res.status === 200 && Boolean(userId), `HTTP ${reg.res.status} id=${userId ?? "无"}`);
  if (!userId) return finish();

  const cookie = makeCookie(userId);

  // 3) 取题目
  const papers = await j("GET", "/api/papers", { cookie });
  const paperId = papers.json?.data?.[0]?.id;
  record("取试卷列表", papers.res.status === 200 && Boolean(paperId), `HTTP ${papers.res.status} paperId=${paperId ?? "无"}`);
  if (!paperId) return finish();

  const detail = await j("GET", `/api/papers/${paperId}`, { cookie });
  const passages = detail.json?.data?.sections?.[0]?.passages ?? [];
  let question = null;
  for (const p of passages) {
    const q = (p.questions ?? []).find((x) => Array.isArray(x.options) && x.options.length >= 2);
    if (q) {
      question = q;
      break;
    }
  }
  record("取试卷详情并找到可答题", Boolean(question), question ? `q#${question.number} id=${question.id}` : "无题目");
  if (!question) return finish();

  // 4) 先提交 A 探出正确答案，再故意提交一个错误选项
  const first = await j("POST", "/api/answers", { body: { questionId: question.id, choice: "A" }, cookie });
  const correct = first.json?.data?.answer;
  record("提交答案并拿到正确答案", first.res.status === 200 && Boolean(correct), `HTTP ${first.res.status} 正确答案=${correct ?? "无"}`);
  if (!correct) return finish();

  const wrongChoice = ["A", "B", "C", "D"].find((c) => c !== correct) ?? "B";
  const second = await j("POST", "/api/answers", { body: { questionId: question.id, choice: wrongChoice }, cookie });
  record(
    "故意提交错误选项（制造错题）",
    second.res.status === 200 && second.json?.data?.isCorrect === false,
    `选 ${wrongChoice}，isCorrect=${second.json?.data?.isCorrect}`,
  );

  // 5) 错题聚合
  const mis = await j("GET", "/api/mistakes", { cookie });
  const summary = mis.json?.data?.summary;
  const list = mis.json?.data?.mistakes ?? [];
  const hit = list.find((m) => m.questionId === question.id);
  record(
    "GET /api/mistakes 返回聚合与清单",
    mis.res.status === 200 && summary?.wrongCount >= 1 && list.length >= 1,
    `wrongCount=${summary?.wrongCount} 条数=${list.length}`,
  );
  record(
    "错题条目含正确答案且我的选项≠答案",
    Boolean(hit) && hit.choice === wrongChoice && hit.question?.answer === correct,
    hit ? `choice=${hit.choice} answer=${hit.question?.answer}` : "未命中该题",
  );
  record(
    "聚合字段完整（byType/byPaper/byWrongChoice）",
    Array.isArray(summary?.byType) && Array.isArray(summary?.byPaper) && Array.isArray(summary?.byWrongChoice),
    `byType=${summary?.byType?.length ?? 0} byPaper=${summary?.byPaper?.length ?? 0}`,
  );

  // 6) AI 分析流式
  const an = await j("POST", "/api/mistakes/analyze", { body: {}, cookie });
  const mode = an.res.headers.get("x-ai-mode");
  record(
    "POST /api/mistakes/analyze 返回 200 且为纯文本流",
    an.res.status === 200 && (an.res.headers.get("content-type") || "").includes("text/plain"),
    `HTTP ${an.res.status} mode=${mode}`,
  );
  record(
    "AI 分析正文非空",
    typeof an.text === "string" && an.text.trim().length > 20,
    `长度=${an.text?.length ?? 0}`,
  );

  // 7) 错题页服务端渲染
  const page = await j("GET", "/mistakes", { cookie });
  const html = page.text || "";
  record(
    "/mistakes 页面 200 且渲染错题本",
    page.res.status === 200 && html.includes("错题本") && html.includes("错题清单"),
    `HTTP ${page.res.status} 含标题=${html.includes("错题本")}`,
  );
  record(
    "/mistakes 渲染 AI 分析面板",
    html.includes("AI 薄弱点分析") || html.includes("让 AI 分析我的薄弱点"),
    `含面板=${html.includes("AI 薄弱点分析")}`,
  );

  finish();
}

function finish() {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} 通过 ===`);
  if (passed !== results.length) {
    console.log("存在失败项，详见上方 FAIL 行。");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("脚本异常：", err);
  process.exit(1);
});
