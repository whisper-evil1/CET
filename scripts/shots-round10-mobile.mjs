/** 手机端快照：生词本底部三按钮是否放得下、背单词模式在 390px 宽下是否可读。 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round10";

const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
const line = raw.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="));
const secret = line ? line.split("=")[1].trim().replace(/^["']|["']$/g, "") : "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });

await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/m-vocab.png` });

const bar = await page.evaluate(() => {
  const fixed = document.querySelector(".fixed.inset-x-0.bottom-0");
  if (!fixed) return null;
  const labels = Array.from(fixed.querySelectorAll("button")).map((b) => b.textContent?.trim());
  const rect = fixed.getBoundingClientRect();
  const overflow = fixed.scrollWidth > fixed.clientWidth + 1;
  return { labels, overflow, width: Math.round(rect.width) };
});
console.log("底栏：", JSON.stringify(bar));

await page.goto(`${BASE}/vocab?mode=review`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
// 关掉可能弹出的签到弹窗，避免遮住内容
await page.evaluate(() => {
  const close = Array.from(document.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === "关闭" || b.textContent?.trim() === "✕",
  );
  close?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/m-review.png` });

await browser.close();
console.log("ok");
