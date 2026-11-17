/**
 * 临时探针：看 AI 薄弱点分析面板实际走哪条链路（浏览器直连云 / 服务端兜底 / 本地数据）。
 * 用法：BASE_URL=... USER_ID=<有错题的用户> node scripts/probe-panel.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userId = (process.env.USER_ID || "").trim();
if (!userId) {
  console.error("需要 USER_ID");
  process.exit(1);
}
const token = execFileSync("node", ["scripts/dev-session.mjs", userId], {
  cwd: process.cwd(),
  encoding: "utf8",
}).trim();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const p0 = await browser.newPage();
  await p0.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
  await p0.close();

  const page = await browser.newPage();
  const reqs = [];
  page.on("request", (r) => reqs.push(`${r.method()} ${r.url()}`));
  page.on("response", (r) => {
    const u = r.url();
    if (!/api|llm|cloud/.test(u)) return;
    const h = r.headers();
    const tag = [h["x-ai-mode"], h["x-ai-model"]].filter(Boolean).join("/");
    if (tag) console.log(`RESP ${r.status()} ${u} → X-AI-Mode=${tag}`);
  });

  await page.goto(`${BASE}/mistakes?sharecode=ABC123`, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 800));
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("让 AI 分析"));
    if (b) {
      b.click();
      return true;
    }
    return false;
  });
  console.log("clicked:", clicked);
  await new Promise((r) => setTimeout(r, 9000));

  const info = await page.evaluate(() => {
    const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
      (d.textContent || "").includes("AI 薄弱点分析"),
    );
    return {
      text: card ? (card.textContent || "").replace(/\s+/g, " ") : null,
      strong: card ? card.querySelectorAll("strong").length : 0,
      rawStar: card ? (card.textContent || "").includes("**") : null,
    };
  });

  console.log("\n=== 相关请求 ===");
  console.log(reqs.filter((u) => /api|llm|cloud/.test(u)).join("\n"));
  console.log("\n=== strong 数 ===", info.strong, "rawStar=", info.rawStar);
  console.log("\n=== 面板正文 ===");
  console.log(info.text ? info.text.slice(0, 900) : "未找到面板");
} finally {
  await browser.close();
}
