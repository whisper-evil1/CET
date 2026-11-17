#!/usr/bin/env node
/**
 * 写作 / 翻译 AI 批改的端到端验收（两遍：云通道 + 强制本地兜底）。
 *
 * 针对用户截图里的两个症状：
 *   1. 正文出现裸露的 ** 星号（没按 Markdown 渲染）
 *   2. 内容是「当前是演示模式…还没有配置 AI Key…」的通用模板，且对着翻译题讲阅读技巧
 *
 * 两遍的意义：
 *   A. 云通道 —— 证明线上主路径给的是真实批改，且按 Markdown 渲染。
 *   B. 拦截云请求 —— 强制回退到 /api/ai/grade 的本地规则批改，
 *      证明「没有模型可用时也不会退化成通用模板」。这一路以前根本不存在。
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3101 node scripts/e2e-writing-pane.mjs
 *   BASE_URL=https://xxx.host SHARECODE=xxx node scripts/e2e-writing-pane.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHARECODE = (process.env.SHARECODE || "").trim();
const PAPER = process.env.PAPER || "paper-cet4-2024-12";
const SECTION = (process.env.SECTION || "翻译").trim();
const CLOUD_HOST = (process.env.CLOUD_HOST || "app.workbuddy.host").trim();

const url = (p) => `${BASE}${p}${SHARECODE ? `${p.includes("?") ? "&" : "?"}sharecode=${SHARECODE}` : ""}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (scope, name, pass, detail) => {
  results.push({ scope, name, pass });
  console.log(`${pass ? "  OK  " : " FAIL "} [${scope}] ${name}${detail ? `  ⟶  ${detail}` : ""}`);
};

const account = { email: `wp_${Date.now()}@qq.com`, pwd: "Passw0rd!" };

// 故意埋错：中文标点 + 句子很碎 + 缺连接词，本地规则一定能给出具体结论
const ANSWER =
  "Chinese tea culture have a long history， it is more than two thousand years. Tea is popular in China. People drink tea every day. Tea is very good for health.";

const FORBIDDEN = [
  ["演示模式", /演示模式/],
  ["AI_API_KEY", /AI_API_KEY/],
  [".env 配置提示", /\.env|填上 ?`?AI_API_KEY/],
  ["阅读技巧（回原文）", /回原文|找到同一段|逐项排除/],
  ["泛泛的「按这个思路走」", /按这个思路走/],
];

const jsErrors = [];
const badRequests = [];

/**
 * 等服务真正就绪再开始。
 * server.cjs 先 listen 再后台拉 Next，冷启动期间所有请求都拿到「正在启动」的 HTML 占位页
 * （HTTP 200）。此时注册不会真的建号，登录必然失败，会把整轮测试误判成产品坏了。
 */
async function waitForApp(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url("/api/auth/csrf"));
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) return true;
    } catch {
      /* 还没通，继续等 */
    }
    await sleep(3000);
  }
  return false;
}

if (!(await waitForApp())) {
  console.log("应用启动超时，未开始测试（避免把冷启动误判成缺陷）");
  process.exit(3);
}

// 注册：必须校验业务码，光看 HTTP 200 不够——冷启动占位页同样是 200，但账号没建。
let registered = false;
for (let attempt = 1; attempt <= 4 && !registered; attempt++) {
  const reg = await fetch(url("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.pwd, name: "批改测试" }),
  });
  const ct = reg.headers.get("content-type") || "";
  if (reg.ok && ct.includes("json")) {
    const payload = JSON.parse(await reg.text());
    registered = payload?.code === 0;
    if (!registered) console.log(`  注册业务错误：${payload?.message ?? "未知"}`);
  } else if (reg.status === 429) {
    console.log(`  注册被限流（第 ${attempt} 次），等 25 秒`);
    await sleep(25_000);
    continue;
  } else if (reg.ok) {
    console.log(`  注册拿到占位页（应用冷启动），等 15 秒`);
    await sleep(15_000);
    continue;
  } else {
    console.log(`  注册失败 HTTP ${reg.status}`);
  }
  if (!registered) await sleep(5000);
}
rec("准备", "注册测试账号", registered);
if (!registered) {
  console.log("\n注册未完成，终止（避免把环境问题记成产品缺陷）。");
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function readFeedback(page) {
  return page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((e) =>
      (e.textContent || "").includes("AI 批改反馈"),
    );
    const box = h?.parentElement?.parentElement;
    const body = box?.querySelector(".prose-tight");
    return {
      hasBody: Boolean(body),
      boxText: box?.innerText ?? "",
      text: body?.innerText ?? "",
      tags: body?.querySelectorAll("strong, h2, h3, li, blockquote").length ?? 0,
      badge: box?.innerText?.match(/云模型已接入|本地规则批改/)?.[0] ?? "",
    };
  });
}

