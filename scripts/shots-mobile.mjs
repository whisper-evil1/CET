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
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const closeModal = () =>
  page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => /^[✕×]$/.test((b.textContent ?? "").trim()) || b.getAttribute("aria-label") === "关闭",
    );
    btn?.click();
  });

await page.goto(`${BASE}/arcade/review`, { waitUntil: "networkidle2" });
await sleep(1200);
await closeModal();
await sleep(300);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => /开始背词/.test(x.textContent ?? ""));
  b?.click();
});
await sleep(2600);
await page.screenshot({ path: `${OUT}/m-review.png` });

await page.goto(`${BASE}/arcade/vocab`, { waitUntil: "networkidle2" });
await sleep(900);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => /开始/.test(x.textContent ?? ""));
  b?.click();
});
await sleep(1400);
await page.screenshot({ path: `${OUT}/m-vocab.png` });

await page.goto(`${BASE}/practice/cet4-2021-06-s1`, { waitUntil: "networkidle2" });
await sleep(600);
await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll("nav button")).find((b) => /长篇阅读匹配/.test(b.textContent ?? ""));
  tab?.click();
});
await sleep(700);
await page.screenshot({ path: `${OUT}/m-matching.png` });

await browser.close();
console.log("mobile shots done");
