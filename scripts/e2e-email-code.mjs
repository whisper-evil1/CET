/**
 * 邮箱验证码全流程验收（真实浏览器）。
 *
 * 覆盖的不只是「接口通了」，而是用户在页面上会遇到的每一次判断：
 *   1. 邮箱格式不对 → 失焦当场给中文提示（不是浏览器的英文气泡）；
 *   2. 域名不在白名单 → 明确说「收不到验证码」；
 *   3. 发码 → 页面显示验证码（未配邮件服务走控制台回显）；
 *   4. 用验证码注册 → 自动登录，离开 /login；
 *   5. 退出后用「验证码登录」重登；
 *   6. 输错验证码 → 页面给可读的失败原因，改对后能进。
 *
 * 前置：服务端没配 RESEND_API_KEY（否则码走邮箱，页面不显示，脚本读不到）。
 *
 * 用法：BASE_URL=http://127.0.0.1:3201 node scripts/e2e-email-code.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const pass = [];
const fail = [];
const rec = (name, ok, detail = "") => {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** 按可见文字点按钮（页面上没有 id/class 可依赖，文字是最稳的锚） */
async function clickText(text, tag = "button") {
  return page.evaluate(
    (t, tg) => {
      const nodes = [...document.querySelectorAll(tg)];
      const hit = nodes.find((n) => (n.textContent || "").trim().includes(t));
      if (!hit) return false;
      hit.click();
      return true;
    },
    text,
    tag,
  );
}

/** hydration 完成前输入会被 React 重置，先等一拍再写 */
async function fill(selector, value) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector);
  await page.type(selector, value, { delay: 12 });
}

async function readNote() {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    const hit = text.match(/本次验证码：(\d{6})/);
    return hit ? hit[1] : "";
  });
}

async function waitFor(fn, timeout = 15000, step = 250) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

const email = `code_${Date.now()}@qq.com`;
const password = "Passw0rd!";

/* ---------------- 1. 注册流程 ---------------- */
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await sleep(900);
await clickText("注册");
await sleep(300);
rec("切到注册页", (await page.evaluate(() => document.body.innerText)).includes("创建一个账号"));

// 1a. 格式不对的邮箱
await fill('input[type="email"]', "abc@qq");
await page.evaluate(() => document.querySelector('input[type="email"]')?.blur());
await sleep(250);
const issueA = await page.evaluate(() => document.getElementById("email-issue")?.innerText || "");
rec("[格式] 缺顶级域名时当场提示", /域名/.test(issueA), issueA);

// 1b. 非白名单域名
await fill('input[type="email"]', "abc@example.com");
await page.evaluate(() => document.querySelector('input[type="email"]')?.blur());
await sleep(250);
const issueB = await page.evaluate(() => document.getElementById("email-issue")?.innerText || "");
rec("[格式] 域名不在白名单时给出原因", /收不到验证码/.test(issueB), issueB);

// 1c. 合法邮箱 → 发码
await fill('input[type="email"]', email);
await page.evaluate(() => document.querySelector('input[type="email"]')?.blur());
await sleep(200);
const issueC = await page.evaluate(() => document.getElementById("email-issue")?.innerText || "");
rec("[格式] 合法邮箱不再报错", issueC === "", issueC);

await clickText("发送验证码");
const code = await waitFor(readNote, 12000);
rec("点发送后页面显示验证码（未配邮件服务的回显）", Boolean(code), code || "未读到");

// 冷却按钮文案
const cooling = await page.evaluate(() =>
  [...document.querySelectorAll("button")].some((b) => /\d+s 后重发/.test(b.textContent || "")),
);
rec("发送后按钮进入倒计时", cooling);

// 1d. 填码 + 密码，完成注册
await fill('input[placeholder="6 位数字"]', "000000");
await fill('input[type="password"]', password);
await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
await sleep(1200);
// 错码必须被拒，且留在登录页
const stillLogin = page.url().includes("/login");
rec("错误的验证码被拒、仍停在登录页", stillLogin, page.url().replace(BASE, ""));
const errText = await page.evaluate(() => document.body.innerText);
// 注意别用「包含『验证码』」这种宽松断言：页面副标题里就有「邮箱验证码 + 密码」，
// 那样写永远为真。这里只认服务端返回的三种失败原因。
rec("错码提示可读", /验证码不对|还能再试|错误次数过多|已过期/.test(errText), (errText.match(/验证码不对[^\n]{0,20}/) || [""])[0]);

await fill('input[placeholder="6 位数字"]', code);
await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
const leftLogin = await waitFor(async () => !page.url().includes("/login"), 20000);
rec("正确的验证码可以完成注册并自动登录", Boolean(leftLogin), page.url().replace(BASE, "") || "/");

/* ---------------- 2. 退出后验证码登录 ---------------- */
await page.evaluate(() => fetch("/api/logout", { method: "POST" }).catch(() => {}));
await sleep(600);
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await sleep(900);
rec("退出后回到登录页", page.url().includes("/login"));

await clickText("验证码登录");
await sleep(300);
const hasCodeField = await page.evaluate(() => Boolean(document.querySelector('input[placeholder="6 位数字"]')));
rec("验证码登录模式下没有密码框、有验证码框", hasCodeField && !(await page.evaluate(() => Boolean(document.querySelector('input[type="password"]')))));

await fill('input[type="email"]', email);
await clickText("发送验证码");
const loginCode = await waitFor(readNote, 12000);
rec("登录用途也能发码", Boolean(loginCode), loginCode || "未读到");

if (loginCode) {
  await fill('input[placeholder="6 位数字"]', loginCode);
  await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
  const relogin = await waitFor(async () => !page.url().includes("/login"), 20000);
  rec("验证码登录成功", Boolean(relogin), page.url().replace(BASE, "") || "/");
}

/* ---------------- 3. 小屏没有横向溢出 ---------------- */
await page.evaluate(() => fetch("/api/logout", { method: "POST" }).catch(() => {}));
await sleep(500);
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await sleep(700);
await clickText("注册");
await sleep(300);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
rec("[390] 注册表单无横向溢出", overflow <= 1, `${overflow}px`);

rec("无 JS 运行时错误", errors.length === 0, errors[0] ?? "");

await browser.close();
console.log(`\n结果：PASS ${pass.length} / FAIL ${fail.length}`);
process.exit(fail.length === 0 ? 0 : 1);
