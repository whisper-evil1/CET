/**
 * 线上验收（稳健版）：适配各题型交卷→解析的流程差异。
 *
 * 关键：问 AI / 笔记按钮只在「解析展开（open）」后渲染。
 * 各题型流程：
 *   - 阅读（选词/长篇/仔细）：交卷判分 → 看解析（展开）→ 问 AI / 笔记
 *   - 听力（选词填空式）：交卷判分 → 看解析（展开）→ 问 AI / 笔记
 * 统一策略：先点「交卷判分/重新交卷」保证 submitted，再点「看解析/直接看解析」展开，
 * 然后等待「问 AI」按钮出现再点。每步都做兜底重试。
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const HOME = "https://cet-reading-82947.app.workbuddy.host";
const SC = "XRRLK7HGZP";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

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
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const evalClick = (re) =>
  page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent ?? "").trim()));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, re.source);

const waitForBtn = async (re, timeout = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const found = await page.evaluate((pattern) => {
      const rx = new RegExp(pattern);
      return [...document.querySelectorAll("button")].some((x) => rx.test((x.textContent ?? "").trim()));
    }, re.source);
    if (found) return true;
    await sleep(600);
  }
  return false;
};

/* 登录 */
await page.goto(`${HOME}/login?sharecode=${SC}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  },
  { timeout: 120000 },
);
await page.evaluate(() =>
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("演示账号"))?.click(),
);
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 120000 }).catch(() => {});
await sleep(2000);

await page.goto(`${HOME}/practice/cet4-2026-06-s1?sharecode=${SC}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await sleep(7000);

const tabNames = await page.evaluate(() =>
  [...document.querySelectorAll("nav button")].map((b) => (b.textContent ?? "").trim()),
);
const readingTabs = tabNames.filter((t) => /选词填空|长篇|仔细阅读|听力/.test(t));

for (const tab of readingTabs) {
  await page.evaluate((label) => {
    [...document.querySelectorAll("nav button")].find((x) => (x.textContent ?? "").trim() === label)?.click();
  }, tab);
  await sleep(3500);

  // 作答（有 A-D 选项就点第一个；选词填空式没有独立选项按钮则跳过）
  await page.evaluate(() => {
    const o = [...document.querySelectorAll("button")].find((b) => /^[A-D]$/.test((b.textContent ?? "").trim()));
    o?.click();
  });
  await sleep(900);

  // 交卷判分（保证 submitted）
  await evalClick(/交卷判分|重新交卷|提交全部/);
  await sleep(4500);

  // 展开解析：优先点「看解析」，点不到就点「直接看解析」，再点不到就点「收起解析」（已展开）
  const opened = (await evalClick(/^看解析$/)) || (await evalClick(/直接看解析/));
  await sleep(3000);

  // 等「问 AI」按钮出现（open 展开后才会渲染）
  const aiBtn = await waitForBtn(/问 AI/);
  const aiClicked = aiBtn && (await evalClick(/问 AI/));
  await sleep(3000);
  const ai = await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("问 AI"));
    return { exists: Boolean(a), text: (a?.textContent ?? "").slice(0, 50) };
  });
  check(`${tab}｜问 AI 能打开`, aiClicked && ai.exists, ai.text.slice(0, 40));

  // 关闭抽屉
  await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("问 AI"));
    a?.querySelector('button[aria-label="关闭"]')?.click();
  });
  await sleep(1500);

  // 笔记（需要解析仍在 open 状态；若被关掉则重新展开）
  const noteBtn = (await waitForBtn(/笔记/, 5000)) || ((await evalClick(/直接看解析|看解析/)), await waitForBtn(/笔记/, 8000));
  const noteClicked = noteBtn && (await evalClick(/笔记/));
  await sleep(2500);
  const note = await page.evaluate(() => {
    const aside = [...document.querySelectorAll("aside")].map((a) => (a.textContent ?? "").slice(0, 40));
    return { aside };
  });
  check(`${tab}｜笔记能打开`, noteClicked && note.aside.length > 0, note.aside.join(" ‖ ").slice(0, 50));

  await page.evaluate(() => {
    const a = [...document.querySelectorAll("aside")].find((el) => /笔记|公开|仅自己可见/.test(el.textContent ?? ""));
    a?.querySelector('button[aria-label="关闭"]')?.click();
  });
  await sleep(1200);
}

/* 写作 / 翻译批改回归 */
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
  const graded = await evalClick(/让 AI 批改|开始批改|批改/);
  await sleep(10000);
  const gradeText = await page.evaluate(() => document.body.innerText.slice(-600).replace(/\n+/g, " | "));
  check(`${tab}｜AI 批改有输出`, typed && graded && !/批改失败|请先写下/.test(gradeText), gradeText.slice(-80));
}

check("全程无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
