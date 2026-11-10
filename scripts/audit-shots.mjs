/**
 * 手机/桌面截图，用于人工判读「用起来是否方便」（字号、间距、可达性）。
 * 输出到 .build/audit/*.png
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = ".build/audit";
fs.mkdirSync(OUT, { recursive: true });

const userId = (process.env.USER_ID || "").trim();
const token = userId
  ? execFileSync("node", ["scripts/dev-session.mjs", userId], { cwd: process.cwd(), encoding: "utf8" }).trim()
  : "";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});
try {
  if (token) {
    try {
      await browser.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
    } catch {
      const p = await browser.newPage();
      await p.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
      await p.close();
    }
  }

  const shots = [
    { file: "m-home.png", route: "/", w: 390, h: 844, mobile: true, full: false },
    { file: "m-login.png", route: "/login", w: 390, h: 844, mobile: true, full: false },
    { file: "m-mistakes.png", route: "/mistakes", w: 390, h: 844, mobile: true, full: true },
    { file: "m-practice.png", route: "/practice/paper-cet4-2024-12", w: 390, h: 844, mobile: true, full: false },
    { file: "d-mistakes.png", route: "/mistakes", w: 1440, h: 900, mobile: false, full: false },
  ];
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, isMobile: s.mobile, deviceScaleFactor: 1 });
    await page.goto(`${BASE}${s.route}`, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/${s.file}`, fullPage: s.full });
    console.log("saved", `${OUT}/${s.file}`);
    await page.close();
  }
} finally {
  await browser.close();
}
