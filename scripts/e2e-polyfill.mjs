/**
 * 老内核内置方法缺失的模拟验证。
 *
 * Chrome 本体一定有 .at / Object.hasOwn / replaceAll / structuredClone，
 * 所以「老浏览器能不能跑」光靠它测不出来。这里在页面脚本执行前把这些方法删掉，
 * 模拟 Chrome 80 / Safari 13 的 JS 环境，再看：
 *   1. 内联 polyfill 有没有把它们补回来；
 *   2. 应用还能不能正常 hydrate 并响应点击（Next 自己的运行时就在用 Array.prototype.at）。
 *
 * 用法：BASE_URL=http://127.0.0.1:3101 USER_ID=<有错题的用户> node scripts/e2e-polyfill.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userId = (process.env.USER_ID || "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
try {
  if (userId) {
    const token = execFileSync("node", ["scripts/dev-session.mjs", userId], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    const p0 = await browser.newPage();
    await p0.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
    await p0.close();
  }

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  // 在页面任何脚本之前，把这些「新方法」删掉
  await page.evaluateOnNewDocument(() => {
    delete Array.prototype.at;
    delete String.prototype.at;
    delete Object.hasOwn;
    delete String.prototype.replaceAll;
    delete window.structuredClone;
  });

  await page.goto(`${BASE}/mistakes`, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(3500);

  const restored = await page.evaluate(() => ({
    at: typeof Array.prototype.at,
    atWorks: [1, 2, 3].at(-1) === 3,
    strAt: "abc".at(-1) === "c",
    hasOwn: Object.hasOwn({ a: 1 }, "a") === true,
    replaceAll: "a-b".replaceAll("-", "+") === "a+b",
    clone: typeof window.structuredClone === "function",
    hydated: Boolean(document.querySelector("button")),
  }));

  rec("Array.prototype.at 已补齐且行为正确", restored.atWorks, `at=${restored.at}`);
  rec("String.prototype.at 已补齐", restored.strAt);
  rec("Object.hasOwn 已补齐", restored.hasOwn);
  rec("String.replaceAll 已补齐", restored.replaceAll);
  rec("structuredClone 已补齐", restored.clone);
  rec("页面有可交互按钮（已 hydrate）", restored.hydated);

  // 真点一下：AI 分析按钮 → 有请求发出说明事件链通了
  let clicked = false;
  let requested = false;
  page.on("request", (r) => {
    if (r.url().includes("/api/mistakes/analyze") || r.url().includes("/.cloud/llm/chat/completions")) {
      requested = true;
    }
  });
  clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").includes("让 AI 分析"),
    );
    if (b) {
      b.click();
      return true;
    }
    return false;
  });
  for (let i = 0; i < 75 && !requested; i++) await sleep(200);
  let state = "";
  if (!requested) {
    state = await page.evaluate(() => {
      const card = [...document.querySelectorAll("div")].find((d) =>
        (d.textContent || "").includes("AI 薄弱点分析"),
      );
      return card ? (card.textContent || "").replace(/\s+/g, " ").slice(0, 160) : "无面板";
    });
  }
  rec("点击「让 AI 分析」能触发请求", clicked && requested, requested ? "已发出" : `无请求｜${state}`);
  rec("老内核模拟下无 JS 运行时错误", errors.length === 0, errors.slice(0, 2).join(" | ") || "无");

  await page.close();
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed !== results.length) process.exit(1);
