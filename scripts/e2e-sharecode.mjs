/**
 * 验证错题 AI 面板的两条链路，重点是「同源请求必须带 sharecode」这条线上网关硬约束。
 *
 * 线上网关对每个同源 API 请求都要求 ?sharecode=，少了就 403。
 * 面板有两条链路：
 *   A. 浏览器直连 WorkBuddy 云模型（跨域，不需要 sharecode）
 *   B. 云不可用 → 同源 /api/mistakes/analyze（必须带 sharecode）
 *
 * 因此本脚本跑两遍：
 *   第 1 遍（正常）    —— 记录实际走的链路；/api/mistakes/context 必须带 sharecode；
 *                        若走了服务端链路，analyze 也必须带 sharecode；正文须按 Markdown 渲染。
 *   第 2 遍（阻断云）  —— 掐断云域名请求，强制走服务端兜底，断言 analyze 带 sharecode
 *                        且正文仍然渲染成功。
 *
 * 用法：BASE_URL=... USER_ID=<有错题的用户> node scripts/e2e-sharecode.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const userId = (process.env.USER_ID || "").trim();
const CODE = `TESTSHARE${Date.now()}`;

const results = [];
const rec = (n, p, d) => {
  results.push(Boolean(p));
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
};

if (!userId) {
  console.error("需要 USER_ID");
  process.exit(1);
}
const token = execFileSync("node", ["scripts/dev-session.mjs", userId], { cwd: process.cwd(), encoding: "utf8" }).trim();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  try {
    await browser.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
  } catch {
    const p0 = await browser.newPage();
    await p0.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
    await p0.close();
  }

  /** 跑一遍面板，返回观测结果 */
  const once = async ({ blockCloud }) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    const seen = [];
    if (blockCloud) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const u = req.url();
        if (u.includes("/.cloud/llm/")) {
          // 模拟云服务不可达
          req.abort("failed").catch(() => {});
          return;
        }
        req.continue().catch(() => {});
      });
    }
    page.on("request", (req) => seen.push(req.url()));

    await page.goto(`${BASE}/mistakes?sharecode=${CODE}`, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 700));

    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent || "").includes("让 AI 分析"),
      );
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    // 最多等 40s：正文出现且流式结束（按钮变回「重新分析」）再取样
    let body = null;
    for (let i = 0; i < 100; i++) {
      body = await page.evaluate(() => {
        const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
          (d.textContent || "").includes("AI 薄弱点分析"),
        );
        if (!card) return null;
        const txt = card.textContent || "";
        const btns = [...card.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
        return {
          strong: card.querySelectorAll("strong").length,
          rawStar: txt.includes("**"),
          len: txt.length,
          streaming: btns.includes("停止"),
          cloudBadge: txt.includes("云模型已接入"),
          localBadge: txt.includes("本地数据归纳"),
          sample: txt.replace(/\s+/g, " ").slice(0, 120),
        };
      });
      if (body && body.len > 250 && !body.streaming) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const analyzeUrl = seen.find((u) => u.includes("/api/mistakes/analyze")) || "";
    const contextUrl = seen.find((u) => u.includes("/api/mistakes/context")) || "";
    const cloudHit = seen.some((u) => u.includes("/.cloud/llm/chat/completions"));

    await page.close();
    return { clicked, body, analyzeUrl, contextUrl, cloudHit };
  };

  // ---------- 第 1 遍：正常链路 ----------
  console.log("— 第 1 遍：正常链路 —");
  const a = await once({ blockCloud: false });
  rec("找到并点击「让 AI 分析」按钮", a.clicked);
  rec("conversation 上下文预取请求携带 sharecode", a.contextUrl.includes(`sharecode=${CODE}`), a.contextUrl ? "含 sharecode" : "未捕获");
  rec(
    a.cloudHit ? "本次走了浏览器直连云模型" : "本次走了服务端分析接口",
    true,
    a.cloudHit ? "云链路（跨域，无需 sharecode）" : "服务端链路",
  );
  if (!a.cloudHit) {
    rec(
      "服务端链路：analyze 请求携带 sharecode",
      a.analyzeUrl.includes(`sharecode=${CODE}`),
      a.analyzeUrl.includes("sharecode=") ? "含 sharecode" : "不含 sharecode",
    );
  }
  rec("分析正文成功渲染", Boolean(a.body) && a.body.len > 250, a.body ? `文本 ${a.body.len} 字` : "未渲染");
  rec(
    "正文按 Markdown 渲染（无裸露 **）",
    Boolean(a.body) && a.body.rawStar === false,
    a.body ? `rawStar=${a.body.rawStar}` : "无面板",
  );
  rec("正文包含加粗强调", Boolean(a.body) && a.body.strong > 0, a.body ? `strong=${a.body.strong}` : "无");
  rec(
    "正文不是通用示例，含本人真实数据",
    Boolean(a.body) && /道|正确率|题型|选项/.test(a.body.sample),
    a.body ? a.body.sample.slice(0, 60) : "无",
  );

  // ---------- 第 2 遍：阻断云，强制服务端兜底 ----------
  console.log("— 第 2 遍：阻断云模型，强制服务端兜底 —");
  const b = await once({ blockCloud: true });
  rec("阻断云后仍能点击分析", b.clicked);
  rec("云模型请求已被阻断（未走云链路）", b.cloudHit === false);
  rec(
    "兜底走同源 /api/mistakes/analyze",
    Boolean(b.analyzeUrl),
    b.analyzeUrl || "未捕获",
  );
  rec(
    "兜底请求携带 sharecode",
    b.analyzeUrl.includes(`sharecode=${CODE}`),
    b.analyzeUrl.includes("sharecode=") ? "含 sharecode" : "不含 sharecode",
  );
  rec("兜底正文成功渲染", Boolean(b.body) && b.body.len > 250, b.body ? `文本 ${b.body.len} 字` : "未渲染");
  rec(
    "兜底正文按 Markdown 渲染（无裸露 **）",
    Boolean(b.body) && b.body.rawStar === false,
    b.body ? `rawStar=${b.body.rawStar} strong=${b.body.strong}` : "无面板",
  );
  rec(
    "兜底时标注数据来源（本地归纳 / 云模型）",
    Boolean(b.body) && (b.body.localBadge || b.body.cloudBadge),
    b.body ? `local=${b.body.localBadge} cloud=${b.body.cloudBadge}` : "无",
  );
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed !== results.length) process.exit(1);
