// 生词本排版验收（第十九轮）
//
// 针对用户反馈：「词书板块 UI 不对」「整个生词本在 web 端放大一点」。
//
// 核心回归项是「释义被压成竖排一个字一行」——这不是观感问题，是可测量的布局故障：
// 词表行原本用「固定 rem 宽 + flex-1」，固定宽不收缩，容器一窄就把释义列挤到
// 几十像素，中文按字换行。判据必须能区分「正常折行」和「逐字竖排」：
//   1. 释义列 clientWidth 足够（>=180px）——列没被挤没；
//   2. 释义实际渲染高度 <= 3.5 倍行高 —— 正常折行最多两三行，竖排会有十几行；
//   3. 行容器 scrollWidth <= clientWidth + 1 —— 没有横向溢出。
// 三条同时成立才判通过；只测其中一条会被「列宽够但内容溢出」骗过。
//
// 用法：BASE=http://127.0.0.1:3100 node scripts/verify-vocab-layout.mjs
//       线上：BASE=https://xxx SC=xxx node scripts/verify-vocab-layout.mjs
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const withSc = (p) => (SC ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}` : p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function waitHydrated() {
  for (let i = 0; i < 40; i++) {
    const h = await page
      .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
      .catch(() => false);
    if (h) return true;
    await sleep(1000);
  }
  return false;
}

async function login() {
  await page.goto(`${BASE}${withSc("/login")}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitHydrated();
  await sleep(1500);
  for (let i = 0; i < 5; i++) {
    const ok = await page
      .evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /演示账号/.test(x.textContent ?? ""));
        if (b) {
          b.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (ok) break;
    await sleep(1500);
  }
  for (let i = 0; i < 12; i++) {
    if (!page.url().includes("/login")) break;
    await sleep(1500);
  }
  return !page.url().includes("/login");
}

check("演示账号登录成功", await login());

