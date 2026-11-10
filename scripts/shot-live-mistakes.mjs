/**
 * 线上留档截图：注册临时账号 → 制造一条错题 → /mistakes 点「让 AI 分析」→ 截图。
 * 用法：BASE_URL=https://... SHARECODE=xxxx node scripts/shot-live-mistakes.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const CODE = process.env.SHARECODE || "2AI33QQETY";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const q = (p) => `${p}${p.includes("?") ? "&" : "?"}sharecode=${CODE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = ".build/shot";
mkdirSync(OUT, { recursive: true });

const email = `shot_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });

  await page.goto(q(`${BASE}/login`), { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  // 切到注册：点一次等一会儿，若姓名框没出来就再点一次
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "注册");
      b && b.click();
    });
    await sleep(600);
    const has = await page.$('input[placeholder="小明"]');
    if (has) break;
  }
  await page.waitForSelector('input[placeholder="小明"]', { timeout: 15000 });
  await page.type('input[placeholder="小明"]', "线上留档");
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', pwd);
  await page.click('button[type="submit"]').catch(() => {});
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => {});
  await sleep(1200);
  console.log("登录后地址:", page.url());

  const crafted = await page.evaluate(async (code) => {
    const withCode = (p) => p + (p.includes("?") ? "&" : "?") + "sharecode=" + code;
    const get = async (p) => (await fetch(withCode(p), { cache: "no-store" })).json();
    const post = async (p, body) =>
      (
        await fetch(withCode(p), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();
    const papers = await get("/api/papers");
    const paperId = papers?.data?.[0]?.id;
    const detail = await get(`/api/papers/${paperId}`);
    let question = null;
    for (const p of detail?.data?.sections?.[0]?.passages ?? []) {
      const hit = (p.questions ?? []).find((x) => (x.options ?? []).length >= 2);
      if (hit) { question = hit; break; }
    }
    if (!question) return { ok: false };
    const first = await post("/api/answers", { questionId: question.id, choice: "A" });
    const correct = first?.data?.answer;
    const wrong = ["A", "B", "C", "D"].find((c) => c !== correct) ?? "B";
    await post("/api/answers", { questionId: question.id, choice: wrong });
    const mis = await get("/api/mistakes");
    return { ok: true, wrongCount: mis?.data?.summary?.wrongCount ?? -1 };
  }, CODE);
  console.log("制造错题:", JSON.stringify(crafted));

  const shoot = async (name, vp) => {
    const p = await browser.newPage();
    await p.setViewport(vp);
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    // 复用同一 cookie（同一 browser 上下文）
    await p.goto(q(`${BASE}/mistakes`), { waitUntil: "networkidle2", timeout: 60000 });
    await p.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("让 AI 分析"));
      if (b) b.click();
    });
    let panel = null;
    for (let i = 0; i < 240; i++) {
      panel = await p.evaluate(() => {
        const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
          (d.textContent || "").includes("AI 薄弱点分析"),
        );
        if (!card) return null;
        const txt = card.textContent || "";
        const btns = [...card.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
        return {
          len: txt.length,
          strong: card.querySelectorAll("strong").length,
          rawStar: txt.includes("**"),
          streaming: btns.includes("停止"),
          cloudBadge: txt.includes("云模型已接入"),
          localBadge: txt.includes("本地数据归纳"),
        };
      });
      if (panel && panel.len > 300 && !panel.streaming) break;
      await sleep(250);
    }
    await p.evaluate(() => {
      const card = [...document.querySelectorAll('div[class*="card-in"]')].find((d) =>
        (d.textContent || "").includes("AI 薄弱点分析"),
      );
      card?.scrollIntoView({ block: "center" });
    });
    await sleep(400);
    await p.screenshot({ path: `${OUT}/live-mistakes-ai-${name}.png` });
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(
      `${name}: len=${panel ? panel.len : 0} strong=${panel ? panel.strong : 0} rawStar=${panel ? panel.rawStar : null} cloud=${panel ? panel.cloudBadge : null} local=${panel ? panel.localBadge : null} 溢出=${overflow}px JS错误=${errors.length}`,
    );
    await p.close();
  };

  await shoot("mobile", { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await shoot("desktop", { width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.close();
} finally {
  await browser.close();
}
console.log("截图已存到 .build/shot/live-mistakes-ai-*.png");
