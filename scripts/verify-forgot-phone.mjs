/**
 * 验收：忘记密码的「手机号」通道。
 *
 * 被验的是这一屏原来的缺陷：找回密码只有邮箱一条路。本站有一批账号只有手机号、
 * 没有可收信的邮箱（138…@phone.local 是合成地址），对这些人等于没有找回功能。
 *
 * 断言分三层：
 *   A. 页面结构：「我的 → 忘记当前密码」和登录页「忘记密码？」都要有两个渠道，
 *      已绑手机号时默认停在短信、号码只读且就是账号那个号；切到邮箱能拿到邮箱表单。
 *   B. 未绑手机号的账号：短信 tab 给「去绑定手机号」，不是让人对着发不出去的码干等。
 *   C. 接口防护：/api/auth/reset-password-phone 不能在验身份之前泄露任何东西 ——
 *      密码强度先判、伪造 token 拒绝、缺参数拒绝、限流生效。
 *
 * 短信真的发出去这一段**不在自动化范围内**（需要一张能收码的真实卡），
 * 所以这里不点「发送验证码」，只验到「点了会发生什么」的前置条件。这一点在报告里如实写明。
 *
 * 用法（先起一个本地实例）：
 *   BASE=http://127.0.0.1:3100 node scripts/verify-forgot-phone.mjs
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE ?? process.env.LOCAL_BASE ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const SHOT_DIR = process.env.SHOT_DIR ?? "shots/forgot-phone";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOT_DIR, { recursive: true });

const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const EMAIL_A = `forgetphone-${stamp}@qq.com`;
const EMAIL_B = `forgetphone-b-${stamp}@qq.com`;
const OLD_PASSWORD = "oldpass123";
const WITH_PHONE = `138${String(Date.now()).slice(-8)}`;

console.log(`目标：${BASE}`);
console.log(`有手机号账号：${EMAIL_A} / ${WITH_PHONE}`);
console.log(`无手机号账号：${EMAIL_B}\n`);

async function ensureAccount(email, password, phone) {
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "忘记密码手机号验收" }),
  });
  if (!reg.ok) {
    const body = await reg.text();
    throw new Error(`注册 ${email} 失败：${reg.status} ${body.slice(0, 200)}`);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`注册后库里找不到 ${email}`);
  if (phone) {
    await prisma.user.update({ where: { id: user.id }, data: { phone } });
  }
  return user;
}

/* ---------------- C. 接口防护（不依赖浏览器） ---------------- */
async function probeApi() {
  const post = (body) =>
    fetch(`${BASE}/api/auth/reset-password-phone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // 1. 弱密码：必须在验身份之前被拦下（否则用户改三次格式就废掉一次验证）
  const weak = await post({ accessToken: "x".repeat(40), newPassword: "123" });
  const weakBody = await weak.json().catch(() => ({}));
  check(
    "弱密码在验身份前就被拦下",
    weak.status === 400 && /8|字母|数字/.test(String(weakBody?.error?.message ?? weakBody?.message ?? "")),
    `${weak.status} ${String(weakBody?.error?.message ?? weakBody?.message ?? "").slice(0, 40)}`,
  );

  // 2. 伪造 token：不能因为「密码合规」就往下走
  const fake = await post({ accessToken: "x".repeat(40), newPassword: "abc12345" });
  const fakeBody = await fake.json().catch(() => ({}));
  check(
    "伪造 accessToken 被云端身份校验拒绝",
    fake.status === 400,
    `${fake.status} ${String(fakeBody?.error?.message ?? fakeBody?.message ?? "").slice(0, 60)}`,
  );

  // 3. 缺参数：zod 直接拒，不进业务逻辑
  const empty = await post({});
  check("缺参数被拒", empty.status >= 400 && empty.status < 500, `${empty.status}`);

  // 4. 限流：前 3 次已用掉 3 个额度（窗口 60s / 5 次），再打 3 次，第 3 次应 429
  let last = 0;
  for (let i = 0; i < 3; i += 1) {
    const res = await post({ accessToken: "x".repeat(40), newPassword: "abc12345" });
    last = res.status;
    if (res.status === 429) break;
  }
  check("超过 5 次/分钟触发限流", last === 429, `最后一次 ${last}`);
}

/* ---------------- 浏览器辅助 ---------------- */
async function openBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    defaultViewport: { width: 1280, height: 1400 },
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,1400"],
  });
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  const form = await page.waitForSelector("#login-email", { timeout: 45_000 }).catch(() => null);
  if (!form) throw new Error(`/login 上没有登录表单，当前地址：${page.url()}`);
  // 水合锚点用 submit 按钮的 disabled：首屏 SSR 就有一个可点的 form，水合前回车会被吞
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return Boolean(btn) && !btn.disabled;
  }, { timeout: 90_000 });
  await page.click("#login-email", { clickCount: 3 });
  await page.type("#login-email", email, { delay: 5 });
  await page.click("#login-password", { clickCount: 3 });
  await page.type("#login-password", password, { delay: 5 });
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 90_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function clickByText(page, text) {
  const hit = await page.evaluate((needle) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(needle));
    if (!el) return false;
    el.click();
    return true;
  }, text);
  return hit;
}

/**
 * 打开找回面板。
 *
 * 不用「点一次就断言」：首屏是服务端直出的，「忘记当前密码？」这个 button 在水合完成前
 * 就在 DOM 里了，此时 el.click() 只会触发原生行为，React 的 onClick 还没挂上 ——
 * 表现就是点了没反应。所以轮询点到面板真的出现为止（水合完成后第一次点就会生效）。
 */
async function openForgot(page) {
  for (let i = 0; i < 60; i += 1) {
    if (await page.$('[data-view="forgot"]')) return;
    await clickByText(page, "忘记当前密码");
    await sleep(500);
  }
  throw new Error("点了「忘记当前密码？」但找回面板始终没有出现");
}

/* ---------------- A / B. 页面结构 ---------------- */
async function verifyProfileWithPhone(browser) {
  /* 每个场景一个独立 context：登录态存在 cookie 里，共用 context 时
   * 第二个账号访问 /login 会被「已登录」直接重定向走，拿不到登录表单。 */
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await login(page, EMAIL_A, OLD_PASSWORD);
  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
  const landed = await page.evaluate(() => location.pathname);
  check("登录后能进「我的」页", landed.startsWith("/profile"), landed);
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("忘记当前密码"),
    );
    return Boolean(btn);
  }, { timeout: 60_000 });
  await openForgot(page);
  await sleep(300);

  const tabs = await page.$$eval('[data-view="forgot"] [role="tab"]', (els) =>
    els.map((el) => ({ channel: el.getAttribute("data-channel"), selected: el.getAttribute("aria-selected") })),
  );
  check(
    "我的页找回面板有「短信 / 邮箱」两个渠道",
    tabs.length === 2 && tabs.some((t) => t.channel === "phone") && tabs.some((t) => t.channel === "email"),
    tabs.map((t) => t.channel).join(","),
  );
  check(
    "已绑手机号时默认停在短信渠道",
    tabs.find((t) => t.channel === "phone")?.selected === "true",
    JSON.stringify(tabs),
  );

  const phoneInput = await page.$eval('[data-view="forgot"] input[name="resetPhone"]', (el) => ({
    value: el.value,
    readOnly: el.readOnly,
  })).catch(() => null);
  check(
    "号码锁定为账号自己的手机号（只读、不可改成别人的）",
    phoneInput?.readOnly === true && phoneInput?.value === WITH_PHONE,
    JSON.stringify(phoneInput),
  );

  const phoneFields = await page.$$eval('[data-view="forgot"] input[name]', (els) =>
    els.map((el) => el.getAttribute("name")),
  );
  check(
    "短信渠道给出验证码与新密码三个输入位",
    ["resetPhoneCode", "resetPhoneNewPassword", "resetPhoneConfirm"].every((n) => phoneFields.includes(n)),
    phoneFields.join(","),
  );

  await page.screenshot({ path: `${SHOT_DIR}/profile-phone-tab.png`, fullPage: false });

  // 切到邮箱：表单换成邮箱路径
  /*
   * 用 DOM 直接 click，不用 page.click()。
   *
   * page.click 是按坐标点：这个面板在页面下半部，scrollIntoView 之后，
   * 滚动定位可能把按钮顶到吸顶导航下面，坐标就点在导航上了 —— 表现为
   * 「点击没报错但状态没变」。el.click() 直接派发事件，不受遮挡影响。
   */
  await page.$eval('[data-view="forgot"] [data-channel="email"]', (el) => el.click());
  const emailFieldAppeared = await page
    .waitForSelector('[data-view="forgot"] input[name="resetEmail"]', { timeout: 15_000 })
    .catch(() => null);
  if (!emailFieldAppeared) {
    const snapshot = await page.$eval('[data-view="forgot"]', (el) => el.textContent ?? "");
    console.log(`  诊断：切换后面板内容 → ${snapshot.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  const emailInput = await page.$eval('[data-view="forgot"] input[name="resetEmail"]', (el) => ({
    value: el.value,
    readOnly: el.readOnly,
  })).catch(() => null);
  check(
    "切到邮箱渠道后是原来的邮箱表单（邮箱只读）",
    emailInput?.readOnly === true && emailInput?.value === EMAIL_A,
    JSON.stringify(emailInput),
  );
  const phoneGone = (await page.$('[data-view="forgot"] input[name="resetPhone"]')) === null;
  check("切换渠道后短信表单收起（不叠加两层）", phoneGone);

  await page.screenshot({ path: `${SHOT_DIR}/profile-email-tab.png`, fullPage: false });
  check("我的页手机号找回流程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
  await ctx.close();
}

async function verifyProfileWithoutPhone(browser) {
  /* 每个场景一个独立 context：登录态存在 cookie 里，共用 context 时
   * 第二个账号访问 /login 会被「已登录」直接重定向走，拿不到登录表单。 */
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await login(page, EMAIL_B, OLD_PASSWORD);
  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("忘记当前密码"),
    );
    return Boolean(btn);
  }, { timeout: 60_000 });
  await openForgot(page);
  await sleep(300);

  /*
   * 未绑手机号的账号，面板默认要停在邮箱上 —— 手机号那条路根本走不通，
   * 默认停在它上面，等于让人先看到一句「发不出去」再自己找切换。
   */
  const defaultTab = await page.$eval('[data-view="forgot"] [role="tab"][aria-selected="true"]', (el) =>
    el.getAttribute("data-channel"),
  );
  check("未绑手机号时默认停在邮箱渠道", defaultTab === "email", String(defaultTab));

  // 主动切到短信：必须给「去绑定手机号」，而不是一个发不出去的码
  await page.$eval('[data-view="forgot"] [data-channel="phone"]', (el) => el.click());
  await page
    .waitForFunction(() => {
      const el = document.querySelector('[data-view="forgot"]');
      return Boolean(el) && (el.textContent ?? "").includes("还没绑手机号");
    }, { timeout: 15_000 })
    .catch(() => null);

  const body = await page.$eval('[data-view="forgot"]', (el) => el.textContent ?? "");
  check(
    "未绑手机号时给「去绑定手机号」而不是发不出去的码",
    body.includes("还没绑手机号") && body.includes("去绑定手机号"),
    body.slice(0, 60).replace(/\s+/g, " "),
  );
  const hasBindBtn = await page.evaluate(() =>
    [...document.querySelectorAll('[data-view="forgot"] button')].some((b) =>
      b.textContent?.includes("去绑定手机号"),
    ),
  );
  check("「去绑定手机号」是可点的按钮", hasBindBtn);

  await page.screenshot({ path: `${SHOT_DIR}/profile-no-phone.png`, fullPage: false });
  await page.close();
  await ctx.close();
}

