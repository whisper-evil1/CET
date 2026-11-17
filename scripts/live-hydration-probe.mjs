/**
 * 线上 hydration 探针：逐页收集 pageerror/console.error，
 * 定位 React #418 出现在哪个页面、哪条消息。支持 E2E_EMAIL/E2E_PWD 登录后复测受限页。
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3300";
const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGES = [
  "/",
  "/cet4",
  "/arcade",
  "/arcade/blast",
  "/arcade/memory",
  "/arcade/spell",
  "/arcade/listen",
  "/login",
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });

// 登录态复测需要 E2E_EMAIL / E2E_PWD；未传时只测公开页，不内置任何账号凭据。
if (process.env.E2E_EMAIL && process.env.E2E_PWD) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const r = await loginViaUi(page, { email: process.env.E2E_EMAIL, pwd: process.env.E2E_PWD });
  console.log(`登录: ${r.ok ? "成功" : "失败"} -> ${page.url().slice(0, 60)}`);
} else {
  console.log("未传 E2E_EMAIL/E2E_PWD：仅测公开页（登录态复测传这两个环境变量即可）");
}

for (const p of PAGES) {
  const errs = [];
  const onPage = (e) => errs.push(`[pageerror] ${e.message.slice(0, 160)}`);
  const onConsole = (m) => {
    if (m.type() === "error") errs.push(`[console.error] ${m.text().slice(0, 160)}`);
  };
  page.on("pageerror", onPage);
  page.on("console", onConsole);
  try {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1200));
  } catch (e) {
    errs.push(`[goto] ${e.message.slice(0, 120)}`);
  }
  page.off("pageerror", onPage);
  page.off("console", onConsole);
  console.log(`${errs.length ? "FAIL" : " ok "} ${p}${errs.length ? `\n      ${errs.join("\n      ")}` : ""}`);
}
await browser.close();
