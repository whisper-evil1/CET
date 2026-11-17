#!/usr/bin/env node
/**
 * 诊断脚本：定位 /arcade 的 React #418（水合不匹配）。
 *
 * 背景：#418 是「服务端 HTML 与客户端首次渲染不一致」，生产包里只有一行
 * `Minified React error #418`，看不出是哪棵树。开发模式下 React 会打出
 * 「Text content did not match / server: … client: …」与组件栈，
 * 所以这个脚本专门跑在 `next dev` 上，反复加载 /arcade 直到复现。
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3105 ROUNDS=12 node scripts/probe-hydration-arcade.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3105").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROUNDS = Number(process.env.ROUNDS || 8);
const ROUTES = (process.env.ROUTES || "/arcade").split(",");
const WIDTHS = (process.env.WIDTHS || "1280,390").split(",").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const email = `hy_arcade_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pwd, name: "水合诊断" }),
});
console.log("注册:", reg.status, (await reg.text()).slice(0, 60));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const loginPage = await browser.newPage();
await loginPage.setViewport({ width: 390, height: 844 });
await loginPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
const login = await loginViaUi(loginPage, { email, pwd }, { attempts: 3, waitMs: 900, sleep });
console.log("登录:", login.ok);
const cookies = await browser.cookies();
await loginPage.close();

let hit = 0;
for (let round = 1; round <= ROUNDS; round++) {
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 900 });
      const logs = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (/hydrat|did not match|#418|#423|#425|Warning/i.test(text)) {
          logs.push(`[${msg.type()}] ${text.slice(0, 700)}`);
        }
      });
      page.on("pageerror", (err) => logs.push(`[pageerror] ${String(err).slice(0, 700)}`));
      await page.setCookie(...cookies);
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 90_000 });
      await sleep(1200);
      if (logs.length > 0) {
        hit += 1;
        console.log(`\n===== 第 ${round} 轮 ${route} @${width} 命中 =====`);
        for (const line of logs) console.log(line);
      }
      await page.close();
    }
  }
  process.stdout.write(`第 ${round} 轮完成，命中 ${hit} 次\n`);
}

console.log(`\n合计命中 ${hit} 次 / ${ROUNDS * ROUTES.length * WIDTHS.length} 次加载`);
await browser.close();
process.exit(hit > 0 ? 1 : 0);
