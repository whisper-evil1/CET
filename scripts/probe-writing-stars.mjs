#!/usr/bin/env node
/**
 * 诊断用：抓线上「写作/翻译 AI 批改」里残留的字面 ** 上下文。
 *
 * 云模型每次输出不同，撞不上就重试，最多 TRIES 次；一旦抓到就打印每处前后文，
 * 以及所在节点是不是代码块 / 引用块，用来定位是哪条 Markdown 规则漏过了预处理。
 *
 * 用法：BASE_URL=https://xxx SHARECODE=xxx node scripts/probe-writing-stars.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const SHARE = (process.env.SHARECODE || "").trim();
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAPER = process.env.PAPER || "paper-cet4-2024-12";
const TRIES = Number(process.env.TRIES || 4);

const url = (p) => `${BASE}${p}${SHARE ? `${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const account = { email: `pw_${Date.now()}@qq.com`, pwd: "Passw0rd!" };

const ANSWER =
  "Chinese tea culture have a long history， it is more than two thousand years. Tea is popular in China. People drink tea every day. Tea is very good for health.";

async function waitForApp() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url("/api/auth/csrf"));
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return true;
    } catch {}
    await sleep(3000);
  }
  return false;
}

if (!(await waitForApp())) {
  console.log("应用未就绪");
  process.exit(3);
}

const reg = await fetch(url("/api/auth/register"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: account.email, password: account.pwd, name: "写作探针" }),
});
console.log("注册:", reg.status, (await reg.text()).slice(0, 120));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(url("/login"), { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  let ok = false;
  for (let a = 0; a < 3 && !ok; a++) {
    await sleep(700);
    await page.type('input[type="email"]', account.email, { delay: 12 });
    await page.type('input[type="password"]', account.pwd, { delay: 12 });
    const filled = await page.evaluate(
      (acc) => document.querySelector('input[type="email"]')?.value === acc.email,
      account,
    );
    if (!filled) continue;
    await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
    for (let i = 0; i < 60; i++) {
      if (!page.url().includes("/login")) {
        ok = true;
        break;
      }
      await sleep(250);
    }
  }
  console.log("登录:", ok ? "成功" : "失败");

  for (let attempt = 1; attempt <= TRIES; attempt++) {
    await page.goto(url(`/practice/${PAPER}`), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("textarea", { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("nav button")].find(
        (x) => (x.textContent || "").trim() === "翻译",
      );
      b?.click();
    });
    await sleep(900);
    await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(ta, "");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.type("textarea", ANSWER, { delay: 2 });
    await sleep(200);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /AI\s*批改/.test(b.textContent || ""));
      btn?.scrollIntoView({ block: "center" });
      btn?.click();
    });

    let last = "";
    for (let i = 0; i < 120; i++) {
      await sleep(400);
      const t = await page.evaluate(() => {
        const h = [...document.querySelectorAll("h3")].find((e) =>
          (e.textContent || "").includes("AI 批改反馈"),
        );
        return h?.parentElement?.parentElement?.querySelector(".prose-tight")?.innerText ?? "";
      });
      if (t.length > 200 && t === last) break;
      last = t;
    }

    const rep = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find((e) =>
        (e.textContent || "").includes("AI 批改反馈"),
      );
      const body = h?.parentElement?.parentElement?.querySelector(".prose-tight");
      const text = body?.innerText ?? "";
      const hits = [];
      const re = /\*\*/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        hits.push({
          at: m.index,
          before: text.slice(Math.max(0, m.index - 50), m.index),
          after: text.slice(m.index, Math.min(text.length, m.index + 50)),
          inCode: Boolean(body?.querySelector("code, pre")),
          tags: [...new Set([...(body?.querySelectorAll("*") ?? [])].map((e) => e.tagName))].join(","),
        });
      }
      return { len: text.length, hits, tags: text ? [...new Set([...(body?.querySelectorAll("*") ?? [])].map((e) => e.tagName))].join(",") : "" };
    });

    console.log(`\n第 ${attempt} 次：正文 ${rep.len} 字，字面星号 ${rep.hits.length} 处，标签 ${rep.tags}`);
    if (rep.hits.length === 0) continue;
    for (const h of rep.hits.slice(0, 8)) {
      console.log(`--- @${h.at} inCode=${h.inCode} ---`);
      console.log("前:", JSON.stringify(h.before));
      console.log("后:", JSON.stringify(h.after));
    }
    break;
  }
} finally {
  await browser.close();
}
