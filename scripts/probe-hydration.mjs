#!/usr/bin/env node
/**
 * 临时诊断：逐个路由新开页面加载，收集 pageerror，定位 React #418 水合不匹配发生在哪一页。
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `hy_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

const res = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pwd, name: "水合诊断" }),
});
console.log("register", res.status, (await res.text()).slice(0, 60));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });

// 先登录拿 cookie
const loginPage = await browser.newPage();
await loginPage.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
await loginPage.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
const login = await loginViaUi(loginPage, { email, pwd }, { attempts: 3, waitMs: 900, sleep });
console.log("login", login.ok);
await loginPage.close();

const cookies = await browser.cookies();
await browser.setCookie(...cookies).catch(() => {});

const routes = ["/", "/vocab", "/favorites", "/leaderboard", "/profile", "/mistakes"];
for (const route of routes) {
  for (const width of [320, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 700, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err).split("\n")[0].slice(0, 180)));
    page.on("cookie", () => {});
    await page.setCookie(...cookies);
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle2", timeout: 45_000 });
    await sleep(1500);
    console.log(`${route} @${width}: ${errors.length === 0 ? "clean" : errors.join(" | ")}`);
    await page.close();
  }
}

await browser.close();
process.exit(0);
