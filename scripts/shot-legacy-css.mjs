/**
 * 老内核兜底样式的视觉对照：同一页面渲染两次，一次正常、一次强制打上 data-css-fallback。
 * 用法：node scripts/shot-legacy-css.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:3101";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
  defaultViewport: { width: 414, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1200);

// 正常渲染
await page.screenshot({ path: "shot-modern.png", fullPage: true });

// 模拟不支持 @layer 的内核
await page.evaluate(() => document.documentElement.setAttribute("data-css-fallback", "1"));
await sleep(500);
await page.screenshot({ path: "shot-fallback.png", fullPage: true });

// 记录兜底样式是否真的命中
const applied = await page.evaluate(() => {
  const header = document.querySelector("header");
  const nav = document.querySelector("nav");
  const h1 = document.querySelector("h1");
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    htmlAttr: document.documentElement.getAttribute("data-css-fallback"),
    headerDisplay: cs(header)?.display,
    headerBorder: cs(header)?.borderBottomWidth,
    navDisplay: cs(nav)?.display,
    h1Size: cs(h1)?.fontSize,
    bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 40),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    linkDecoration: (() => {
      const a = document.querySelector("nav a");
      return a ? getComputedStyle(a).textDecorationLine : null;
    })(),
    linkDisplay: (() => {
      const a = document.querySelector("nav a");
      return a ? getComputedStyle(a).display : null;
    })(),
  };
});

console.log(JSON.stringify(applied, null, 2));
await browser.close();
