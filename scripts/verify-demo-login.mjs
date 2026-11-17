/**
 * 验收：登录页的「演示账号一键进入」。
 *
 * 这份脚本替评委走一遍：打开登录页 → 第一眼看到账号 → 点一下 → 已经在站内。
 * 顺带盯住三个容易退化的点：
 *   1. 演示卡必须在标题之前（「先显示默认账号」是明确要求，不是摆设）；
 *   2. 切到注册 / 验证码页签时演示卡要消失（避免和「我要用自己的号」打架）；
 *   3. 390 宽的手机上不溢出（评委很可能用手机点）。
 *
 * 注意顺序：所有「登录前」的检查都放在点击一键登录之前做完。
 * 登录之后同一个浏览器上下文就带着会话了，再打开 /login 会被直接送回首页，
 * 那时候去等演示卡只会超时——不是功能坏了，是脚本顺序错了。
 *
 * 用法：本地先起生产实例（PORT=3055 npm start），再 node scripts/verify-demo-login.mjs
 */
import puppeteer from "puppeteer-core";

// LIVE_BASE 优先：同一份脚本既能验本地，也能验线上，不必改代码
const BASE = (process.env.LIVE_BASE ?? process.env.LOCAL_BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const SHOTS = process.env.SHOT_DIR ?? "shots/demo-login";
/** 线上访问要带分享码；本地实例不需要，留空即可 */
const SHARE = process.env.SHARE_CODE ?? "";
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    // 线上网关对 HTTP/2 的浏览器连接偶发直接掐断（ERR_CONNECTION_CLOSED），
    // 关掉 h2 走 HTTP/1.1 后稳定很多；不影响被测功能。
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-http2",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const page = await browser.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e.message).slice(0, 160)));

  /*
   * 线上首屏要等 JS 下载 + 水合，实测 12～25 秒才让按钮从禁用变可点，
   * 容器刚重启时更久。这里给到 90 秒并允许重开一次：
   * 宁可多等，也不要把「加载慢」测成「功能坏了」。
   */
  const openLogin = async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await page.goto(`${withShare("/login")}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('section[aria-label="演示账号"] button:not([disabled])', {
          timeout: 90000,
        });
        return;
      } catch (e) {
        console.log(`   （第 ${attempt} 次打开登录页没等到可点按钮：${String(e.message).slice(0, 60)}）`);
        await sleep(3000);
      }
    }
    throw new Error("登录页 90 秒内没有变成可交互");
  };

  await openLogin();
  // 按钮从 disabled 变可点会走一段 opacity 过渡，立刻截图会拍到半透明的中间帧，
  // 看着像「按钮是灰的不能点」，其实是拍早了。
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/login-first-screen.png` });

  /* 1. 卡片内容：账号密码都写在明面上 */
  const card = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="演示账号"]');
    return section ? section.innerText.replace(/\s+/g, " ").trim() : "";
  });
  check("演示卡出现", Boolean(card), card.slice(0, 70));
  check("卡片写明账号", card.includes("demo@cet.local"), "demo@cet.local");
  check("卡片写明密码", card.includes("demo1234"), "demo1234");
  check("卡片有一键进入按钮", card.includes("一键进入"), card.match(/一键进入[^，。]*/)?.[0] ?? "");

  /* 2. 位置：演示卡在标题之前 */
  const order = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="演示账号"]');
    const h2 = [...document.querySelectorAll("h2")].find((x) => /刷题进度/.test(x.textContent ?? ""));
    if (!section) return "缺卡片";
    if (!h2) return "缺标题";
    // DOCUMENT_POSITION_FOLLOWING === 4：h2 排在 section 之后
    return section.compareDocumentPosition(h2) & 4 ? "card-first" : "h2-first";
  });
  check("演示卡排在标题之前（先看到账号）", order === "card-first", order);

  /* 3. 切页签时演示卡让位（还在未登录态，先测这个） */
  const tabHit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "注册");
    if (btn instanceof HTMLElement) {
      btn.click();
      return true;
    }
    return false;
  });
  await sleep(700);
  const goneOnRegister = await page.evaluate(() => !document.querySelector('section[aria-label="演示账号"]'));
  check("切到「注册」时演示卡收起", tabHit && goneOnRegister, goneOnRegister ? "已收起" : "仍显示");
  await page.screenshot({ path: `${SHOTS}/register-tab.png` });

  /* 4. 390 宽下不溢出（切回登录页签再量） */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "登录");
    if (btn instanceof HTMLElement) btn.click();
  });
  await sleep(500);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  const overflow = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="演示账号"]');
    if (!section) return "缺卡片";
    const r = section.getBoundingClientRect();
    const docW = document.documentElement.clientWidth;
    return r.right > docW + 1 || r.left < -1 ? `溢出 right=${Math.round(r.right)} vw=${docW}` : "ok";
  });
  check("390 宽下演示卡不溢出", overflow === "ok", overflow);
  await page.screenshot({ path: `${SHOTS}/mobile-390.png` });
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(300);

  /* 5. 点一下就进去 */
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {}),
    page.click('section[aria-label="演示账号"] button'),
  ]);
  for (let i = 0; i < 25 && page.url().includes("/login"); i += 1) await sleep(600);
  check("点一下已离开登录页", !page.url().includes("/login"), page.url().replace(BASE, "") || "/");

  const nav = await page.evaluate(() =>
    [...document.querySelectorAll("header a, nav a")].map((a) => (a.textContent ?? "").trim()),
  );
  check(
    "落地页是站内（有导航入口）",
    nav.some((t) => /背单词|生词本|闯关/.test(t)),
    nav.slice(0, 6).join(" / "),
  );
  await page.screenshot({ path: `${SHOTS}/after-one-click.png` });

  /* 6. 会话真的立起来了：受保护页面不再踢回登录 */
  await page.goto(`${withShare("/study")}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1500);
  const study = await page.evaluate(() => ({
    url: location.pathname,
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
  }));
  check(
    "登录态生效（/study 可进）",
    study.url === "/study" && study.h1 === "背单词",
    `${study.url} h1=${study.h1}`,
  );

  check("全程无 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "无");

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n通过 ${passed}/${results.length}`);
  process.exit(passed === results.length ? 0 : 1);
} finally {
  await browser.close();
}
