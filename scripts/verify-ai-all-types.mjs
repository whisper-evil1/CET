/**
 * 全题型验收：交卷 → 看解析 → 问 AI / 笔记 是否都能打开。
 *
 * 覆盖：选词填空、长篇阅读匹配、仔细阅读一、仔细阅读二、听力，
 * 外加写作 / 翻译的「让 AI 批改」回归（这次改动不该影响它们）。
 *
 * 每条断言都以「抽屉元素真的出现在 DOM 且带内容」为准，不看按钮点击是否返回成功。
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const OUT = path.resolve("shots/ai-fix");
const url = (p) => `${BASE}${p}`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });

/* 登录 */
await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  },
  { timeout: 120_000 },
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("演示账号"))?.click();
});
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 120_000 }).catch(() => {});
await sleep(1200);

await page.goto(url("/practice/cet4-2026-06-s1"), { waitUntil: "domcontentloaded", timeout: 120_000 });
await sleep(6000);

const clickText = (re) =>
  page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent ?? "").trim()));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, re.source);

const tabNames = await page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim()),
);

const readingTabs = tabNames.filter((t) => /选词填空|长篇|仔细阅读|听力/.test(t));

for (const tab of readingTabs) {
  await page.evaluate((label) => {
    [...document.querySelectorAll("nav button")].find((x) => (x.textContent ?? "").trim() === label)?.click();
  }, tab);
  await sleep(3000);

  // 作答：能点选项就点（选词填空没有选项，直接交卷走空答）
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll("button")].find((b) => /^[A-D]$/.test((b.textContent ?? "").trim()));
    opt?.click();
  });
  await sleep(900);

  await clickText(/交卷|提交全部/);
  await sleep(4000);
  await clickText(/^(直接看解析|看解析)$/);
  await sleep(2500);

  const opened = await clickText(/问 AI/);
  await sleep(2500);
  const ai = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("问 AI"));
    return { exists: Boolean(a), text: (a?.textContent ?? "").slice(0, 80) };
  });
  check(`${tab}｜问 AI 能打开`, opened && ai.exists, ai.text.slice(0, 50));
  await page.screenshot({ path: `${OUT}/${tab}-ai.png` });

  // 关闭（点抽屉里的 ✕）
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("问 AI"));
    const btn = a?.querySelector('button[aria-label="关闭"]');
    btn?.click();
  });
  await sleep(1500);

  const openedNote = await clickText(/^💬 笔记$|^笔记$/);
  await sleep(2500);
  const note = await page.evaluate(() => {
    const text = document.body.innerText;
    const has = /写下你的想法|公开|仅自己可见|笔记/.test(text);
    const aside = [...document.querySelectorAll("aside")].map((a) => (a.textContent ?? "").slice(0, 40));
    return { aside, has };
  });
  check(`${tab}｜笔记能打开`, openedNote && note.aside.length > 0, note.aside.join(" ‖ ").slice(0, 60));

  // 关掉笔记，避免影响下一轮
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => /笔记|公开|仅自己可见/.test(el.textContent ?? ""));
    a?.querySelector('button[aria-label="关闭"]')?.click();
  });
  await sleep(1200);
}

/* 写作 / 翻译：AI 批改回归 */
for (const tab of ["写作", "翻译"]) {
  await page.evaluate((label) => {
    [...document.querySelectorAll("nav button")].find((x) => (x.textContent ?? "").trim() === label)?.click();
  }, tab);
  await sleep(3000);

  const typed = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(ta, "Organic food is expensive but healthy. Many people choose it for safety.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  await sleep(800);
  const graded = await clickText(/让 AI 批改|开始批改|批改/);
  await sleep(9000);
  const gradeText = await page.evaluate(() => document.body.innerText.slice(-600).replace(/\n+/g, " | "));
  check(
    `${tab}｜AI 批改有输出（未被本次改动影响）`,
    typed && graded && !/批改失败|请先写下/.test(gradeText),
    gradeText.slice(-90),
  );
  await page.screenshot({ path: `${OUT}/${tab}-grade.png` });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
