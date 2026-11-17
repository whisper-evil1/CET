/**
 * 单独验证写作 / 翻译的「AI 批改」是否真的产出结果。
 *
 * 前面的全题型脚本只检查了「没报错」，不够 —— 这里等足时间并抓取
 * 批改区域的实际文本增长，同时记录 /api/ai/grade 的响应。
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = path.resolve("shots/ai-fix");
const url = (p) => `${BASE}${p}`;

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
await page.setViewport({ width: 1440, height: 950 });

const api = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/ai/")) {
    let body = "";
    try {
      body = (await r.text()).slice(0, 200);
    } catch {
      /* 流式响应可能取不到 */
    }
    api.push(`${r.status()} ${new URL(r.url()).pathname} ${body.replace(/\n/g, " ")}`);
  }
});

await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  },
  { timeout: 120_000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("演示账号"))?.click();
});
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 120_000 }).catch(() => {});
await sleep(1200);

await page.goto(url("/practice/cet4-2026-06-s1"), { waitUntil: "domcontentloaded", timeout: 120_000 });
await sleep(6000);

for (const tab of ["写作", "翻译"]) {
  await page.evaluate((label) => {
    [...document.querySelectorAll("nav button")].find((x) => (x.textContent ?? "").trim() === label)?.click();
  }, tab);
  await sleep(3000);

  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(
      ta,
      "Organic food is expensive but many people still buy it. In my opinion, the higher price is worth paying because food safety matters more than money.",
    );
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(800);

  // 精确点「AI 批改」这一颗按钮
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /AI 批改/.test(x.textContent ?? ""));
    if (!b) return null;
    b.scrollIntoView({ block: "center" });
    b.click();
    return (b.textContent ?? "").trim();
  });
  console.log(`\n[${tab}] 点击: ${clicked}`);

  // 等批改出字（最多 30 秒，看文本是否变化）
  const before = await page.evaluate(() => document.body.innerText.length);
  let grew = false;
  for (let i = 0; i < 15; i += 1) {
    await sleep(2000);
    const now = await page.evaluate(() => document.body.innerText.length);
    if (now > before + 40) {
      grew = true;
      break;
    }
  }
  const tail = await page.evaluate(() => document.body.innerText.slice(-700).replace(/\n+/g, " | "));
  console.log(`   文本增长: ${grew}`);
  console.log(`   末尾: ${tail.slice(-260)}`);
  console.log(`   /api/ai 响应: ${api.slice(-3).join(" ‖ ").slice(0, 240)}`);
  await page.screenshot({ path: `${OUT}/strict-${tab}.png` });
}

await browser.close();
