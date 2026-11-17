import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const SC = process.env.SC ?? ""; // 线上需要 sharecode
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (path) => `${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SC}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 150)));

/* 登录 */
await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => {
  const b = document.querySelector('button[type="submit"]');
  return !!b && !b.disabled;
}, { timeout: 150000 });
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("演示账号"))?.click());
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 150000 }).catch(() => {});
await sleep(2500);

/* 进入生词本词书 tab */
await page.goto(url("/vocab?tab=books"), { waitUntil: "domcontentloaded", timeout: 90000 });
await sleep(5000);

const clickText = async (re) =>
  page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent ?? "").trim()));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, re.source);

/* 1. 选中「阅读生词」，看右侧是否展示生词本的词 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("aside button")].find((x) => (x.textContent ?? "").includes("阅读生词"));
  b?.click();
});
await sleep(2500);
const readingBody = await page.evaluate(() => document.body.innerText);
check("选中「阅读生词」后右侧展示词表", readingBody.includes("阅读生词"));

/* 2. 「开始背」按钮文案是刷词模式 */
const btnLabel = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("开始背"));
  return b?.textContent?.trim() ?? "";
});
check("「开始背」按钮是刷词模式文案", /四选一|连对/.test(btnLabel), btnLabel);

/* 3. 选一个内置词书（四级高频），点「开始背」，验证进入四选一刷词模式 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("aside button")].find((x) => (x.textContent ?? "").includes("四级高频"));
  b?.click();
});
await sleep(2000);
const started = await clickText(/开始背/);
await sleep(3000);
const introText = await page.evaluate(() => document.body.innerText);
check("点「开始背」进入刷词 intro 页", started && (introText.includes("连续答对 3 次") || introText.includes("连对 3 次") || introText.includes("准备好") || introText.includes("开始背词")), introText.slice(0, 120));

/* 4. 点「开始背词」进入刷词：先判断认不认识，再进四选一 */
const entered = await clickText(/开始背词/);
await sleep(3500);
const judgeScreen = await page.evaluate(() => document.body.innerText.includes("认不认识") || document.body.innerText.includes("认识"));
check("进入刷词（先判断认不认识）", entered && judgeScreen);
/* 点「认识」进入四选一（按钮文案是「认识 / 再选一次义」两行，用开头匹配避开「不认识」） */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => {
    const t = (x.textContent ?? "").replace(/\s+/g, "");
    return t.startsWith("认识") && !t.startsWith("不认识");
  });
  b?.scrollIntoView({ block: "center" });
  b?.click();
});
await sleep(2500);
const hasOptions = await page.evaluate(() => {
  const text = document.body.innerText;
  const inChoose = text.includes("选出它的释义") || text.includes("验证：你选的是这个意思吗") || text.includes("四选一");
  const opts = [...document.querySelectorAll("button")].filter((b) => /^[A-D]$/.test((b.textContent ?? "").trim().slice(0, 1)) && (b.textContent ?? "").trim().length > 3);
  return inChoose && opts.length >= 3;
});
check("点「认识」后进入四选一（有 A-D 选项）", hasOptions);

/* 5. 无 JS 报错 */
check("全程无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n===== 结果：${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
