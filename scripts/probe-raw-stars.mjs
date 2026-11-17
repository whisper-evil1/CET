#!/usr/bin/env node
/**
 * 诊断用：打印线上「AI 薄弱点分析」面板里每一处字面 ** 的上下文。
 *
 * 目的：`rawStar=true` 只告诉我们「有星号」，不告诉我们是哪种写法漏过了预处理。
 * 这里把每处前后 40 个字符打出来，用来定位是哪种模式（跨行、紧贴标点、嵌套、代码块…）。
 *
 * 用法：BASE=https://xxx SHARE=xxx node scripts/probe-raw-stars.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const SHARE = (process.env.SHARE || "").trim();
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = (p) => `${BASE}${p}${SHARE ? `${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const account = { email: `rs_${Date.now()}@qq.com`, pwd: "Passw0rd!" };

/**
 * 等服务真正就绪。
 * server.cjs 的机制是「进程一起来就 listen，Next 在后台启动」，所以冷启动期间
 * 请求会拿到一个「正在启动」的 HTML 占位页（HTTP 200）。此时注册接口不会真的建号，
 * 后面登录必然失败——必须等到返回 JSON 再开始。
 */
async function waitForApp(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url("/api/auth/csrf"));
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("json")) return true;
    } catch {
      /* 连接还没通，继续等 */
    }
    await sleep(3000);
  }
  return false;
}

const ready = await waitForApp();
console.log("应用就绪:", ready);
if (!ready) process.exit(3);

// 1) 注册
const reg = await fetch(url("/api/auth/register"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: account.email, password: account.pwd, name: "星号探针" }),
});
const regBody = await reg.text();
console.log("注册:", reg.status, regBody.slice(0, 160));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // 2) 登录（hydration 完成前输入会被 React 接管后清空，所以输入后要校验值再提交）
  await page.goto(url("/login"), { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  let loggedIn = false;
  for (let attempt = 0; attempt < 3 && !loggedIn; attempt++) {
    await sleep(600);
    await page.evaluate(() => {
      for (const sel of ['input[type="email"]', 'input[type="password"]']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.type('input[type="email"]', account.email, { delay: 12 });
    await page.type('input[type="password"]', account.pwd, { delay: 12 });
    const filled = await page.evaluate(
      (a) =>
        document.querySelector('input[type="email"]')?.value === a.email &&
        (document.querySelector('input[type="password"]')?.value ?? "").length > 0,
      account,
    );
    if (!filled) {
      console.log(`  第 ${attempt + 1} 次输入被拦截（值被清空），重试`);
      continue;
    }
    await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
    for (let i = 0; i < 60; i++) {
      if (!page.url().includes("/login")) {
        loggedIn = true;
        break;
      }
      await sleep(250);
    }
  }
  console.log("登录后:", page.url(), loggedIn ? "(成功)" : "(失败)");
  if (page.url().includes("/login")) {
    const diag = await page.evaluate(() => ({
      body: (document.body.innerText || "").slice(0, 400),
      hasSubmit: Boolean(document.querySelector('button[type="submit"]')),
      email: document.querySelector('input[type="email"]')?.value ?? "",
      pwdLen: (document.querySelector('input[type="password"]')?.value ?? "").length,
      cookies: document.cookie,
    }));
    console.log("诊断:", JSON.stringify(diag, null, 2));
  }

  // 3) 制造错题：在页面上下文里调接口（自带 cookie 与 sharecode）
  const made = await page.evaluate(async (share) => {
    const q = (p) => `/api${p}${share ? `${p.includes("?") ? "&" : "?"}sharecode=${share}` : ""}`;
    const papers = await (await fetch(q("/papers"))).json();
    const paperId = papers?.data?.[0]?.id ?? papers?.[0]?.id;
    const detail = await (await fetch(q(`/papers/${paperId}`))).json();
    const sections = detail?.data?.sections ?? [];
    for (const s of sections) {
      for (const p of s.passages ?? []) {
        for (const qq of p.questions ?? []) {
          if ((qq.options ?? []).length === 4) {
            const res = await fetch(q("/answers"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ questionId: qq.id, choice: "A" }),
            });
            return { paperId, questionId: qq.id, status: res.status };
          }
        }
      }
    }
    return { error: "没找到四选一的题" };
  }, SHARE);
  console.log("制造错题:", JSON.stringify(made));
  await sleep(800);

  // 4) 打开错题页，点 AI 分析
  await page.goto(url("/mistakes"), { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(2500);
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("让 AI 分析"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log("点击 AI 分析:", clicked);

  // 5) 等正文稳定
  let last = "";
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const t = await page.evaluate(() => {
      const card = [...document.querySelectorAll("div")].find(
        (d) =>
          (d.className || "").toString().includes("card-in") &&
          (d.textContent || "").includes("AI 薄弱点分析"),
      );
      return card?.querySelector(".prose-tight")?.innerText ?? "";
    });
    if (t.length > 200 && t === last) break;
    last = t;
  }

  // 6) 找每一处 ** 的上下文
  const report = await page.evaluate(() => {
    const card = [...document.querySelectorAll("div")].find(
      (d) =>
        (d.className || "").toString().includes("card-in") &&
        (d.textContent || "").includes("AI 薄弱点分析"),
    );
    const body = card?.querySelector(".prose-tight");
    const text = body?.innerText ?? "";
    const html = body?.innerHTML ?? "";
    const hits = [];
    const re = /\*\*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({
        at: m.index,
        before: text.slice(Math.max(0, m.index - 40), m.index),
        after: text.slice(m.index, Math.min(text.length, m.index + 40)),
      });
    }
    // 原始 markdown 里这些位置长什么样：把 ZWSP 显示成 <ZW>
    const raw = (body?.getAttribute("data-raw") ?? "").replace(/\u200b/g, "<ZW>");
    return { textLen: text.length, htmlLen: html.length, hits: hits.slice(0, 12), raw: raw.slice(0, 400) };
  });

  console.log("正文长度:", report.textLen, "html 长度:", report.htmlLen);
  console.log("字面星号处数:", report.hits.length);
  for (const h of report.hits) {
    console.log(`\n--- @${h.at} ---`);
    console.log("前:", JSON.stringify(h.before));
    console.log("后:", JSON.stringify(h.after));
  }
} finally {
  await browser.close();
}