async function verifyLoginPage(browser) {
  /* 每个场景一个独立 context：登录态存在 cookie 里，共用 context 时
   * 第二个账号访问 /login 会被「已登录」直接重定向走，拿不到登录表单。 */
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    return Boolean(btn) && !btn.disabled;
  }, { timeout: 90_000 });
  await clickByText(page, "忘记密码");
  await page.waitForSelector('[data-view="reset"]', { timeout: 30_000 });
  await sleep(300);

  const tabs = await page.$$eval('[data-view="reset"] [role="tab"]', (els) =>
    els.map((el) => ({ channel: el.getAttribute("data-channel"), selected: el.getAttribute("aria-selected") })),
  );
  check(
    "登录页「忘记密码」也有手机号 / 邮箱两个渠道",
    tabs.length === 2 && tabs.some((t) => t.channel === "phone") && tabs.some((t) => t.channel === "email"),
    tabs.map((t) => t.channel).join(","),
  );
  check(
    "登录页默认停在手机号（本站主要进门方式）",
    tabs.find((t) => t.channel === "phone")?.selected === "true",
    JSON.stringify(tabs),
  );

  const editable = await page.$eval('[data-view="reset"] input[name="resetPhone"]', (el) => ({
    readOnly: el.readOnly,
    type: el.getAttribute("type"),
  })).catch(() => null);
  check(
    "登录页号码可手输（还没登录，站里不知道是谁）",
    editable?.readOnly === false,
    JSON.stringify(editable),
  );

  const hasSend = await page.evaluate(() =>
    [...document.querySelectorAll('[data-view="reset"] button')].some((b) =>
      b.textContent?.includes("获取验证码"),
    ),
  );
  check("登录页手机渠道有「获取验证码」", hasSend);

  await page.screenshot({ path: `${SHOT_DIR}/login-phone-tab.png`, fullPage: false });

  await page.$eval('[data-view="reset"] [data-channel="email"]', (el) => el.click());
  await sleep(200);
  const emailField = await page.$('[data-view="reset"] input[name="email"]');
  check("切到邮箱后仍是原来的邮箱重置表单", Boolean(emailField));

  check("登录页重置流程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));
  await page.close();
  await ctx.close();
}

/* ---------------- 跑 ---------------- */
(async () => {
  try {
    await ensureAccount(EMAIL_A, OLD_PASSWORD, WITH_PHONE);
    await ensureAccount(EMAIL_B, OLD_PASSWORD, null);

    await probeApi();

    const browser = await openBrowser();
    try {
      await verifyProfileWithPhone(browser);
      await verifyProfileWithoutPhone(browser);
      await verifyLoginPage(browser);
    } finally {
      await browser.close();
    }
  } catch (err) {
    check("脚本执行", false, err instanceof Error ? err.message : String(err));
  } finally {
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) {
    console.log("未通过：");
    for (const f of failed) console.log(` - ${f.name}${f.detail ? `：${f.detail}` : ""}`);
  }
  process.exit(failed.length ? 1 : 0);
})();
