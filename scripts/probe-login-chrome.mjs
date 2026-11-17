#!/usr/bin/env node
/**
 * 诊断：Chrome 移动视口下登录为什么失败。
 * 打印提交前后的 URL、输入框实际值、页面可见报错文案、以及当前激活的是「登录」还是「注册」。
 *
 * 用法：BASE=https://xxx SHARE=xxx node scripts/probe-login-chrome.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const SHARE = (process.env.SHARE || "").trim();
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = (p) => `${BASE}${p}${SHARE ? `${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const account = { email: `lc_${Date.now()}@qq.com`, pwd: "Passw0rd!" };

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
if (!(await waitForApp())) process.exit(3);

for (let i = 1; i <= 3; i++) {
  const r = await fetch(url("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.pwd, name: "登录诊断" }),
  });
  const body = await r.text();
  console.log(`注册 ${i}:`, r.status, body.slice(0, 100));
  if (r.ok) break;
  await sleep(25_000);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(url("/login"), { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector('input[type="email"]', { timeout: 20000 });
  await sleep(1500);

  const before = await page.evaluate(() => ({
    url: location.href,
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, name: i.name, value: i.value })),
    buttons: [...document.querySelectorAll("button")].map((b) => ({
      type: b.type,
      text: (b.textContent || "").trim().slice(0, 20),
    })),
    tabs: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).slice(0, 6),
    bodyText: (document.body.innerText || "").slice(0, 200).replace(/\n+/g, " | "),
  }));
  console.log("\n提交前:", JSON.stringify(before, null, 2));

  await page.type('input[type="email"]', account.email, { delay: 12 });
  await page.type('input[type="password"]', account.pwd, { delay: 12 });
  const filled = await page.evaluate(() => ({
    email: document.querySelector('input[type="email"]')?.value ?? "",
    pwdLen: (document.querySelector('input[type="password"]')?.value ?? "").length,
  }));
  console.log("\n输入后:", JSON.stringify(filled));

  await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
  await sleep(5000);

  const after = await page.evaluate(() => ({
    url: location.href,
    bodyText: (document.body.innerText || "").slice(0, 300).replace(/\n+/g, " | "),
    inputs: [...document.querySelectorAll("input")].map((i) => ({ type: i.type, value: i.value })),
  }));
  console.log("\n提交后:", JSON.stringify(after, null, 2));
} finally {
  await browser.close();
}