/* ---------- 1. 词书页：容器宽度与两栏 ---------- */
await page.goto(`${BASE}${withSc("/vocab?tab=books")}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitHydrated();

// 书架加载是 SWR 异步：等到有卡片，再主动点开一本「有词」的书，
// 否则默认选中的可能是空的「阅读生词」，词表 0 行会把排版断言全带崩。
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => document.querySelectorAll("[data-wb-book]").length).catch(() => 0);
  if (n > 0) break;
  await sleep(1000);
}
await page.evaluate(() => {
  const books = [...document.querySelectorAll("[data-wb-book]")]
    .map((el) => ({ el, count: Number(el.getAttribute("data-wb-book") || 0) }))
    .sort((a, b) => b.count - a.count);
  books.find((b) => b.count > 0)?.el.click();
});
for (let i = 0; i < 20; i++) {
  const n = await page.evaluate(() => document.querySelectorAll("[data-wb-row]").length).catch(() => 0);
  if (n > 0) break;
  await sleep(1000);
}

const shell = await page.evaluate(() => {
  // main 自己是满宽（1440），内容容器是它内部那层 max-w-[1180px]，量外层会假阳性
  const shellEl = document.querySelector("main > div") ?? document.querySelector("main");
  const mainBox = shellEl?.getBoundingClientRect();
  // 左侧书架卡片宽度：取 aside 里第一个 button
  const shelfCard = document.querySelector("aside ul li button");
  const shelfBox = shelfCard?.getBoundingClientRect();
  const rows = document.querySelectorAll("[data-wb-row]");
  const first = rows[0];
  const def = first?.querySelector("[data-wb-def]");
  const word = first?.querySelector("[data-wb-word]");
  const cs = def ? getComputedStyle(def) : null;
  const lh = cs ? parseFloat(cs.lineHeight) : 0;
  return {
    mainW: mainBox ? Math.round(mainBox.width) : 0,
    shelfW: shelfBox ? Math.round(shelfBox.width) : 0,
    rowCount: rows.length,
    defW: def ? Math.round(def.getBoundingClientRect().width) : 0,
    defH: def ? Math.round(def.getBoundingClientRect().height) : 0,
    defLineH: Math.round(lh),
    defFont: cs ? parseFloat(cs.fontSize) : 0,
    wordFont: word ? parseFloat(getComputedStyle(word).fontSize) : 0,
    rowScrollW: first ? first.scrollWidth : 0,
    rowClientW: first ? first.clientWidth : 0,
    defText: (def?.textContent ?? "").trim().slice(0, 40),
  };
});

console.log(`  实测：主容器 ${shell.mainW}px / 书架卡 ${shell.shelfW}px / 词 ${shell.rowCount} 行 / 释义列 ${shell.defW}×${shell.defH}px（行高 ${shell.defLineH}）/ 释义字号 ${shell.defFont}px`);

check("生词本容器已放宽（>=1100px，原 760px 上限）", shell.mainW >= 1100, `${shell.mainW}px`);
check("左侧书架列宽放大（>=340px，原 330px）", shell.shelfW >= 340, `${shell.shelfW}px`);
check("词书词表已渲染", shell.rowCount > 0, `${shell.rowCount} 行`);

/* 竖排回归三连：列宽 + 行数 + 不溢出 */
check("释义列宽度足够（>=180px，竖排时会塌到几十 px）", shell.defW >= 180, `${shell.defW}px`);
check(
  "释义没有逐字竖排（渲染高度 <= 3.5 倍行高）",
  shell.defLineH > 0 && shell.defH <= shell.defLineH * 3.5,
  `${shell.defH}px / 行高 ${shell.defLineH}px = ${(shell.defH / (shell.defLineH || 1)).toFixed(1)} 行`,
);
check("词表行无横向溢出（scrollWidth <= clientWidth+1）", shell.rowScrollW <= shell.rowClientW + 1, `${shell.rowScrollW} vs ${shell.rowClientW}`);

/* 字号放大 */
check("词书单词字号 >= 21px（原 19px）", shell.wordFont >= 21, `${shell.wordFont}px`);
check("词书释义字号 >= 16px（原 15.5px）", shell.defFont >= 16, `${shell.defFont}px`);

/* 窄屏（1080）也不许竖排：窗口一窄最容易复发的场景 */
await page.setViewport({ width: 1080, height: 900 });
await sleep(900);
const narrow = await page.evaluate(() => {
  const first = document.querySelector("[data-wb-row]");
  const def = first?.querySelector("[data-wb-def]");
  if (!def) return null;
  const cs = getComputedStyle(def);
  const lh = parseFloat(cs.lineHeight);
  const box = def.getBoundingClientRect();
  return {
    defW: Math.round(box.width),
    lines: box.height / (lh || 1),
    rowScrollW: first.scrollWidth,
    rowClientW: first.clientWidth,
  };
});
check("1080 宽下释义列仍 >=160px", (narrow?.defW ?? 0) >= 160, `${narrow?.defW}px`);
check("1080 宽下释义仍不竖排（<= 4 倍行高）", (narrow?.lines ?? 99) <= 4, `${(narrow?.lines ?? 0).toFixed(1)} 行`);
check("1080 宽下词表行不横向溢出", (narrow?.rowScrollW ?? 0) <= (narrow?.rowClientW ?? 0) + 1);

/* ---------- 2. 生词本词表页：字号放大 ---------- */
await page.setViewport({ width: 1440, height: 1000 });
await page.goto(`${BASE}${withSc("/vocab")}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await waitHydrated();
await sleep(3000);

const listPage = await page.evaluate(() => {
  const def = document.querySelector("[data-vl-def]");
  const word = document.querySelector("[data-vl-word]");
  const bar = document.querySelector("div.fixed .mx-auto");
  return {
    hasRows: document.querySelectorAll("[data-vl-row]").length,
    wordFont: word ? parseFloat(getComputedStyle(word).fontSize) : 0,
    defFont: def ? parseFloat(getComputedStyle(def).fontSize) : 0,
    barW: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
  };
});

check("生词本词表已渲染", listPage.hasRows > 0, `${listPage.hasRows} 行`);
check("生词本单词字号 >= 19px（原 17px）", listPage.wordFont >= 19, `${listPage.wordFont}px`);
check("生词本释义字号 >= 15px（原 13px）", listPage.defFont >= 15, `${listPage.defFont}px`);
check("底部操作栏跟随加宽（>=1100px）", listPage.barW >= 1100, `${listPage.barW}px`);

/* ---------- 3. 无 JS 报错 ---------- */
const fatal = errors.filter((e) => !/favicon|Hydration|418/i.test(e));
check("全程无 JS 报错", fatal.length === 0, fatal.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n== 结果 == 通过 ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
