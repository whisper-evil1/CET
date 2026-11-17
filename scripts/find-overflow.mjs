/**
 * 找出页面里超出视口宽度的元素（横向溢出的真凶）。
 * 用法：BASE_URL=... PATH=/mistakes WIDTH=320 USER_ID=... node scripts/find-overflow.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const ROUTE = process.env.PATH_TO_CHECK || "/mistakes";
const WIDTH = Number(process.env.WIDTH || 320);
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userId = (process.env.USER_ID || "").trim();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: WIDTH, height: 800, isMobile: WIDTH < 768, hasTouch: WIDTH < 768 },
});
try {
  if (userId) {
    const token = execFileSync("node", ["scripts/dev-session.mjs", userId], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    const p0 = await browser.newPage();
    await p0.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
    await p0.close();
  }
  const page = await browser.newPage();
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 800));

  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 1 || r.left < -1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 90),
          text: (el.textContent || "").replace(/\s+/g, " ").slice(0, 40),
          left: Math.round(r.left),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    });
    return { vw, scrollW: document.documentElement.scrollWidth, out: out.slice(0, 25) };
  });
  console.log(`视口 ${info.vw}，文档 scrollWidth ${info.scrollW}`);
  for (const o of info.out) {
    console.log(`  ${o.tag} [${o.cls}] left=${o.left} right=${o.right} w=${o.w}  «${o.text}»`);
  }
  if (!info.out.length) console.log("  没有元素越界");
} finally {
  await browser.close();
}
