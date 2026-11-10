/**
 * 深水区功能验证：矩阵脚本没覆盖到的写操作与状态流转。
 *
 * 覆盖：词卡→加入生词本（写库）→ 生词本出现该词 → 复习判定；
 *       练习页收藏 → 收藏页出现；排行周期切换重新取数；
 *       非管理员访问 /admin；不存在的路由返回 404 而不是白屏。
 *
 * 用法：BASE_URL=http://127.0.0.1:3101 node scripts/e2e-deep-features.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (scope, name, pass, detail) => {
  results.push({ scope, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  [${scope}] ${name}${detail ? `  — ${detail}` : ""}`);
};

const email = `deep_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";

async function register() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pwd, name: "深水测试" }),
  });
  console.log(`注册 ${res.status}`);
}

const clickText = (page, needle, tag = "button") =>
  page.evaluate(
    ({ needle, tag }) => {
      const hit = [...document.querySelectorAll(tag)].find((e) =>
        (e.textContent || "").replace(/\s+/g, " ").includes(needle),
      );
      if (!hit) return false;
      hit.scrollIntoView({ block: "center" });
      hit.click();
      return true;
    },
    { needle, tag },
  );

const hasText = (page, n) => page.evaluate((x) => (document.body.textContent || "").includes(x), n);

async function run(scope, viewport) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: viewport,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));

    // 登录
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.type('input[type="email"]', email, { delay: 8 });
    await page.type('input[type="password"]', pwd, { delay: 8 });
    await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
    for (let i = 0; i < 60 && page.url().includes("/login"); i++) await sleep(250);
    rec(scope, "登录", !page.url().includes("/login"), page.url());

    // 进第一套卷
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    const href = await page.evaluate(
      () => document.querySelector('a[href^="/practice/"]')?.getAttribute("href") || "",
    );
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    if (viewport.isMobile) {
      await clickText(page, "文章");
      await sleep(300);
    }

    // 点词 → 加入生词本
    const wordText = await page.evaluate(() => {
      const w = document.querySelector("article .word");
      if (!w) return "";
      w.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return (w.textContent || "").trim();
    });
    await sleep(1000);
    // 同一个账号第二轮跑时这个词已经在库里，按钮直接是「✓ 已在生词本」，
    // 所以判定看最终状态，不强制要求点到「加入生词本」。
    await clickText(page, "加入生词本");
    await sleep(1200);
    const inVocab = await hasText(page, "已在生词本");
    rec(scope, "点词并加入生词本", Boolean(wordText) && inVocab, `词=${wordText}`);

    // 收藏本题
    const favClicked = await page.evaluate(() => {
      const b = document.querySelector('[aria-label="收藏这道题"], [aria-label="取消收藏这道题"]');
      if (!b) return false;
      b.click();
      return true;
    });
    await sleep(1000);
    rec(scope, "收藏本题", favClicked);
    // 再点一次取消，避免影响后续账号状态
    await page.evaluate(() => {
      const b = document.querySelector('[aria-label="取消收藏这道题"]');
      b && b.click();
    });
    await sleep(600);

    // 生词本：出现刚加的词 + 复习判定
    await page.goto(`${BASE}/vocab`, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    // 生词本里统一存小写，比较时忽略大小写（页面上显示为 every）
    const vocabHasWord = wordText
      ? await page.evaluate(
          (w) => (document.body.innerText || "").toLowerCase().includes(w.toLowerCase()),
          wordText,
        )
      : false;
    rec(scope, "生词本出现刚加入的词", vocabHasWord, wordText);
    const started = await clickText(page, "开始刷词");
    await sleep(900);
    const judged = started ? await clickText(page, "认识") : false;
    await sleep(900);
    rec(scope, "开始刷词并判「认识」", started && judged);
    const ovVocab = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    rec(scope, "生词本无横向溢出", ovVocab <= 1, `${ovVocab}px`);

    // 排行：切到本月
    await page.goto(`${BASE}/leaderboard`, { waitUntil: "domcontentloaded" });
    await sleep(800);
    // 周期切换按钮的文案是「周榜 / 月榜」，切过去后统计口径那行会显示「本月 · 积分 = …」
    const switched = await clickText(page, "月榜");
    await sleep(1500);
    const monthOk = await hasText(page, "本月");
    rec(scope, "排行切到月榜并重新取数", switched && monthOk);

    // 非管理员进 /admin：不应 500
    const adminRes = await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    rec(scope, "/admin 对普通用户不报错", adminRes && adminRes.status() < 500, `HTTP ${adminRes && adminRes.status()}`);

    // 404
    const nfRes = await page.goto(`${BASE}/this-page-does-not-exist`, { waitUntil: "domcontentloaded" });
    const nfText = (await page.content()).length > 200;
    rec(scope, "未知路由有 404 页面", nfRes && nfRes.status() === 404 && nfText, `HTTP ${nfRes && nfRes.status()}`);

    rec(scope, "全程无 JS 错误", errors.length === 0, errors.slice(0, 2).join(" | ") || "无");
    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

await register();
await run("桌面 1280", { width: 1280, height: 800, isMobile: false, hasTouch: false });
await run("手机 390", { width: 390, height: 844, isMobile: true, hasTouch: true });

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
if (passed !== results.length) process.exit(1);
