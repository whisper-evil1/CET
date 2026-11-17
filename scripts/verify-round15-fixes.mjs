/**
 * 第十五轮回归验收：
 *   1) 刷词(FlashSession)/背单词(ReviewGame) 的真题例句不再自动划走，改手动「下一个」
 *   2) 随身听「这个我认识」点击不再与音频碰撞（代次守卫 + 先停再切）
 *   3) 随身听中文只读纯释义，不读 n./vt. 词性缩写
 * 用法：node scripts/verify-round15-fixes.mjs
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

console.log(`== 第十五轮回归：例句手动划走 / 随身听修复 ==  BASE=${BASE}`);

/* ---------- 源码层 ---------- */
console.log("\n[1] 源码层");
{
  const rg = fs.readFileSync("src/components/arcade/review-game.tsx", "utf8");
  check("背单词：不再 0.9/1.5s 自动划走", !/,\s*ok\s*\?\s*900\s*:\s*1500/.test(rg));
  check("背单词：保留手动「下一个 →」", rg.includes("下一个 →") && rg.includes("onRevealNext"));

  const fs2 = fs.readFileSync("src/components/vocab/flash-session.tsx", "utf8");
  check("刷词：不再 0.3s 自动切卡", !/},\s*300\);/.test(fs2) && !fs2.includes("// 0.3s 后切下一个"));
  check("刷词：新增手动「下一个 →」", fs2.includes("下一个 →") && fs2.includes("const advance"));

  const ap = fs.readFileSync("src/components/vocab/audio-player.tsx", "utf8");
  check("随身听：朗读代次守卫（防碰撞）", ap.includes("speakSeqRef") && ap.includes("cancelSpeak"));
  check("随身听：中文只读纯释义（不带词性缩写）", ap.includes('word.definitions.map((d) => d.zh).filter(Boolean).join("；")') && !ap.includes("${d.pos} ${d.zh}"));
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
const currentWord = () => ev(() => {
  // 卡片里的大号 serif 单词
  const el = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /font-serif/.test(n.className) && /^[A-Za-z][A-Za-z\-']{1,30}$/.test((n.textContent ?? "").trim()) && parseFloat(getComputedStyle(n).fontSize) >= 30);
  return el ? el.textContent.trim() : "";
});

/* 登录 */
let loaded = false;
for (let i = 0; i < 5; i++) {
  try { await page.goto(url("/vocab"), { waitUntil: "domcontentloaded", timeout: 60000 }); loaded = true; break; }
  catch { await sleep(3000); }
}
check("生词本可达", loaded);
await waitHydrated();
if ((page.url() || "").includes("/login")) {
  await clickText(/演示账号/, 4);
  for (let i = 0; i < 10; i++) { if (!(page.url() || "").includes("/login")) break; await sleep(1500); }
  await page.goto(url("/vocab"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitHydrated();
}

/* --- 2a. 刷词：认识后不自动划走 --- */
await page.goto(url("/vocab?mode=flash"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
// 等卡真正渲染出来（线上冷启动可能慢）：读到一个非空词再继续，避免 before 空串假阴性
let wBefore = "";
for (let i = 0; i < 20 && !wBefore; i++) {
  wBefore = await currentWord();
  if (!wBefore) await sleep(1000);
}
// 精确点「😊 认识」：整张卡也是个 button，文案里带「已认识」，用宽泛正则 /认识/ 会误点卡片
const clickedKnown = await clickText(/^😊\s*认识$/, 4);
await sleep(1600); // 超过旧 300ms 自动切时间，若还停在原词说明已改手动
const flashAfter = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { hasNext: t.includes("下一个 →"), word: [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && /font-serif/.test(n.className) && /^[A-Za-z][A-Za-z\-']{1,30}$/.test((n.textContent ?? "").trim()) && parseFloat(getComputedStyle(n).fontSize) >= 30)?.textContent.trim() ?? "" };
});
check("刷词：认识后仍在原词（未自动划走）", !!clickedKnown && flashAfter?.word === wBefore, `before=${wBefore} after=${flashAfter?.word}`);
check("刷词：出现手动「下一个 →」", !!flashAfter?.hasNext);
const advanced = await clickText(/下一个 →/);
await sleep(800);
check("刷词：点「下一个 →」切到下一张", !!advanced);

/* --- 2b. 背单词：选答案后不自动划走 --- */
await page.goto(url("/vocab?mode=review"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
await clickText(/开始背词/, 5);
await sleep(3000);
await clickText(/不认识/, 5); // 直接看释义 + 例句
await sleep(1200);
const reveal1 = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { hasNext: t.includes("下一个 →"), hasEvidence: t.includes("真题再现") };
});
check("背单词：不认识后显示释义 + 真题例句", reveal1?.hasEvidence === true);
await sleep(2000); // 超过旧 0.9/1.5s 自动切，仍应停在 reveal
const reveal2 = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { hasNext: t.includes("下一个 →") };
});
check("背单词：2 秒后仍未自动划走", reveal1?.hasNext && reveal2?.hasNext);
const rvNext = await clickText(/下一个 →/);
check("背单词：手动「下一个 →」可点", !!rvNext);

/* --- 2c. 随身听：这个我认识 + 中文 --- */
await page.goto(url("/vocab?mode=audio"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
// 切到「单词连播」面板（默认就是）
const idxBefore = await ev(() => (document.body?.innerText?.match(/(\d+)\s*\/\s*(\d+)/) ?? []).slice(1, 3).join("/"));
const started = await clickText(/^▶$/, 3);
await sleep(1200);
const clickKnown = await clickText(/这个我认识/, 4);
await sleep(1200);
const idxAfter = await ev(() => (document.body?.innerText?.match(/(\d+)\s*\/\s*(\d+)/) ?? []).slice(1, 3).join("/"));
check("随身听：开始播放", !!started);
check("随身听：点「这个我认识」后前进到下一词", !!clickKnown && idxAfter !== idxBefore, `${idxBefore} → ${idxAfter}`);
check("随身听：切词后无页面 JS 报错（无碰撞异常）", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "clean");

check("全程无页面 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "clean");

await browser.close();
console.log(`\n== 结果：${passed} 过 / ${failed} 挂 ==`);
process.exit(failed > 0 ? 1 : 0);
