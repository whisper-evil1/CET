/**
 * 线上验收：多浏览器可达性 + 三类写操作 + AI 通道。
 *
 * 为什么单独写：本地全绿不代表线上全绿——线上多一层平台网关（sharecode 校验）
 * 和一个可能被重置/只读的运行时库。用户报的「加入生词本失败 / 提交答案报错 /
 * AI 抽屉报错」都发生在线上，必须对着真实域名验。
 *
 * 用法：
 *   LIVE_BASE=https://xxx.app.workbuddy.host LIVE_SHARE=XXXX LIVE_TOKEN=... node scripts/live-verify.mjs
 */
const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:3000";
const SC = process.env.LIVE_SHARE ?? "";
const TOKEN = process.env.LIVE_TOKEN ?? "";
const QID = process.env.LIVE_QID ?? "paper-cet4-2024-12-p1-q46";

const withSC = (p) => (SC ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}` : p);

let pass = 0;
let fail = 0;
const failures = [];

function record(ok, name, detail) {
  if (ok) {
    pass += 1;
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const UAS = [
  ["Chrome / Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
  ["Edge / Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"],
  ["Safari / macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"],
  ["Safari / iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1"],
  ["Chrome / Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"],
  ["微信内置浏览器", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x18003228) NetType/WIFI Language/zh_CN"],
  ["手机百度", "Mozilla/5.0 (Linux; Android 13; V2254A Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 baiduboxapp/13.50.0.10"],
  ["迅雷", "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/99.0.4844.88 Mobile Safari/537.36 Thunder/6.9.1"],
  ["老内核 IE11", "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko"],
];

console.log(`目标：${BASE}${SC ? `（sharecode ${SC.slice(0, 4)}…）` : "（本地，无 sharecode）"}\n`);

/* ---------- 1. 多浏览器可达性 ---------- */
console.log("【1】多浏览器打开首页 + 练习页");
const PAPER = process.env.LIVE_PAPER ?? "paper-cet4-2024-12";
for (const [name, ua] of UAS) {
  try {
    const res = await fetch(BASE + withSC("/"), {
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    const html = await res.text();
    const hasTitle = /左文右题|CET|exams|试卷/.test(html);
    const blocked = /链接不完整|请通过完整分享链接|WAF/i.test(html);
    record(
      res.status === 200 && hasTitle && !blocked,
      `${name} 打开首页`,
      `${res.status}${blocked ? " 被网关拦截" : ""}${hasTitle ? "" : " 正文缺失"}`,
    );
  } catch (e) {
    record(false, `${name} 打开首页`, String(e).slice(0, 80));
  }

  // 练习页是真正出问题的地方，必须单独按 UA 验一遍：
  // 这一页是服务端查库渲染的客户端组件，只要 Prisma 查询或 Section 映射有错，
  // 首页正常而练习页 500 —— 只测首页会漏掉。
  // 注意：未登录访问会被 307 重定向到 /login，这是正确行为，不是故障；
  // 而且要 200 就必须带会话，所以这里走已登录的 apiFetch 兜不住，
  // 改为断言「200 且渲染出板块」或「307 且指向 /login」两种合法结果。
  try {
    const res = await fetch(BASE + withSC(`/practice/${PAPER}`), {
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
      redirect: "manual",
    });
    const html = await res.text();
    const hasSections = /写作|听力|阅读|翻译/.test(html);
    const blocked = /链接不完整|请通过完整分享链接|WAF/i.test(html);
    const redirectToLogin =
      res.status >= 300 &&
      res.status < 400 &&
      /\/login/.test(res.headers.get("location") ?? "");
    const okPage = (res.status === 200 && hasSections && !blocked) || redirectToLogin;
    record(
      okPage,
      `${name} 打开练习页`,
      redirectToLogin
        ? `${res.status} → /login（未登录正确跳转）`
        : `${res.status}${blocked ? " 被网关拦截" : ""}${hasSections ? "" : " 未渲染板块"}`,
    );
  } catch (e) {
    record(false, `${name} 打开练习页`, String(e).slice(0, 80));
  }
}

/* ---------- 1.5 题库结构（v2.0 四板块） ---------- */
console.log("\n【1.5】题库结构");
try {
  const r = await fetch(BASE + withSC(`/api/papers/${PAPER}`));
  const j = await r.json();
  const sections = j?.data?.sections ?? [];
  const types = sections.map((s) => s.type).join(",");
  record(
    r.status === 200 && sections.length === 4 && types === "writing,listening,reading,translation",
    "试卷详情为 写作→听力→阅读→翻译 四板块",
    `sections=${sections.length} (${types || "无"})`,
  );
  const qn = sections.reduce((a, s) => a + s.passages.reduce((x, p) => x + p.questions.length, 0), 0);
  record(qn >= 15, "试卷题目数量完整", `${qn} 题`);
} catch (e) {
  record(false, "试卷详情接口", String(e).slice(0, 80));
}

/* ---------- 2. 带会话的写操作（用户报错的三处） ---------- */
const jar = new Map();
if (TOKEN) jar.set("authjs.session-token", TOKEN);
const hdr = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** 收 Set-Cookie 到 jar（https 下 NextAuth 用 __Secure- 前缀，注入式 token 对不上，所以走真实登录） */
function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function login() {
  const email = process.env.LIVE_EMAIL ?? "demo@cet.local";
  const password = process.env.LIVE_PASSWORD ?? "demo1234";
  const csrfRes = await fetch(BASE + withSC("/api/auth/csrf"));
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(BASE + withSC("/api/auth/callback/credentials"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: hdr() },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      callbackUrl: withSC("/"),
      json: "true",
    }),
  });
  absorb(res);
  return [...jar.keys()].some((k) => /session-token/.test(k));
}

if (!TOKEN) {
  const ok = await login();
  record(ok, "账号登录", ok ? `cookie: ${[...jar.keys()].filter((k) => /session/.test(k)).join(",")}` : "未拿到会话 cookie");
}

async function api(path, init = {}) {
  const res = await fetch(BASE + withSC(path), {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers || {}), cookie: hdr() },
  });
  absorb(res);
  let body = "";
  try {
    body = await res.text();
  } catch {}
  return {
    status: res.status,
    body,
    // 响应头要留一份：AI 通道真假、错误 trace 都靠它判断
    headers: Object.fromEntries(res.headers.entries()),
    json: (() => { try { return JSON.parse(body); } catch { return null; } })(),
  };
}

const ctypeHtml = (r) => /text\/html/i.test(r.body.slice(0, 200));

/* 已登录状态下按 UA 再验一次练习页 —— 这才是「所有浏览器都能打开使用」的直接证据 */
console.log("\n【1.8】已登录后各浏览器打开练习页");
for (const [name, ua] of UAS) {
  const r = await api(`/practice/${PAPER}`, { headers: { "user-agent": ua, accept: "text/html" } });
  const hasSections = /写作|听力|阅读|翻译/.test(r.body);
  record(r.status === 200 && hasSections, `${name} 打开练习页（已登录）`, `${r.status}${hasSections ? "" : " 未渲染板块"}`);
}

console.log("\n【2】写操作（用户报错的三个位置）");
const vocab = await api("/api/vocab", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    word: "nostalgia",
    phonetic: "nɒˈstældʒə",
    definitions: [{ pos: "n.", zh: "怀旧, 乡愁" }],
    sourceContext: "The obvious explanation — nostalgia — does not survive contact with the numbers.",
    sourcePassageId: "paper-cet4-2024-12-p1",
  }),
});
record(
  vocab.status === 200 && vocab.json?.code === 0,
  "加入生词本",
  vocab.status === 200 ? "写入成功" : `HTTP ${vocab.status} ${(vocab.json?.message ?? (ctypeHtml(vocab) ? "被网关拦截(HTML)" : ""))}`,
);

const answers = await api("/api/answers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ questionId: QID, choice: "B", durationMs: 2500 }),
});
record(
  answers.status === 200 && answers.json?.code === 0,
  "提交答案",
  answers.status === 200 ? `判分 ${answers.json?.data?.isCorrect ? "正确" : "错误"}` : `HTTP ${answers.status} ${answers.json?.message ?? (ctypeHtml(answers) ? "被网关拦截(HTML)" : "")}`,
);

/* ---------- 3. 读接口与 AI 通道 ---------- */
console.log("\n【3】AI 相关与统计");
for (const [name, path] of [
  ["题目上下文 ai-context", `/api/questions/${QID}/ai-context`],
  ["经验包 experience", `/api/questions/${QID}/experience`],
  ["我的统计 me/stats", "/api/me/stats"],
  ["排行榜 leaderboard", "/api/leaderboard"],
  ["生词本列表", "/api/vocab"],
]) {
  const r = await api(path);
  record(r.status === 200 && r.json?.code === 0, name, r.status === 200 ? "ok" : `HTTP ${r.status} ${r.json?.message ?? (ctypeHtml(r) ? "被网关拦截(HTML)" : "")}`);
}

const chat = await api("/api/ai/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ questionId: QID, messages: [{ role: "user", content: "为什么不选B" }] }),
});
/*
 * 服务端通道的判定必须看 X-AI-Mode，不能看「有没有返回文字」。
 * 新版在没接上模型时会回一段「AI 服务暂时不可用」的说明 —— 那也是 200 且有文字，
 * 按内容判断会误报成「真实模型可用」，报告就失真了。
 */
const aiMode = chat.headers?.["x-ai-mode"] ?? "";
record(
  chat.status === 200,
  "AI 答疑（服务端通道）",
  chat.status !== 200
    ? `HTTP ${chat.status}`
    : aiMode === "live"
      ? "可用，真实模型"
      : `可用，服务端未直连模型（X-AI-Mode=${aiMode || "无"}；前端优先走云端通道）`,
);

/* ---------- 4. 数据留痕清理 ---------- */
if (vocab.json?.data?.id) {
  const del = await api(`/api/vocab?id=${encodeURIComponent(vocab.json.data.id)}`, { method: "DELETE" });
  if (del.status !== 200) {
    // 换用按词删除
    await api(`/api/vocab?word=nostalgia`, { method: "DELETE" });
  }
  console.log("（已尝试清理本次写入的测试生词）");
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
if (failures.length) {
  console.log("失败项：");
  failures.forEach((f) => console.log("  -", f));
}
process.exit(fail === 0 ? 0 : 1);
