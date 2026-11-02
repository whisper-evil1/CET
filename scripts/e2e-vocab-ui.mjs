/**
 * 浏览器级复现：注入合法会话后走「点词 → 加入生词本 → 生词本页面」。
 * 用法：node scripts/e2e-vocab-ui.mjs
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const sessionToken = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.setCookie({
  name: "authjs.session-token",
  value: sessionToken,
  domain: "127.0.0.1",
  path: "/",
  httpOnly: true,
});

const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/api/")) {
    logs.push(`[net] ${res.status()} ${res.request().method()} ${u.replace(BASE, "")}`);
  }
});

await page.goto(`${BASE}/practice/paper-cet4-2024-12`, { waitUntil: "networkidle2" });
await sleep(1500);
console.log("当前 URL:", page.url());

const wordCount = await page.evaluate(() => document.querySelectorAll("[data-word]").length);
console.log("可点单词数:", wordCount);

if (wordCount === 0) {
  console.log("页面无可点单词，可能未进入练习页");
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 400)));
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => document.querySelector("[data-word]").click());
await sleep(2000);
const card1 = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return null;
  return { text: dlg.innerText.slice(0, 240), btns: [...dlg.querySelectorAll("button")].map((b) => b.textContent.trim()) };
});
console.log("词卡:", JSON.stringify(card1));

const clicked = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return "no-dialog";
  const btn = [...dlg.querySelectorAll("button")].find((b) => /加入生词本|先收藏/.test(b.textContent));
  if (!btn) return "no-button";
  btn.click();
  return "clicked:" + btn.textContent.trim();
});
console.log("点击:", clicked);
await sleep(2500);

const card2 = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? dlg.innerText.slice(0, 300) : "(词卡已关闭)";
});
console.log("点击后词卡:", JSON.stringify(card2));

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
await sleep(2000);
console.log("=== /vocab 正文前 600 字 ===");
console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)));

console.log("=== 非 200 请求 ===");
console.log(logs.filter((l) => !/^\[net\] 200/.test(l)).join("\n").slice(0, 2500) || "(无)");

await browser.close();
