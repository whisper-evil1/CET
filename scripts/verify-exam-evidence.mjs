/**
 * 真题再现功能验收：/api/vocab/word-exam + ReviewGame/FlashSession 集成。
 * 用法：node scripts/verify-exam-evidence.mjs
 * 环境变量：BASE（默认 http://127.0.0.1:3100）、SC（分享码，可选）
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const url = (path) => `${BASE}${path}${SC ? `${path.includes("?") ? "&" : "?"}sharecode=${SC}` : ""}`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}${extra ? `  (${extra})` : ""}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${extra ? `  (${extra})` : ""}`);
  }
};

console.log(`== 真题再现验收 ==  BASE=${BASE}`);

/* ---------- 1. API 层 ---------- */
console.log("\n[1] API /api/vocab/word-exam");
/** 网关偶发把请求拦成 HTML：带重试的 JSON 取用 */
async function fetchJson(u) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(u);
      const text = await r.text();
      if (!text.trim().startsWith("{")) throw new Error("non-json: " + text.slice(0, 40));
      return { status: r.status, json: JSON.parse(text) };
    } catch (e) {
      if (i === 4) throw e;
      await sleep(2500);
    }
  }
  return null;
}
{
  const { status, json: j } = await fetchJson(url("/api/vocab/word-exam?word=frequently"));
  check("frequently 返回 200", status === 200);
  const e = j?.data?.evidence;
  check("evidence 非空", !!e, e ? `total=${e.total}` : "");
  if (e) {
    check("total ≥ 1", e.total >= 1, `${e.total} 句次`);
    check("listening + written = total", e.listening + e.written === e.total, `${e.listening}+${e.written}`);
    check("corpusPapers > 0", e.corpusPapers > 0, `${e.corpusPapers} 套`);
    check("examples ≤ 3 且非空", e.examples.length >= 1 && e.examples.length <= 3, `${e.examples.length} 条`);
    const ex = e.examples[0];
    check("例句带 cite 出处", typeof ex?.cite === "string" && ex.cite.includes("真题"), ex?.cite ?? "");
    check("例句英文非空", typeof ex?.en === "string" && ex.en.length > 10);
    check("年份跨度合理", e.yearMin >= 2021 && e.yearMax <= 2026, `${e.yearMin}–${e.yearMax}`);
  }
  const { json: j2 } = await fetchJson(url("/api/vocab/word-exam?word=zzzznotaword"));
  check("未命中的词返回 evidence: null", j2?.data?.evidence === null);
  const { status: s3 } = await fetchJson(url("/api/vocab/word-exam"));
  check("缺 word 参数不报错", s3 === 200);
}

/* ---------- 2. 浏览器层：ReviewGame ---------- */
console.log("\n[2] ReviewGame（刷词）UI");
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

const ev = async (fn, arg) => {
  for (let i = 0; i < 6; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context|navigat|Cannot find context/i.test(String(e)) && i === 5) throw e;
      await sleep(1500);
    }
  }
  return null;
};

let loaded = false;
for (let i = 0; i < 5; i++) {
  try {
    await page.goto(url("/vocab?mode=review"), { waitUntil: "domcontentloaded", timeout: 60000 });
    loaded = true;
    break;
  } catch {
    await sleep(3000);
  }
}
check("刷词页可达 /vocab?mode=review", loaded);
// 必须等 React 水合完成（只等 button 出现不够：SSR HTML 里就有 button，点了没绑定）
for (let t = 0; t < 60; t++) {
  const hydrated = await page
    .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
    .catch(() => false);
  if (hydrated) break;
  await sleep(1000);
}
await sleep(1500);

// 未登录会跳到 /login：用演示账号一键进入后回刷词页
const atLogin = (page.url() || "").includes("/login");
if (atLogin) {
  let demo = false;
  for (let i = 0; i < 4 && !demo; i++) {
    demo = await ev(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => /演示账号/.test(x.textContent ?? ""));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    if (!demo) await sleep(1800);
  }
  check("一键进入演示账号", !!demo);
  for (let i = 0; i < 6; i++) {
    if (!(page.url() || "").includes("/login")) break;
    await sleep(1500);
  }
  await page.goto(url("/vocab?mode=review"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  for (let t = 0; t < 60; t++) {
    const hydrated = await page
      .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
      .catch(() => false);
    if (hydrated) break;
    await sleep(1000);
  }
  await sleep(1500);
  check("登录后回到刷词页", !(page.url() || "").includes("/login"), page.url());
}

// 进入游戏：点「开始背词」（重试：线上水合慢，一次点不中不等于按钮坏）
let started = false;
for (let i = 0; i < 4 && !started; i++) {
  started = await ev(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => /开始背词|开始背/.test(x.textContent ?? ""));
    if (b) {
      b.click();
      return true;
    }
    return false;
  });
  if (!started) await sleep(1800);
}
check("点击开始背词", !!started);
await sleep(3500);

// compact 真题条
const compact = await ev(() => {
  const t = document.body?.innerText ?? "";
  return {
    hasBadge: t.includes("真题再现") || t.includes("真题检索中"),
    hasFreq: /出现\s*\d+\s*句次|词频\s*#/.test(t),
  };
});
check("compact 真题频次条出现", compact?.hasBadge, JSON.stringify(compact));

// 判定阶段走「不认识」→ reveal → 真题卡
let wentUnknown = false;
for (let i = 0; i < 4 && !wentUnknown; i++) {
  wentUnknown = await ev(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => (x.textContent ?? "").includes("不认识"));
    if (b) {
      b.click();
      return true;
    }
    return false;
  });
  if (!wentUnknown) await sleep(1800);
}
check("点击「不认识」进 reveal", !!wentUnknown);
await sleep(2500);

const fullCard = await ev(() => {
  const t = document.body?.innerText ?? "";
  return {
    hasBadge: t.includes("真题再现"),
    hasCite: /真题\s*·/.test(t),
    hasExample: /[a-z]{3,}\s+[a-z]{3,}/i.test(t),
  };
});
check("reveal 内真题卡（含例句出处）", fullCard?.hasBadge && fullCard?.hasCite, JSON.stringify(fullCard));

// 点下一个，确保不卡死
let wentNext = false;
for (let i = 0; i < 4 && !wentNext; i++) {
  wentNext = await ev(() => {
    const btns = [...document.querySelectorAll("button")];
    const b = btns.find((x) => (x.textContent ?? "").includes("下一个"));
    if (b) {
      b.click();
      return true;
    }
    return false;
  });
  if (!wentNext) await sleep(1800);
}
check("「下一个」可点", !!wentNext);

/* ---------- 3. FlashSession（生词本刷词闪卡）入口存在性 ---------- */
console.log("\n[3] FlashSession 集成（编译层）");
{
  const src = fs.readFileSync("src/components/vocab/flash-session.tsx", "utf8");
  check("flash-session 引入 ExamEvidence", src.includes('from "@/components/vocab/exam-evidence"'));
  check("flash-session 渲染真题卡", src.includes('variant="full"'));
  const rg = fs.readFileSync("src/components/arcade/review-game.tsx", "utf8");
  check("review-game compact + full 双接入", rg.includes('variant="compact"') && rg.includes('variant="full"'));
  check("review-game 开局预取证据", rg.includes("prefetchExamEvidence"));
}

check("无页面 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "clean");

await browser.close();
console.log(`\n== 结果：${passed} 过 / ${failed} 挂 ==`);
process.exit(failed > 0 ? 1 : 0);
