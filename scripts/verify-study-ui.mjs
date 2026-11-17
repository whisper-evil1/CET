/**
 * 「背单词」版块与词卡存书的浏览器验收。
 *
 * 走真人路径：登录表单 → /study 建书开背 → 练习页点词 → 存到指定词书。
 * 只有 UI 层才暴露的问题（水合、按钮被挡、点了没反应）在这里才看得见。
 *
 * 用法：node scripts/verify-study-ui.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = (process.argv[2] ?? process.env.CHECK_BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EMAIL = process.env.CHECK_EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.CHECK_PASSWORD ?? "demo1234";
const SHOTS = "shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

/** 等页面上真的出现某个元素，超时就返回 false（线上/本地都有过渡页，不能靠 networkidle） */
async function waitFor(page, fn, label, timeout = 15000, ...args) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn, ...args).catch(() => false)) return true;
    await sleep(300);
  }
  console.log(`  ! 等不到：${label}`);
  return false;
}

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
// window.confirm 一律同意（删验收书用）
page.on("dialog", (d) => void d.accept());

/* ---------- 1. 登录 ---------- */
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await waitFor(page, () => Boolean(document.querySelector("#login-email")), "登录表单");
await page.type("#login-email", EMAIL, { delay: 20 });
await page.type("#login-password", PASSWORD, { delay: 20 });
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null),
  page.click('button[type="submit"]'),
]);
await sleep(1200);
check("登录后离开登录页", !page.url().includes("/login"), page.url());

/* ---------- 2. /study 书架 ---------- */
await page.goto(`${BASE}/study`, { waitUntil: "domcontentloaded" });
const shelfOk = await waitFor(page, () => document.body.innerText.includes("背单词"), "书架标题");
await waitFor(page, () => document.querySelectorAll("article").length >= 3, "书架卡片");
const headings = await page.evaluate(() =>
  [...document.querySelectorAll("article h2")].map((h) => h.textContent?.trim() ?? ""),
);
check("/study 渲染书架", shelfOk && headings.length >= 3, headings.join(" / "));
check(
  "书架里有阅读生词与四级高频",
  headings.some((h) => h.includes("阅读生词")) && headings.some((h) => h.includes("四级")),
);
check("导航里出现「背单词」入口", await page.evaluate(() => Boolean([...document.querySelectorAll("nav a")].find((a) => a.textContent?.trim() === "背单词"))));

/* ---------- 3. 新建词书 ---------- */
const stamp = String(Date.now()).slice(-5);
const bookName = `UI验收${stamp}`;
const created = await page.evaluate(async (name) => {
  const input = [...document.querySelectorAll("input")].find((i) => i.placeholder === "词书名字");
  if (!input) return "no-input";
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, name);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  const btn = [...document.querySelectorAll("button")].find((b) => /^(新建|建)$/.test(b.textContent?.trim() ?? ""));
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
}, bookName);
check("新建词书按钮可点", created === "clicked", created);
const bookAppeared = await waitFor(
  page,
  (name) => [...document.querySelectorAll("article h2")].some((h) => h.textContent?.includes(name)),
  "新词书卡片",
  8000,
  bookName,
);
const shelfNames = await page.evaluate(() =>
  [...document.querySelectorAll("article h2")].map((h) => h.textContent?.trim() ?? ""),
);
check("新词书出现在书架", bookAppeared, shelfNames.join(" / "));

/* ---------- 4. 从四级高频复制一批，然后开背 ---------- */
await page.evaluate(() => {
  const card = [...document.querySelectorAll("article")].find((a) =>
    a.textContent?.includes("四级高频"),
  );
  const btn = card ? [...card.querySelectorAll("button")].find((b) => b.textContent?.includes("开始背")) : null;
  btn?.click();
});
const studyStarted = await waitFor(page, () => document.body.innerText.includes("空格看释义"), "背单词会话");
check("点「开始背」进入背单词", studyStarted);

const firstWord = await page.evaluate(() => {
  const el = document.querySelector("section p.font-serif");
  return el?.textContent?.trim() ?? "";
});
check("卡片给了词形", Boolean(firstWord), firstWord);

const revealed = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "想不起来");
  if (!btn) return "no-button";
  btn.click();
  await new Promise((r) => setTimeout(r, 250));
  return document.body.innerText.includes("记住了") ? "ok" : "no-defs";
});
check("点「想不起来」给出释义与后续按钮", revealed === "ok", revealed);
await page.screenshot({ path: `${SHOTS}/study-session.png` });

// 退出会话
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("退出"));
  btn?.click();
});
await waitFor(page, () => document.body.innerText.includes("新建一本词书"), "回到书架");
await page.screenshot({ path: `${SHOTS}/study-shelf.png` });

/* ---------- 5. 练习页：点词 → 存到指定词书 ---------- */
await page.goto(`${BASE}/practice/paper-cet4-2024-12`, { waitUntil: "domcontentloaded" });
const hasWords = await waitFor(page, () => document.querySelectorAll("[data-word]").length > 0, "可点单词", 20000);
check("练习页有可点单词", hasWords);

await page.evaluate(() => document.querySelector("[data-word]")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
await page.evaluate(() => document.querySelector("[data-word]")?.click());
await waitFor(page, () => Boolean(document.querySelector('[role="dialog"]')), "词卡浮层");

const chooserOpened = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) =>
    b.textContent?.includes("存到词书"),
  );
  if (!btn) return "no-button";
  btn.click();
  await new Promise((r) => setTimeout(r, 900));
  return document.querySelector('[role="dialog"]')?.innerText.includes("存到哪本词书") ? "ok" : "no-panel";
});
check("词卡里有「存到词书」并弹出选择", chooserOpened === "ok", chooserOpened);
await page.screenshot({ path: `${SHOTS}/wordcard-picker-open.png` });

const saved = await page.evaluate(async (name) => {
  const dialog = document.querySelector('[role="dialog"]');
  const row = [...(dialog?.querySelectorAll("li button") ?? [])].find((b) => b.textContent?.includes(name));
  if (!row) return "no-book";
  row.click();
  await new Promise((r) => setTimeout(r, 900));
  return dialog.innerText.includes("已存到") ? "ok" : "not-saved";
}, bookName);
check("选中的那本词书收到词", saved === "ok", saved);
await page.screenshot({ path: `${SHOTS}/wordcard-book-picker.png` });

/* ---------- 6. 清掉验收书 ---------- */
await page.goto(`${BASE}/study`, { waitUntil: "domcontentloaded" });
await waitFor(page, () => document.querySelectorAll("article").length >= 3, "书架");
await page.evaluate(async (name) => {
  const card = [...document.querySelectorAll("article")].find((a) => a.textContent?.includes(name));
  const btn = card ? [...card.querySelectorAll("button")].find((b) => b.textContent?.trim() === "删除") : null;
  btn?.click();
}, bookName);
await sleep(1200);

const gone = await page.evaluate(
  (name) => ![...document.querySelectorAll("article h2")].some((h) => h.textContent?.includes(name)),
  bookName,
);
check("验收词书已删除", gone);

check("页面无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
