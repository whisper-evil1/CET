/**
 * 线上复测（真实浏览器 + 真实网关心跳）。
 *
 * 覆盖：线上页面可达 → 注册并自动登录 → 制造一条错题 → /api/mistakes 聚合 →
 *      /mistakes 页面渲染 → 点击「AI 分析」出正文（并确认请求带 sharecode）→
 *      手机 390 无横向溢出。
 *
 * 用法：BASE_URL=https://... SHARECODE=xxxx node scripts/live-retest.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE_URL || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const CODE = process.env.SHARECODE || "2AI33QQETY";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const q = (p) => `${p}${p.includes("?") ? "&" : "?"}sharecode=${CODE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (n, p, d) => {
  results.push(p);
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
};

const email = `live_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // 1) 首页
  const r0 = await page.goto(q(`${BASE}/`), { waitUntil: "networkidle2", timeout: 60000 });
  rec("线上首页 200", r0 && r0.status() === 200, `HTTP ${r0 && r0.status()}`);
  const title = await page.title();
  rec("首页标题正确", title.includes("左文右题"), title);

  // 2) 注册并自动登录
  await page.goto(q(`${BASE}/login`), { waitUntil: "networkidle2", timeout: 60000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "注册");
    b && b.click();
  });
  await sleep(400);
  await page.type('input[placeholder="小明"]', "线上测试");
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', pwd);
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
  await sleep(1500);
  const loggedIn = !page.url().includes("/login");
  rec("线上注册并自动登录", loggedIn, page.url());

  // 3) 通过页面上下文调用接口（带 cookie + sharecode）制造错题
  const crafted = await page.evaluate(async (code) => {
    const withCode = (p) => p + (p.includes("?") ? "&" : "?") + "sharecode=" + code;
    const get = async (p) => (await fetch(withCode(p), { cache: "no-store" })).json();
    const post = async (p, body) =>
      (
        await fetch(withCode(p), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();

    const papers = await get("/api/papers");
    const paperId = papers?.data?.[0]?.id;
    const detail = await get(`/api/papers/${paperId}`);
    let question = null;
    for (const p of detail?.data?.sections?.[0]?.passages ?? []) {
      const hit = (p.questions ?? []).find((x) => (x.options ?? []).length >= 2);
      if (hit) { question = hit; break; }
    }
    if (!question) return { ok: false, reason: "no question", paperId };
    const first = await post("/api/answers", { questionId: question.id, choice: "A" });
    const correct = first?.data?.answer;
    const wrong = ["A", "B", "C", "D"].find((c) => c !== correct) ?? "B";
    const second = await post("/api/answers", { questionId: question.id, choice: wrong });
    const mis = await get("/api/mistakes");
    return {
      ok: true,
      paperId,
      qid: question.id,
      correct,
      wrong,
      isCorrectAfter: second?.data?.isCorrect,
      wrongCount: mis?.data?.summary?.wrongCount ?? -1,
      mistakesLen: mis?.data?.mistakes?.length ?? -1,
    };
  }, CODE);

  rec("线上取卷取题成功", crafted.ok, crafted.ok ? `paper=${crafted.paperId}` : crafted.reason);
  if (crafted.ok) {
    rec("线上制造错题（isCorrect=false）", crafted.isCorrectAfter === false, `选 ${crafted.wrong}，正确 ${crafted.correct}`);
    rec("线上 /api/mistakes 聚合到错题", crafted.wrongCount >= 1, `wrongCount=${crafted.wrongCount} 条数=${crafted.mistakesLen}`);
  }

  // 4) 错题页渲染
  const r1 = await page.goto(q(`${BASE}/mistakes`), { waitUntil: "networkidle2", timeout: 60000 });
  const html = await page.content();
  rec("线上 /mistakes 200", r1 && r1.status() === 200, `HTTP ${r1 && r1.status()}`);
  rec("线上错题本已渲染", html.includes("错题本") && html.includes("错题清单"), `含标题=${html.includes("错题本")}`);

  // 5) 手机无横向溢出
  const ov = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: window.innerWidth }));
  rec("线上 390 宽无横向溢出", ov.s <= ov.i + 2, `scrollW=${ov.s} innerW=${ov.i}`);

  // 6) 点击 AI 分析：云链路优先，云不可用则回退同源接口（此时必须带 sharecode）
  let aiUrl = "";
  let aiStatus = 0;
  let cloudHit = false;
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/mistakes/analyze")) aiUrl = u;
    if (u.includes("/.cloud/llm/chat/completions")) cloudHit = true;
  });
  page.on("response", (res) => { if (res.url().includes("/api/mistakes/analyze")) aiStatus = res.status(); });
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("让 AI 分析"));
    if (b) { b.click(); return true; }
    return false;
  });
  rec("线上找到并点击 AI 分析", clicked);

  // 正文 + Markdown：等流式结束（按钮变回「重新分析」）再取样
  let panel = null;
  for (let i = 0; i < 200; i++) {
    panel = await page.evaluate(() => {
      const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
        (d.textContent || "").includes("AI 薄弱点分析"),
      );
      if (!card) return null;
      const txt = card.textContent || "";
      const btns = [...card.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
      return {
        len: txt.length,
        strong: card.querySelectorAll("strong").length,
        rawStar: txt.includes("**"),
        streaming: btns.includes("停止"),
        cloudBadge: txt.includes("云模型已接入"),
        localBadge: txt.includes("本地数据归纳"),
      };
    });
    if (panel && panel.len > 300 && !panel.streaming) break;
    await sleep(250);
  }
  rec("线上 AI 分析正文渲染", Boolean(panel) && panel.len > 300, `面板文本长度=${panel ? panel.len : 0}`);
  rec(
    "线上 AI 正文按 Markdown 渲染（无裸露 **）",
    Boolean(panel) && panel.rawStar === false && panel.strong > 0,
    panel ? `rawStar=${panel.rawStar} strong=${panel.strong}` : "无面板",
  );
  rec(
    "线上标注数据来源",
    Boolean(panel) && (panel.cloudBadge || panel.localBadge),
    panel ? `cloud=${panel.cloudBadge} local=${panel.localBadge}` : "无",
  );
  rec(
    cloudHit ? "线上走了浏览器直连云模型" : "线上走了服务端分析接口",
    true,
    cloudHit ? "云链路" : `服务端链路（HTTP ${aiStatus || "未收到"}）`,
  );
  if (aiUrl) {
    rec("线上 AI 请求带 sharecode", aiUrl.includes(`sharecode=${CODE}`), aiUrl.includes("sharecode=") ? "含" : "不含");
    for (let i = 0; i < 50 && !aiStatus; i++) await sleep(200);
    rec("线上 AI 接口 200", aiStatus === 200, `HTTP ${aiStatus || "未收到"}`);
  }

  rec("线上页面无 JS 运行时错误", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "无");

  await page.close();
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n=== 线上 ${passed}/${results.length} 通过 ===`);
if (passed !== results.length) process.exit(1);
