// 线上真实浏览器登录探针：https 直连，sharecode 先行解锁
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

// 凭据一律走环境变量，不落代码库：E2E_EMAIL / E2E_PWD
const env = { E2E_EMAIL: process.env.E2E_EMAIL, E2E_PWD: process.env.E2E_PWD };
if (!env.E2E_EMAIL || !env.E2E_PWD) {
  console.error("缺少 E2E_EMAIL / E2E_PWD 环境变量");
  process.exit(2);
}
const HOST = "https://cet-reading-02555.app.workbuddy.host";
const SHARE = "?sharecode=2AI33QQETY";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });

// 1. sharecode 解锁
await page.goto(`${HOST}/${SHARE}`, { waitUntil: "domcontentloaded", timeout: 30000 });
console.log("解锁页:", page.url().slice(0, 60), "状态渲染:", (await page.title()).slice(0, 30));

// 2. 登录页（先等服务真正就绪：启动期是每 3 秒自刷新的占位页）
await page.goto(`${HOST}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
const started = Date.now();
let ready = false;
while (Date.now() - started < 180000) {
  const text = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  if (!text.includes("正在启动")) { ready = true; break; }
  await sleep(3000);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
}
console.log("服务就绪:", ready, `(${Math.round((Date.now() - started) / 1000)}s)`);
await sleep(1500);
const cookies1 = await page.cookies();
console.log("浏览器 cookie:", cookies1.map((c) => `${c.name}(${c.secure ? "S" : "-"})`).join(", ") || "(无)");

// 3. UI 登录（校验输入值防 hydration 清空，与 e2e 同款）
let ok = false;
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
  await page.evaluate(() => {
    for (const sel of ['input[type="email"]', 'input[type="password"]']) {
      const el = document.querySelector(sel);
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.type('input[type="email"]', env.E2E_EMAIL, { delay: 12 });
  await page.type('input[type="password"]', env.E2E_PWD, { delay: 12 });
  await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
  for (let i = 0; i < 60; i++) {
    if (!page.url().includes("/login")) { ok = true; break; }
    await sleep(400);
  }
  console.log(`尝试${attempt}: url=${page.url().slice(0, 70)}`);
}
console.log(ok ? "登录成功 ✓" : "登录失败 ✗");
if (!ok) {
  console.log("页面文案:", JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)));
}
await browser.close();
process.exit(ok ? 0 : 1);
