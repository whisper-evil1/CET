/**
 * 截图：本轮改动的四个界面（阅读匹配 / 听力连播 / 生词本背单词 / 游戏厅）。
 * 用 dev 登录票据进页面，截到 shots/round9/ 下。
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = "shots/round9";
const line = fs.existsSync(".env")
  ? fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="))
  : "";
const secret = (line ? line.slice(12).trim().replace(/^["']|["']$/g, "") : "") || "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 980 },
});
const page = await browser.newPage();
await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickByText = (pattern) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const target = Array.from(document.querySelectorAll("button")).find((b) => re.test(b.textContent ?? ""));
    if (!target) return false;
    target.click();
    return true;
  }, pattern.source);

await page.goto(`${BASE}/practice/cet4-2021-06-s1`, { waitUntil: "networkidle2" });
await sleep(500);
await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll("nav button")).find((b) =>
    /长篇阅读匹配/.test(b.textContent ?? ""),
  );
  tab?.click();
});
await sleep(700);
await page.screenshot({ path: `${OUT}/practice-matching.png` });

await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll("nav button")).find((b) => /听力/.test(b.textContent ?? ""));
  tab?.click();
});
await sleep(1200);
await page.screenshot({ path: `${OUT}/practice-listening.png` });

await page.goto(`${BASE}/arcade`, { waitUntil: "networkidle2" });
await sleep(700);
await page.screenshot({ path: `${OUT}/arcade-home.png` });

await page.goto(`${BASE}/arcade/review`, { waitUntil: "networkidle2" });
await sleep(1200);
await page.screenshot({ path: `${OUT}/review-intro.png` });
await clickByText(/开始背词/);
await sleep(2600);
await page.screenshot({ path: `${OUT}/review-judge.png` });
await clickByText(/有点印象/);
await sleep(700);
await page.screenshot({ path: `${OUT}/review-choose.png` });

await page.goto(`${BASE}/arcade/vocab`, { waitUntil: "networkidle2" });
await sleep(1400);
await clickByText(/开始/);
await sleep(1200);
await page.screenshot({ path: `${OUT}/arcade-vocab.png` });

await browser.close();
console.log("shots done");
