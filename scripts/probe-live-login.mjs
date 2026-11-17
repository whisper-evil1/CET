#!/usr/bin/env node
/**
 * 诊断脚本：线上登录为什么失败。
 *
 * 线上网关（workbuddy.host）要求每个同源请求都带 sharecode，漏带的请求会拿到
 * 一个 3KB 的「链接不完整」HTML 页（HTTP 200）—— 于是「表单提交成功但没登上」
 * 这种假象就会出现。这个脚本把注册、登录表单提交、以及期间所有 /api/auth/* 的
 * 响应状态与跳转链都打出来，一眼能看出是哪一步被网关拦了。
 *
 * 用法：BASE_URL=https://... SHARECODE=xxxx node scripts/probe-live-login.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE_URL || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const CODE = (process.env.SHARECODE || "2AI33QQETY").trim();
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const q = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${CODE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const email = process.env.EMAIL || `lg_${Date.now()}@qq.com`;
const pwd = process.env.PWD_OVERRIDE || "Passw0rd!";

if (!process.env.EMAIL) {
  const reg = await fetch(q("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pwd, name: "登录诊断" }),
  });
  console.log("注册:", reg.status, (await reg.text()).slice(0, 120));
} else {
  console.log("跳过注册，直接用既有账号登录：", email);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

page.on("response", async (res) => {
  const url = res.url();
  if (!/\/api\/auth\/|session|csrf/i.test(url)) return;
  let body = "";
  try {
    body = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
  } catch {
    body = "(不可读)";
  }
  console.log(`  ← ${res.status()} ${url.replace(BASE, "")} :: ${body}`);
});
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.log(`  → 导航 ${f.url().replace(BASE, "")}`);
});

console.log("打开登录页…");
await page.goto(q("/login"), { waitUntil: "networkidle2", timeout: 90_000 });
console.log("初始 URL:", page.url().replace(BASE, ""));

await sleep(1200);
await page.type('input[type="email"]', email, { delay: 15 });
await page.type('input[type="password"]', pwd, { delay: 15 });
console.log("输入框:", await page.evaluate(() => ({
  email: document.querySelector('input[type="email"]')?.value,
  pwdLen: (document.querySelector('input[type="password"]')?.value || "").length,
})));

await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
await sleep(6000);

console.log("提交后 URL:", page.url().replace(BASE, ""));
console.log("页面是否仍在登录页:", page.url().includes("/login"));
console.log("页面提示:", (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n+/g, " | "));
console.log("会话:", await page.evaluate(async () => {
  const r = await fetch("/api/auth/session");
  return `${r.status} ${(await r.text()).slice(0, 100)}`;
}));

await browser.close();
process.exit(0);
