#!/usr/bin/env node
/** 生成 /vocab 三个入口的截图（交付物，存放在 shots/，不进 git） */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { loginViaUi } from "./lib/login.mjs";

const BASE = "http://127.0.0.1:3100";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `sh_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

fs.mkdirSync("shots", { recursive: true });

await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pwd, name: "林" }),
});

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });

const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 900, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await mobile.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await loginViaUi(mobile, { email, pwd }, { attempts: 3, waitMs: 900, sleep });

await mobile.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
await sleep(1200);
await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "词书")?.click();
});
await sleep(1500);
await mobile.screenshot({ path: "shots/vocab-books-390.png" });

await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入 50")?.click();
});
await sleep(3000);
await mobile.screenshot({ path: "shots/vocab-books-imported-390.png" });

await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "生词本")?.click();
});
await sleep(1500);
await mobile.screenshot({ path: "shots/vocab-list-390.png" });

await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入")?.click();
});
await sleep(900);
await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "填入示例")?.click();
});
await sleep(600);
await mobile.screenshot({ path: "shots/vocab-import-390.png" });

const desktop = await browser.newPage();
await desktop.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1.5 });
await desktop.setCookie(...(await mobile.cookies()));
await desktop.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
await sleep(1500);
await desktop.screenshot({ path: "shots/vocab-list-1280.png" });

await browser.close();
console.log("done");
