/**
 * 第十六轮验收：单词串故事 —— 选词入口 + 手动勾选生词本/词书词
 *   1) 生词本列表里有独立的「单词串故事」入口卡片（不再只藏在随身听二级 tab）
 *   2) 选词页可切换来源（生词本 + 各本词书），手动勾选 4–16 个词
 *   3) 按勾选顺序串成故事，故事正文目标词加粗并附中文释义
 * 用法：node scripts/verify-story-builder.mjs
 * 环境变量：BASE（默认 http://127.0.0.1:3100）、SC（分享码，可选）
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const url = (p) => `${BASE}${p}${SC ? `${p.includes("?") ? "&" : "?"}sharecode=${SC}` : ""}`;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) { passed += 1; console.log(`  ✅ ${name}${extra ? `  (${extra})` : ""}`); }
  else { failed += 1; console.log(`  ❌ ${name}${extra ? `  (${extra})` : ""}`); }
};

console.log(`== 第十六轮：单词串故事 —— 选词入口 + 手动勾选 ==  BASE=${BASE}`);

/* ---------- 源码层 ---------- */
console.log("\n[1] 源码层");
{
  const va = fs.readFileSync("src/components/vocab/vocab-app.tsx", "utf8");
  check("生词本：新增 story 视图并接入选词页", va.includes('view === "story"') && va.includes("StoryBuilder"));

  const wl = fs.readFileSync("src/components/vocab/word-list-view.tsx", "utf8");
  check("生词本：独立「单词串故事」入口卡片", wl.includes("单词串故事") && wl.includes("onStartStory"));

  const sb = fs.readFileSync("src/components/vocab/story-builder.tsx", "utf8");
  check("选词页：来源切换（生词本 + 词书）", sb.includes("/api/books") && sb.includes("生词本"));
  check("选词页：手动勾选 + 随机选 8 + 串成故事", sb.includes("toggle") && sb.includes("随机选 8") && sb.includes("串成故事"));
  check("选词页：数量边界 4–16", sb.includes("MIN_WORDS = 4") && sb.includes("MAX_WORDS = 16"));

  const wsp = fs.readFileSync("src/components/vocab/word-story-player.tsx", "utf8");
  check("故事播放器：支持外部指定词 givenWords", wsp.includes("givenWords"));
  check("故事播放器：云模型整体超时回兜底", wsp.includes("CLOUD_STORY_TIMEOUT_MS"));
}

/* ---------- 浏览器层 ---------- */
console.log("\n[2] 浏览器层");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

const ev = async (fn, arg) => {
  for (let i = 0; i < 6; i++) {
    try { return await page.evaluate(fn, arg); }
    catch (e) { if (!/Execution context|navigat|Cannot find context/i.test(String(e)) && i === 5) throw e; await sleep(1500); }
  }
  return null;
};
const waitHydrated = async () => {
  for (let t = 0; t < 60; t++) {
    const h = await page.evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react"))).catch(() => false);
    if (h) break;
    await sleep(1000);
  }
  await sleep(1200);
};
const clickText = async (re, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    const hit = await ev((src) => {
      const b = [...document.querySelectorAll("button")].find((x) => new RegExp(src).test(x.textContent ?? ""));
      if (b) { b.click(); return true; }
      return false;
    }, re.source);
    if (hit) return true;
    await sleep(1800);
  }
  return false;
};

await page.goto(url("/vocab"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
if (page.url().includes("/login")) {
  for (let i = 0; i < 5; i++) {
    const ok = await ev(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /演示账号/.test(x.textContent ?? ""));
      if (b) { b.click(); return true; }
      return false;
    });
    if (ok) break;
    await sleep(1500);
  }
  for (let i = 0; i < 12; i++) { if (!page.url().includes("/login")) break; await sleep(1500); }
  await page.goto(url("/vocab"), { waitUntil: "domcontentloaded" }).catch(() => {});
  await waitHydrated();
  await sleep(2000);
}

// 1. 入口卡片
const hasEntry = await ev(() => (document.body?.innerText ?? "").includes("单词串故事"));
check("生词本：入口卡片可见", !!hasEntry);

// 2. 点击进入选词页
const clickedEntry = await clickText(/单词串故事/);
await sleep(2200);
const builderInfo = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { title: t.includes("选词"), hasVocab: t.includes("生词本"), hint: t.includes("勾选") };
});
check("选词页：标题与提示", !!clickedEntry && !!builderInfo?.title && !!builderInfo?.hint);

// 3. 勾选 4 个词
const toggled = await ev(() => {
  const rows = [...document.querySelectorAll("li button")];
  const n = Math.min(4, rows.length);
  for (let i = 0; i < n; i++) rows[i].click();
  return n;
});
await sleep(1000);
const selInfo = await ev(() => {
  const t = document.body?.innerText ?? "";
  const m = t.match(/已选\s*(\d+)\s*个/);
  return m ? Number(m[1]) : -1;
});
check("选词页：勾选 4 词后计数 = 4", !!toggled && toggled >= 4 && selInfo === 4, `toggled=${toggled} count=${selInfo}`);

// 4. 串成故事 → 故事正文
const built = await clickText(/串成故事/);
let storyOk = false;
let storyDetail = "";
for (let i = 0; i < 25; i++) {
  await sleep(2000);
  const info = await ev(() => {
    const t = document.body?.innerText ?? "";
    const bolds = [...document.querySelectorAll("b")].filter((b) => (b.textContent ?? "").trim().length > 1);
    return { bolds: bolds.length, modeLine: /AI 串词故事|句架串联/.test(t), generating: t.includes("正在把") };
  });
  if (info && !info.generating && (info.bolds > 0 || info.modeLine)) {
    storyOk = info.bolds >= 4 && info.modeLine;
    storyDetail = `bolds=${info.bolds}`;
    break;
  }
}
check("故事页：目标词加粗 ≥4 且带模式标注", !!built && storyOk, storyDetail);

check("浏览器层无 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n== 结果：通过 ${passed} / 失败 ${failed} ==`);
if (failed > 0) process.exit(1);