async function fillAndGrade(page) {
  await page.waitForSelector("textarea", { timeout: 20000 });
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(ta, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type("textarea", ANSWER, { delay: 2 });
  await sleep(250);
  const t0 = Date.now();
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /AI\s*批改/.test(b.textContent || ""));
    if (!btn) return false;
    btn.scrollIntoView({ block: "center" });
    btn.click();
    return true;
  });
  // 等反馈稳定：连续两次读数一致且够长；同时记录首字时间
  let last = "";
  let tFirst = 0;
  for (let i = 0; i < 100; i++) {
    await sleep(250);
    const f = await readFeedback(page);
    if (!tFirst && f.text.length > 0) tFirst = Date.now();
    if (f.text.length > 120 && f.text === last) {
      return { clicked, ...f, firstMs: tFirst ? tFirst - t0 : 0, totalMs: Date.now() - t0 };
    }
    last = f.text;
  }
  const f = await readFeedback(page);
  return { clicked, ...f, firstMs: tFirst ? tFirst - t0 : 0, totalMs: Date.now() - t0 };
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  page.on("pageerror", (e) => jsErrors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|auth_|Origin|cloud|ERR_FAILED|net::/i.test(t)) return; // 云拦截属预期
    jsErrors.push(t.slice(0, 200));
  });
  page.on("response", (r) => {
    const s = r.status();
    const u = r.url();
    if (s >= 400 && !/\/api\/me|\/login|401|403/.test(`${u} ${s}`)) {
      badRequests.push(`${s} ${u.split("?")[0]}`);
    }
  });

  /* ---------- 登录（时序问题统一由 loginViaUi 兜住） ---------- */
  await page.goto(url("/login"), { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  const login = await loginViaUi(page, account, { sleep });
  const logged = login.ok;
  rec("准备", "登录并跳转", logged, login.url);
  if (!logged) {
    console.log("\n登录未成功，后续断言全部依赖登录态，直接终止，避免把环境问题记成产品缺陷。");
    await browser.close();
    process.exit(2);
  }

  async function openSection() {
    await page.goto(url(`/practice/${PAPER}`), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("textarea", { timeout: 25000 }).catch(() => {});
    const ok = await page.evaluate((label) => {
      const btn = [...document.querySelectorAll("nav button")].find(
        (b) => (b.textContent || "").trim() === label,
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, SECTION);
    await sleep(800);
    return ok;
  }

  /* ================= 第一遍：云通道 ================= */
  rec("A 云通道", `切到「${SECTION}」Section`, await openSection());
  const a = await fillAndGrade(page);
  rec("A 云通道", "点到「AI 批改」", a.clicked);
  rec("A 云通道", "出现批改反馈", a.text.length > 120, `${a.text.length} 字`);
  rec("A 云通道", "确实渲染出 Markdown 标签", a.tags > 0, `${a.tags} 个 strong/h/li/blockquote`);
  rec("A 云通道", "文本里没有裸露的 ** 星号", !a.text.includes("**"), a.text.includes("**") ? a.text.match(/.{0,24}\*\*.{0,24}/)?.[0] ?? "" : "干净");
  rec("A 云通道", "徽标显示「云模型已接入」", a.badge === "云模型已接入", a.badge || "缺失");
  for (const [label, re] of FORBIDDEN) {
    rec("A 云通道", `不含「${label}」`, !re.test(a.text));
  }
  const translationVocab = /译文|翻译/.test(a.text) && /评分|分制|档|漏译|时态|语序|用词|语法/.test(a.text);
  rec("A 云通道", "用的是翻译阅卷口径（译文/评分/时态等）", translationVocab, a.text.slice(0, 80).replace(/\s+/g, " "));
  rec("A 云通道", `延迟：首字 ${a.firstMs}ms / 完成 ${a.totalMs}ms`, a.firstMs > 0 && a.totalMs < 45_000, `${a.text.length} 字`);

  /* ================= 第二遍：拦掉云，强制本地兜底 ================= */
  await page.setRequestInterception(true);
  let blocked = 0;
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes(CLOUD_HOST) && /llm|\/v1\/|chat/i.test(u)) {
      blocked++;
      void req.abort("failed");
      return;
    }
    void req.continue();
  });

  rec("B 本地兜底", `切到「${SECTION}」Section`, await openSection());
  const b = await fillAndGrade(page);
  rec("B 本地兜底", "点到「AI 批改」", b.clicked);
  rec("B 本地兜底", "确实拦截到了云请求（证明是走兜底而非云）", blocked > 0, `拦截 ${blocked} 次`);
  rec("B 本地兜底", "出现批改反馈", b.text.length > 80, `${b.text.length} 字`);
  rec("B 本地兜底", "徽标显示「本地规则批改」", b.badge === "本地规则批改", b.badge || "缺失");
  rec("B 本地兜底", "有 15 分制分数", /批改结果：[\d.]+\s*\/\s*15/.test(b.text), b.text.match(/批改结果：[^\n]*/)?.[0] ?? "");
  rec("B 本地兜底", "确实渲染出 Markdown 标签", b.tags > 0, `${b.tags} 个`);
  rec("B 本地兜底", "文本里没有裸露的 ** 星号", !b.text.includes("**"), b.text.includes("**") ? "仍有星号" : "干净");
  for (const [label, re] of FORBIDDEN) {
    rec("B 本地兜底", `不含「${label}」`, !re.test(b.text));
  }
  const ruleHit = /中文标点|句子太碎|缺连接词|数字没译到|字数|实词|分段/.test(b.text);
  rec("B 本地兜底", "给出的是具体条目而非套话", ruleHit, b.text.match(/中文标点|句子太碎|缺连接词|数字没译到|字数[^\n]{0,20}|实词|分段[^\n]{0,10}/)?.[0] ?? "");
  rec("B 本地兜底", `延迟：首字 ${b.firstMs}ms / 完成 ${b.totalMs}ms`, b.firstMs > 0 && b.totalMs < 10_000, `${b.text.length} 字`);

  /* ---------- 截图（必须在改 viewport 之前：isMobile 变化会触发页面重载） ---------- */
  await page.setViewport({ width: 1280, height: 1100 });
  await sleep(500);
  await page.screenshot({ path: ".build/shot/writing-grade-local.png" });

  /* ---------- 窄屏：每个宽度都重新进入翻译页再量 ---------- */
  for (const w of [320, 390]) {
    await page.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true });
    await sleep(400);
    // setViewport 会重载页面，Section 回到默认的「阅读」，必须重新进一次
    await openSection();
    const off = await fillAndGrade(page);
    rec("移动端", `${w}px 重新进入翻译页并出批改`, off.text.length > 60, `${off.text.length} 字`);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const ta = document.querySelector("textarea");
      const btn = [...document.querySelectorAll("button")].find((b) => /AI\s*批改/.test(b.textContent || ""));
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        taFont: ta ? parseFloat(getComputedStyle(ta).fontSize) : 0,
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
        viewport: window.innerWidth,
      };
    });
    rec("移动端", `${w}px 无横向溢出`, metrics.overflow <= 1, `${metrics.overflow}px`);
    rec(
      "移动端",
      `${w}px 输入框字号 ≥16px（防 iOS 聚焦放大整页）`,
      metrics.taFont >= 16,
      `${metrics.taFont}px`,
    );
    rec("移动端", `${w}px 批改按钮可点面积够大`, metrics.btnH >= 32, `${metrics.btnH}px 高`);
  }

  await page.setViewport({ width: 320, height: 800, isMobile: true, hasTouch: true });
  await sleep(300);
  await openSection();
  await fillAndGrade(page);
  await page.screenshot({ path: ".build/shot/writing-grade-320.png" });

  /* ---------- 运行期健康 ---------- */
  rec("运行期", "无 JS 运行时错误", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
  rec("运行期", "无失败请求（4xx/5xx）", badRequests.length === 0, badRequests.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：\n" + failed.map((f) => `  - [${f.scope}] ${f.name}`).join("\n"));
  process.exit(1);
}
