/**
 * 线上抽查：发布后的站点是否真的带上了「我的 → 忘记当前密码」。
 *
 * 只看不写：登录演示账号 → 打开 /profile → 点开面板 → 确认表单在。
 * 刻意**不发验证码、不改密码**，避免在线上库留下测试数据。
 *
 * 用法：
 *   LIVE_BASE=https://… SHARE_CODE=XXXX node scripts/check-live-forgot.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = (process.env.LIVE_BASE ?? "").replace(/\/$/, "");
const SHARE = process.env.SHARE_CODE ?? "";
const SHOTS = process.env.SHOT_DIR ?? "shots/live-forgot";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@cet.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;

if (!BASE) {
  console.error("缺少 LIVE_BASE");
  process.exit(1);
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // 线上网关对浏览器 HTTP/2 连接偶发直接掐断，关掉后稳定
  args: ["--no-sandbox", "--disable-http2"],
  defaultViewport: { width: 1280, height: 1000 },
});

try {
  const page = await browser.newPage();
  // 真监听，不能只声明一个空数组然后断言它为空 —— 那样这条永远绿
  const jsErrors = [];
  page.on("pageerror", (e) =>
    jsErrors.push(`${page.url().replace(BASE, "") || "/"} :: ${String(e.message).slice(0, 120)}`),
  );
  const fillInto = async (selector, text) => {
    await page.click(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, text, { delay: 12 });
  };

  /*
   * 线上首屏水合实测十几到二十几秒，而且网关偶尔会掐断浏览器连接
   * （控制台里是 ERR_CONNECTION_CLOSED），那一轮的 JS chunk 就没加载完，
   * React 永远不水合、submit 按钮一直 disabled。重载一轮通常就好，
   * 所以这里最多试 4 轮 —— 这是环境问题，不是产品缺陷。
   */
  let ready = false;
  for (let attempt = 1; attempt <= 4 && !ready; attempt += 1) {
    try {
      await page.goto(withShare("/login"), { waitUntil: "domcontentloaded", timeout: 90000 });
      for (let i = 0; i < 70; i += 1) {
        await sleep(1000);
        /*
         * 水合完成的标志是「登录」这个 submit 按钮不再 disabled —— 它在水合前是禁用的
         * （防止首屏未挂载时提交把密码拼进地址栏）。
         * 别拿「忘记密码？」当锚点：那颗是普通按钮，从头到尾都不 disabled，
         * 它一出现就当作可交互，会在水合未完成时去填表，回车提交被丢弃，
         * 表现成「点了登录没反应」，看着像账号密码错了。
         */
        ready = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button[type="submit"]')].find(
            (b) => (b.textContent ?? "").trim() === "登录",
          );
          return btn instanceof HTMLElement && !btn.disabled;
        });
        if (ready) break;
      }
      if (!ready) console.log(`   （第 ${attempt} 轮页面未水合，重载再试）`);
    } catch (e) {
      console.log(`   （第 ${attempt} 轮打开失败：${String(e.message).slice(0, 60)}）`);
      await sleep(2000);
    }
  }
  check("线上登录页可交互", ready, ready ? "表单已水合" : "4 轮仍未就绪");

  const loginEntry = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "忘记密码？",
    );
    return Boolean(btn);
  });
  check("线上登录页仍有「忘记密码？」", loginEntry, loginEntry ? "在" : "不在");

  await fillInto("#login-email", DEMO_EMAIL);
  await fillInto("#login-password", DEMO_PASSWORD);
  await sleep(300);
  await page.keyboard.press("Enter");

  let entered = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    if (!page.url().includes("/login")) {
      entered = true;
      break;
    }
  }
  check("演示账号能登录线上", entered, entered ? "已进入站内" : "停在登录页");

  await page.goto(withShare("/profile"), { waitUntil: "domcontentloaded", timeout: 90000 });
  let panelEntry = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    panelEntry = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "忘记当前密码？",
      );
      return btn instanceof HTMLElement && !btn.disabled;
    });
    if (panelEntry) break;
  }
  check("线上「我的」页有「忘记当前密码？」入口", panelEntry, panelEntry ? "已找到" : "未找到");
  await page.screenshot({ path: `${SHOTS}/01-live-profile.png` });

  if (panelEntry) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "忘记当前密码？",
      );
      if (btn instanceof HTMLElement) btn.click();
    });
    let opened = false;
    for (let i = 0; i < 30; i += 1) {
      await sleep(500);
      opened = await page.evaluate(() => {
        const box = document.querySelector('[data-view="forgot"]');
        const email = box?.querySelector('input[name="resetEmail"]');
        const send = [...(box?.querySelectorAll("button") ?? [])].some(
          (b) => (b.textContent ?? "").trim() === "发送验证码",
        );
        return Boolean(box) && Boolean(email) && send;
      });
      if (opened) break;
    }
    check("线上点开能找到验证码表单（只检查，不发码）", opened, opened ? "表单已就位" : "没展开");
    await page.screenshot({ path: `${SHOTS}/02-live-panel.png` });
  }

  check("抽查过程无 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "无");} finally {
  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== 线上抽查 ${pass}/${results.length} ====`);
  process.exit(pass === results.length ? 0 : 1);
}
