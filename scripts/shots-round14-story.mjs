/** 第十四轮出图：故事串联面板 / 词书 / 背单词 桌面 + 移动端 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const url = (p) => `${BASE}${p}${SC ? `${p.includes("?") ? "&" : "?"}sharecode=${SC}` : ""}`;
const OUT = process.env.OUT || "shots/round14";
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", "--mute-audio"] });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("  saved", `${OUT}/${name}.png`);
};

const login = async (page) => {
  await page.goto(url("/vocab?mode=audio"), { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let i = 0; i < 40; i++) {
    const h = await page.evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react"))).catch(() => false);
    if (h) break;
    await sleep(1000);
  }
  if (page.url().includes("/login")) {
    for (let i = 0; i < 4; i++) {
      const ok = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /演示账号/.test(x.textContent ?? ""));
        if (b) { b.click(); return true; }
        return false;
      });
      if (ok) break;
      await sleep(1500);
    }
    for (let i = 0; i < 10; i++) { if (!page.url().includes("/login")) break; await sleep(1500); }
    await page.goto(url("/vocab?mode=audio"), { waitUntil: "domcontentloaded" });
    await sleep(2500);
  }
  // 等水合
  await sleep(2500);
};

/* 桌面：故事面板（含生成完成 + 播放态） */
const desk = await browser.newPage();
await desk.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await login(desk);
await shot(desk, "desktop-audio-tabs");
await desk.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /故事串联/.test(x.textContent ?? "")); b?.click(); });
await sleep(9000);
await shot(desk, "desktop-story");
await desk.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /听故事/.test(x.textContent ?? "")); b?.click(); });
for (let i = 0; i < 25; i++) {
  await sleep(2000);
  const d = await desk.evaluate(() => { const a = document.querySelector("audio"); return a?.duration ?? 0; });
  if (d > 5) break;
}
await sleep(1500);
await shot(desk, "desktop-story-playing");

/* 桌面：词书 */
await desk.goto(url("/vocab?tab=books"), { waitUntil: "domcontentloaded" });
await sleep(6000);
await shot(desk, "desktop-books");

/* 桌面：背单词 */
await desk.goto(url("/vocab?mode=review"), { waitUntil: "domcontentloaded" });
await sleep(5000);
await desk.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /开始背词/.test(x.textContent ?? "")); b?.click(); });
await sleep(5000);
await shot(desk, "desktop-review");

/* 移动端：故事面板 + 词书 */
const mob = await browser.newPage();
await mob.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await login(mob);
await mob.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /故事串联/.test(x.textContent ?? "")); b?.click(); });
await sleep(9000);
await shot(mob, "mobile-story");
await mob.goto(url("/vocab?tab=books"), { waitUntil: "domcontentloaded" });
await sleep(6000);
await shot(mob, "mobile-books");

await browser.close();
console.log("done");
