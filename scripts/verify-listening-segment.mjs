/**
 * 本地验收「听力一段一页」。
 *
 * 为什么判定要看这三个点：
 *   1. 右栏底部是「交本段」—— 只有「一段里有多题」才需要按段交；
 *      上一版是逐题一页，底部必然是「下一题」。
 *   2. 同一屏能数到 ≥2 组选项（[role=radiogroup]）—— 逐题一页时一屏只有一组。
 *   3. 点「下一段 →」后，页面文本确实变了，且段号 +1 —— 证明翻的是「段」不是「题」。
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.PASSWORD ?? "demo1234";
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";
const SHOTS = "shots";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("button[type=submit]:not([disabled])", { timeout: 20000 });
await page.type("#login-email", EMAIL);
await page.type("#login-password", PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
  page.click("button[type=submit]"),
]);
for (let i = 0; i < 20 && page.url().includes("/login"); i += 1) await sleep(600);
check("本地登录成功", !page.url().includes("/login"), page.url().replace(BASE, ""));

await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav button", { timeout: 25000 });

/* 切到听力：找 nav 里文本正好是「听力」的按钮，点完等选项组出现 */
let switched = false;
for (let i = 0; i < 3 && !switched; i += 1) {
  const handles = await page.$$("nav button");
  for (const h of handles) {
    const t = await h.evaluate((e) => (e.textContent ?? "").trim());
    if (t === "听力") {
      await h.click();
      break;
    }
  }
  for (let k = 0; k < 15 && !switched; k += 1) {
    await sleep(600);
    switched = await page.evaluate(() => document.querySelectorAll('[role="radiogroup"]').length > 0);
  }
}
check("能切到听力部分", switched, switched ? "已切到" : "没切过去");

if (switched) {
  const pane = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    const txt = document.body.innerText;
    return {
      groups: document.querySelectorAll('[role="radiogroup"]').length,
      radios: document.querySelectorAll('[role="radio"]').length,
      hasSubmitSegment: btns.some((t) => /交本段/.test(t)),
      hasNextSegment: btns.some((t) => /下一段/.test(t)),
      hasNextQuestion: btns.some((t) => /下一题/.test(t)),
      segment: (txt.match(/第\s*\d+\s*\/\s*\d+\s*段/) ?? [""])[0],
      heading: txt.replace(/\s+/g, " ").slice(0, 120),
    };
  });

  check("右栏按段提交（出现「交本段」）", pane.hasSubmitSegment, `groups=${pane.groups} radios=${pane.radios}`);
  check("同一屏 ≥2 组选择题（不是逐题一页）", pane.groups >= 2, `${pane.groups} 组 / ${pane.radios} 个选项`);
  check("给的是「下一段」而不是「下一题」", pane.hasNextSegment && !pane.hasNextQuestion, `下一段=${pane.hasNextSegment} 下一题=${pane.hasNextQuestion}`);
  check("顶栏显示「第 N/M 段」", /\d+\s*\/\s*\d+\s*段/.test(pane.segment), pane.segment || "未显示");

  await page.screenshot({ path: `${SHOTS}/listening-segment-1.png` });

  const beforeSeg = pane.segment;
  const beforeText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500));
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /下一段/.test(x.textContent ?? ""));
    if (b instanceof HTMLElement) b.click();
  });
  await sleep(1800);
  const after = await page.evaluate(() => ({
    segment: (document.body.innerText.match(/第\s*\d+\s*\/\s*\d+\s*段/) ?? [""])[0],
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
    groups: document.querySelectorAll('[role="radiogroup"]').length,
  }));
  check("点「下一段」段号 +1", beforeSeg !== after.segment && Boolean(after.segment), `${beforeSeg} → ${after.segment}`);
  check("下一段仍是同段多题", after.groups >= 2, `${after.groups} 组`);
  check("下一段内容确实换了", beforeText !== after.text, "");

  await page.screenshot({ path: `${SHOTS}/listening-segment-2.png` });
}

check("页面无 JS 报错", errors.length === 0, errors[0] ?? "");

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 听力按段验收 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
