/**
 * 为作品介绍文档抓线上截图。
 *
 * 用「演示账号」入口一键登录（按钮点击，不涉及任何密码输入），
 * 然后逐页截图。线上需带 sharecode。
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = "https://cet-reading-82947.app.workbuddy.host";
const SC = "XRRLK7HGZP";
const OUT = path.resolve("shots/submission");
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));

// 1. 登录页：点演示账号按钮
await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  },
  { timeout: 120_000 },
);

const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent ?? "").includes("演示账号"),
  );
  if (!btn) return false;
  btn.click();
  return true;
});
console.log("演示登录按钮:", clicked);

await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 120_000 }).catch(() => {});
await sleep(2500);
console.log("登录后地址:", page.url());

const shot = async (name, p, opts = {}) => {
  await page.goto(url(p), { waitUntil: "domcontentloaded", timeout: 90_000 });
  await sleep(opts.wait ?? 3500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400).replace(/\n+/g, " | "));
  console.log(`[${name}] ${text.slice(0, 180)}`);
};

await shot("01-home", "/", { full: true, wait: 4000 });
await shot("02-vocab", "/vocab");
await shot("03-arcade", "/arcade", { full: true });
await shot("04-leaderboard", "/leaderboard");
await shot("05-mistakes", "/mistakes", { full: true });
await shot("06-create", "/create", { wait: 4000 });
await shot("07-study", "/study");
await shot("08-profile", "/profile");

// 刷题页：从首页找一张卷子
const paperLink = await page.evaluate(async () => {
  const res = await fetch("/api/papers");
  const json = await res.json();
  const arr = json?.data ?? json;
  const first = Array.isArray(arr) ? arr[0] : arr?.papers?.[0];
  return first?.id ?? null;
});
console.log("试卷 id:", paperLink);
if (paperLink) {
  await shot("09-practice", `/practice/${paperLink}`, { wait: 6000 });
  // 点词卡片
  const wordClicked = await page.evaluate(() => {
    const w = [...document.querySelectorAll("[data-word], .word, span")].find(
      (el) => /^[a-zA-Z]{4,}$/.test((el.textContent ?? "").trim()) && el.closest("article, .article"),
    );
    if (!w) return false;
    w.click();
    return true;
  });
  if (wordClicked) {
    await sleep(1800);
    await page.screenshot({ path: `${OUT}/10-wordcard.png` });
    console.log("词卡截图完成");
  }
}

console.log("JS 报错:", errors.length ? errors.slice(0, 3) : "无");
await browser.close();
