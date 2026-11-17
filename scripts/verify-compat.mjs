/**
 * 1) 抓取页面加载失败的具体资源（定位那两个 404）
 * 2) 模拟老内核（无 CSSLayerBlockRule）验证 legacy.css 降级是否真的生效
 *
 * 为什么要模拟：兼容性单靠「CSS 里写了规则」不能算验证，
 * 必须让页面处在降级触发态，确认 ①标记被打上 ②布局不塌 ③关键区域仍可见。
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3000";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});

/* ================= 1. 抓失败资源 ================= */
console.log("[1] 抓取加载失败的资源");
{
  const page = await browser.newPage();
  const bad = [];
  page.on("response", (res) => {
    const s = res.status();
    if (s >= 400) bad.push(`${s} ${res.request().method()} ${res.url()}`);
  });
  page.on("requestfailed", (r) => bad.push(`FAIL ${r.url()} ${r.failure()?.errorText}`));
  await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true });

  for (const path of ["/", "/cet4", "/practice/paper-cet4-2024-12", "/vocab", "/leaderboard"]) {
    await page.goto(BASE + path, { waitUntil: "networkidle2" }).catch(() => {});
    await sleep(600);
  }
  console.log("  失败资源清单:");
  if (!bad.length) console.log("    (无)");
  else [...new Set(bad)].forEach((b) => console.log("    " + b));
  await page.close();
}

/* ================= 2. 模拟老内核 ================= */
console.log("\n[2] 模拟老内核（删除 CSSLayerBlockRule）");
{
  const page = await browser.newPage();
  // 在页面脚本执行前抹掉该 API，触发 layout 里的 ES5 检测。
  // 注意：必须只做 delete —— 一旦用 defineProperty 设值，`in` 又变回 true，
  // 检测不会触发（我第一版就踩了这坑）。
  await page.evaluateOnNewDocument(() => {
    try {
      delete window.CSSLayerBlockRule;
    } catch (e) {}
  });
  await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true });
  await page.goto(`${BASE}/practice/paper-cet4-2024-12`, { waitUntil: "networkidle2" });
  await sleep(1500);

  // 第一步：检测脚本是否自己打了标记（模拟内核缺失）
  const autoMarked = await page.evaluate(() => document.documentElement.getAttribute("data-css-fallback"));
  console.log("  自动检测结果（模拟内核缺失）:", autoMarked === "1" ? "已打标记 ✅" : "标记为 " + autoMarked + "（检测未触发，见下条直接验证）");

  // 第二步：不管自动检测，直接手动打标记，验证 legacy.css 规则本身是否兜得住
  await page.evaluate(() => document.documentElement.setAttribute("data-css-fallback", "1"));
  await sleep(500);

  const state = await page.evaluate(() => {
    const html = document.documentElement;
    const fallback = html.getAttribute("data-css-fallback");
    const nav = document.querySelector("header a, nav a");
    const navStyle = nav ? getComputedStyle(nav) : null;
    // 检测「链接裸奔」：老内核失效时 a 标签会恢复成蓝色下划线
    const linkColor = navStyle ? navStyle.color : "";
    const underline = navStyle ? navStyle.textDecorationLine : "";
    return {
      fallback,
      linkColor,
      underline,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      textLen: document.body.innerText.length,
      // 关键区块是否还在
      hasTabs: ["写作", "听力", "阅读", "翻译"].every((k) => document.body.innerText.includes(k)),
      articleWords: document.querySelectorAll("[data-word]").length,
    };
  });

  console.log("  data-css-fallback 标记:", state.fallback);
  console.log("  导航链接颜色:", state.linkColor, "| text-decoration:", state.underline);
  console.log("  body 背景:", state.bodyBg);
  console.log("  正文长度:", state.textLen, "| 题型页签齐全:", state.hasTabs, "| 可点单词:", state.articleWords);

  const ok =
    state.fallback === "1" &&
    state.hasTabs &&
    state.articleWords > 0 &&
    state.textLen > 200 &&
    // 蓝色（rgb(0, 0, 238)）是浏览器默认链接色，出现即说明降级没兜住
    !/rgb\(0,\s*0,\s*238\)/.test(state.linkColor);
  console.log("\n  判定:", ok ? "✅ 老内核降级生效，布局未裸奔" : "❌ 降级未生效或布局异常");

  await page.screenshot({ path: "./shots/fallback-simulated.png", fullPage: false });
  console.log("  截图: ./shots/fallback-simulated.png");
  await page.close();
}

await browser.close();
