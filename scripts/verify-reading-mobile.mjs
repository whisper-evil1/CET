/**
 * 手机端（390×844）阅读答题模板走查：三种板块各截一张，验证 Tab 切换与交卷按钮可达。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
const PAPER = process.env.PAPER ?? "cet4-2026-06-s1";
const OUT = process.env.SHOT_DIR ?? "./shots/reading-mobile";
const EXECUTABLE =
  process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

const clickText = async (text) => {
  const handle = await page.evaluateHandle(
    (t) => [...document.querySelectorAll("button")].find((el) => (el.textContent ?? "").includes(t)) ?? null,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`找不到按钮：${text}`);
  await el.click();
  await sleep(320);
};

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', "demo@cet.local");
  await page.type('input[type="password"]', "demo1234");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(500);

  await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/m1-banked-article.png` });

  await clickText("题目");
  await page.screenshot({ path: `${OUT}/m2-banked-question.png` });

  // 点一个单词填进当前空，验证手机端交互
  const word = await page.$("ul.grid button");
  if (word) await word.click();
  await sleep(300);
  await page.screenshot({ path: `${OUT}/m3-banked-picked.png` });

  const submitVisible = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((b) => /交卷/.test(b.textContent ?? ""));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  console.log(submitVisible ? "  ✓ 手机端交卷按钮在首屏可见" : "  ✗ 交卷按钮不可见");

  await clickText("长篇阅读匹配");
  await page.screenshot({ path: `${OUT}/m4-matching.png` });
  await clickText("仔细阅读一");
  await page.screenshot({ path: `${OUT}/m5-choice.png` });

  // 回到文章 Tab 看内联空号
  await clickText("文章");
  await page.screenshot({ path: `${OUT}/m6-article.png` });

  console.log(errors.length ? `  ✗ 页面异常：${errors[0]}` : "  ✓ 无页面异常");
} catch (error) {
  console.log(`  ✗ ${error.message}`);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
