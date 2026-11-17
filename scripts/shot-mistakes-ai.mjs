/**
 * 截图留档：错题页 + AI 薄弱点分析面板（移动端 390px / 桌面端 1280px）。
 * 用法：BASE_URL=... USER_ID=... node scripts/shot-mistakes-ai.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userId = (process.env.USER_ID || "").trim();
if (!userId) {
  console.error("需要 USER_ID");
  process.exit(1);
}
const OUT = ".build/shot";
mkdirSync(OUT, { recursive: true });

const token = execFileSync("node", ["scripts/dev-session.mjs", userId], { cwd: process.cwd(), encoding: "utf8" }).trim();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const p0 = await browser.newPage();
  await p0.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
  await p0.close();

  for (const [name, vp] of [
    ["mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }],
    ["desktop", { width: 1280, height: 900, deviceScaleFactor: 2 }],
  ]) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`${BASE}/mistakes?sharecode=SHOT123`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("让 AI 分析"));
      if (b) b.click();
    });
    // 等流式结束
    for (let i = 0; i < 120; i++) {
      const done = await page.evaluate(() => {
        const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
          (d.textContent || "").includes("AI 薄弱点分析"),
        );
        if (!card) return false;
        const btns = [...card.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
        return (card.textContent || "").length > 250 && !btns.includes("停止");
      });
      if (done) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
        (d.textContent || "").includes("AI 薄弱点分析"),
      );
      card?.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `${OUT}/mistakes-ai-${name}.png` });

    // 横向溢出检查
    const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name}: 横向溢出 ${of}px, JS 错误 ${errors.length}`);
    if (errors.length) console.log("  ", errors.slice(0, 4).join(" | "));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("截图已存到 .build/shot/");
