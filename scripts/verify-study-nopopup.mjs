/**
 * 本地确认两件事：背单词页不再被签到弹窗压住、新建词书按钮读得懂。
 *
 * 对着本地 3055 跑（线上由 live-study-ui.mjs 覆盖）。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3055";
const EMAIL = process.env.EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.PASSWORD ?? "demo1234";
const SHOTS = "shots";
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("button[type=submit]:not([disabled])", { timeout: 20000 });
await page.type("#login-email", EMAIL);
await page.type("#login-password", PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
  page.click("button[type=submit]"),
]);
for (let i = 0; i < 15 && page.url().includes("/login"); i += 1) await sleep(600);
check("本地登录成功", !page.url().includes("/login"), page.url().replace(BASE, ""));

await page.goto(`${BASE}/study`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("article", { timeout: 20000 });
// 签到弹窗是延迟 900ms 才弹的，多等一会儿才判断得准
await sleep(2600);

const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? (d.textContent ?? "").slice(0, 40) : "";
});
check("背单词页不自动弹签到", dialog === "", dialog || "没有弹窗");

const createBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /新建|建$/.test(x.textContent ?? "") && x.closest("article"));
  return b?.textContent?.trim() ?? "";
});
check("新建词书按钮看得懂", createBtn === "新建", createBtn || "没找到");

const badge = await page.evaluate(() => {
  const card = [...document.querySelectorAll("article")].find((c) => /我的词书/.test(c.textContent ?? ""));
  return (card?.textContent ?? "").replace(/\s+/g, " ").slice(0, 60);
});
check("自建书卡片带默认标记", /默认/.test(badge), badge);

await page.screenshot({ path: `${SHOTS}/study-no-popup.png` });
check("无 JS 报错", errors.length === 0, errors[0] ?? "");

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 本地背单词修订 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
