/**
 * 线上页面级验收：真的用浏览器登录进去看 /study 有没有渲染。
 *
 * 接口 200 不代表页面能看 —— 服务端返回的 HTML 里书架是客户端渲染的，
 * 只有真跑一遍 React 才知道有没有白屏 / 有没有 JS 报错。
 *
 * 线上特有的两个坑，脚本里都绕开了：
 *   1. 冷启动期间网关回过渡页（状态码也是 200）→ 每次导航都等目标元素，不认状态码；
 *   2. waitUntil: "networkidle2" 在线上永远等不到 → 只用 domcontentloaded + 元素等待。
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.LIVE_EMAIL ?? "live-study@qq.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "Live2026#study";
const SHOTS = "shots/live";
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) =>
  jsErrors.push(`${page.url().replace(BASE, "").split("?")[0]} :: ${String(e.message ?? e).slice(0, 160)}`),
);

/** 反复导航直到目标元素出现（线上过渡页会抢在前面） */
async function gotoWithElement(path, selector, label, tries = 8) {
  for (let i = 0; i < tries; i += 1) {
    // goto 本身也会超时（线上偶发慢），不能让它把整轮脚本炸掉
    try {
      await page.goto(`${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SC}&_=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
    } catch (e) {
      console.log(`   （${label} 第 ${i + 1} 次导航超时：${String(e.message).slice(0, 60)}）`);
      await sleep(3000);
      continue;
    }
    try {
      await page.waitForSelector(selector, { timeout: 8000 });
      return true;
    } catch {
      await sleep(4000);
    }
  }
  console.log(`   （${label} 等不到 ${selector}）`);
  return false;
}

/* 1. 登录页 —— 等按钮从 disabled 变可点，否则点下去是空转 */
const loginReady = await gotoWithElement("/login", "button[type=submit]:not([disabled])", "登录页");
check("线上登录页可交互", loginReady, page.url().slice(0, 90));

if (loginReady) {
  await page.click("#login-email", { clickCount: 3 });
  await page.type("#login-email", EMAIL);
  await page.click("#login-password", { clickCount: 3 });
  await page.type("#login-password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    page.click("button[type=submit]"),
  ]);
  // 登录是异步跳转，等 URL 真的离开登录页，不靠固定 sleep
  for (let i = 0; i < 20 && page.url().includes("/login"); i += 1) await sleep(800);
  const afterLogin = await page.evaluate(() => document.body.innerText.slice(0, 160));
  check(
    "登录后离开登录页",
    !page.url().includes("/login"),
    page.url().replace(BASE, "").slice(0, 60) + (page.url().includes("/login") ? ` / ${afterLogin.replace(/\n+/g, " ").slice(0, 60)}` : ""),
  );

  /* 2. 背单词书架 */
  const shelfReady = await gotoWithElement("/study", "article", "背单词页");
  const onShelf = !page.url().includes("/login");
  const shelfText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  const heading = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? "");
  check("/study 进了书架而不是被踢回登录", shelfReady && onShelf && heading === "背单词", `h1=${heading || "空"} url=${page.url().replace(BASE, "").slice(0, 40)}`);
  check(
    "书架列出三类书",
    /阅读生词/.test(shelfText) && /四级高频/.test(shelfText),
    [...shelfText.matchAll(/(阅读生词|四级高频|六级高频|我的词书)/g)].map((m) => m[1]).join(" "),
  );
  const cards = await page.evaluate(() => document.querySelectorAll("article").length);
  check("书架卡片有渲染", cards > 0, `${cards} 张`);
  await page.screenshot({ path: `${SHOTS}/study-shelf.png` });

  /* 3. 进一本有词的书开始背：0 词的书按钮是禁用的，必须挑可点的那个 */
  // 刚 hydrate 完时按钮的 onClick 可能还没挂上，点一次不一定有反应。
  // 所以：点一次 → 等 → 没反应再点一次（最多 3 次），既排除脚本时序问题，
  // 也不掩盖真实的产品缺陷（真挂不上，三次都不会有反应）。
  let picked = "";
  let inSession = false;
  for (let attempt = 1; attempt <= 3 && !inSession; attempt += 1) {
    const hit = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("article")];
      const target = cards.find((c) => /四级高频/.test(c.textContent ?? ""));
      const btn = [...(target ?? document).querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "开始背" && !b.hasAttribute("disabled"),
      );
      if (btn instanceof HTMLElement) {
        btn.click();
        return target?.querySelector("h2")?.textContent?.trim() ?? "";
      }
      return "";
    });
    if (hit) picked = hit;
    for (let i = 0; i < 12 && !inSession; i += 1) {
      await sleep(600);
      inSession = await page.evaluate(() =>
        [...document.querySelectorAll("button")].some((b) => /想不起来|记住了/.test(b.textContent ?? "")),
      );
    }
    if (!inSession) console.log(`   （第 ${attempt} 次点「开始背」没进作答态，重试）`);
  }
  const sessionText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " ").slice(0, 90));
  check("能进入背词作答态", Boolean(picked) && inSession, `${picked || "没找到可点的书"} / ${sessionText}`);
  await page.screenshot({ path: `${SHOTS}/study-run.png` });

  /* 4. 首页文案 */
  const homeReady = await gotoWithElement("/", "h1", "首页");
  const homeText = homeReady ? await page.evaluate(() => document.body.innerText) : "";
  check("首页已换成新文案", /三条学习线/.test(homeText), (homeText.match(/三条学习线|学习三步/) ?? ["未找到"])[0]);
  await page.screenshot({ path: `${SHOTS}/home.png` });
}

check("页面无 JS 报错", jsErrors.length === 0, jsErrors[0] ?? "");

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上页面验收 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
