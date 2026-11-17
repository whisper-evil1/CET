/**
 * 验收：「我的 → 修改密码」里的「忘记当前密码」通道。
 *
 * 被验的是这一屏原来的缺陷：改密码要求填当前密码（对），但人一旦忘了旧密码，
 * 这个页面就没有任何出口，只能退出登录、去登录页重走一遍忘记密码。
 *
 * 断言分两层：
 *   A. 常规账号：入口在「当前密码」旁边 → 面板邮箱锁定当前账号 → 发码 → 改密码 →
 *      新密码能登录、旧密码不能登录；
 *   B. 手机号占位账号（假邮箱，收不到信）：面板要给出「去绑定邮箱」，
 *      而不是让人对着发不出去的验证码干等。
 *
 * 用法（本地起实例后）：
 *   BASE=http://127.0.0.1:3055 node scripts/verify-forgot-in-profile.mjs
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = (
  process.env.LIVE_BASE ??
  process.env.BASE ??
  process.env.LOCAL_BASE ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");
const SHARE = process.env.SHARE_CODE ?? "";
const SHOTS = process.env.SHOT_DIR ?? "shots/forgot-in-profile";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now().toString(36);
const EMAIL = `forgotui-${stamp}@qq.com`;
/* 占位账号：注册接口只收白名单域名，所以先用 qq 邮箱注册，
 * 再把 email 改成 @phone.local —— 这正是「手机号登录」账号在库里的样子。 */
const PHONE_EMAIL = `forgotui-${stamp}@phone.local`;
const OLD_PASSWORD = "oldpass123";
const NEW_PASSWORD = "newpass456";

console.log(`目标：${BASE}`);
console.log(`常规账号：${EMAIL}`);
console.log(`占位账号：${PHONE_EMAIL}\n`);

const prisma = new PrismaClient();

/* 前置：两个账号都先用接口注册好（注册本身不是这份脚本的验收对象） */
for (const email of [EMAIL]) {
  const reg = await fetch(withShare("/api/auth/register"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: OLD_PASSWORD, name: "忘密码测试" }),
  }).then((r) => r.json());
  if (reg?.code !== 0) {
    console.error(`前置注册失败：${reg?.message ?? "未知"}，脚本无法继续`);
    process.exit(1);
  }
}
{
  const reg = await fetch(withShare("/api/auth/register"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `forgotphone-${stamp}@qq.com`, password: OLD_PASSWORD, name: "占位测试" }),
  }).then((r) => r.json());
  if (reg?.code !== 0) {
    console.error(`前置注册（占位账号）失败：${reg?.message ?? "未知"}，脚本无法继续`);
    process.exit(1);
  }
  await prisma.user.update({
    where: { email: `forgotphone-${stamp}@qq.com` },
    data: { email: PHONE_EMAIL },
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-http2"],
  defaultViewport: { width: 1280, height: 1000 },
});

try {
  const page = await browser.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) =>
    jsErrors.push(`${page.url().replace(BASE, "") || "/"} :: ${String(e.message).slice(0, 120)}`),
  );

  /**
   * 填值走真实键盘。
   * 程序化赋值（三击清空 / 原生 setter）在 React 受控输入上都踩过坑：
   * DOM 上是新值，提交出去的却是旧值 —— 之前验收因此假红过两次。
   */
  const fillInto = async (selector, text) => {
    await page.click(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(selector, text, { delay: 12 });
  };

  /** 登录。返回是否成功离开登录页 */
  const login = async (email, password) => {
    await page.goto(withShare("/login"), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('section[aria-label="演示账号"] button:not([disabled])', {
      timeout: 90000,
    });
    // localStorage 里的上一次邮箱是在 effect 里回填的，等它落地再动输入框
    await sleep(500);
    await fillInto("#login-email", email);
    await fillInto("#login-password", password);
    await sleep(200);
    await page.keyboard.press("Enter");

    let left = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      if (!page.url().includes("/login")) {
        left = true;
        break;
      }
    }
    return left;
  };

  /** 点一个按钮，最多试 3 次（首屏水合没完成时点击会被丢弃） */
  const clickText = async (text, scope = "body") => {
    for (let i = 0; i < 3; i += 1) {
      const hit = await page.evaluate(
        (t, sel) => {
          const root = document.querySelector(sel) ?? document.body;
          const btn = [...root.querySelectorAll("button")].find(
            (b) => (b.textContent ?? "").trim() === t,
          );
          if (btn instanceof HTMLElement && !btn.disabled) {
            btn.click();
            return true;
          }
          return false;
        },
        text,
        scope,
      );
      if (hit) return true;
      await sleep(600);
    }
    return false;
  };

  const clearCookies = async () => {
    const cdp = await page.createCDPSession();
    await cdp.send("Network.clearBrowserCookies");
    await cdp.detach();
  };

  /* ────────────────── A. 常规账号 ────────────────── */

  const loggedIn = await login(EMAIL, OLD_PASSWORD);
  check("测试账号能登录", loggedIn, loggedIn ? "已进入站内" : "停在登录页");

  await page.goto(withShare("/profile"), { waitUntil: "domcontentloaded", timeout: 60000 });
  let profileReady = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    profileReady = await page.evaluate(() => Boolean(document.querySelector("#login-password") === null));
    if (profileReady) break;
  }
  await sleep(1200);

  const formView = await page.evaluate(() => {
    const h3 = [...document.querySelectorAll("h3")].map((e) => (e.textContent ?? "").trim());
    const cur = document.querySelector('input[placeholder="当前密码"]');
    const forgotBtn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "忘记当前密码？",
    );
    return {
      h3,
      hasCurrent: Boolean(cur),
      hasForgot: Boolean(forgotBtn),
    };
  });
  check("改密码区有「当前密码」输入框", formView.hasCurrent, formView.hasCurrent ? "已找到" : "没找到");
  check("「当前密码」旁边有「忘记当前密码？」入口", formView.hasForgot, formView.hasForgot ? "已找到" : "没找到");
  await page.screenshot({ path: `${SHOTS}/01-profile.png` });

  const opened = await clickText("忘记当前密码？");
  let panel = { shown: false };
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);
    panel = await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      const emailInput = box?.querySelector('input[name="resetEmail"]');
      const curStill = Boolean(document.querySelector('input[placeholder="当前密码"]'));
      return {
        shown: Boolean(box),
        email: emailInput instanceof HTMLInputElement ? emailInput.value : "",
        readOnly: emailInput instanceof HTMLInputElement ? emailInput.readOnly : false,
        formReplaced: !curStill,
      };
    });
    if (panel.shown) break;
  }
  check("点入口能打开找回面板", opened && panel.shown, panel.shown ? "已展开" : "没展开");
  check("面板邮箱锁定为当前账号", panel.email === EMAIL, panel.email || "空");
  check("面板邮箱不可改成别人的地址", panel.readOnly, panel.readOnly ? "只读" : "可编辑");
  check(
    "打开面板时改密码表单让位（不叠两个表单）",
    panel.formReplaced,
    panel.formReplaced ? "已替换" : "两个都在",
  );
  await page.screenshot({ path: `${SHOTS}/02-forgot-panel.png` });

  /* 发码 */
  const sentOk = await clickText("发送验证码");
  let devCode = "";
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    devCode = await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      const btn = [...(box?.querySelectorAll("button") ?? [])].find((b) =>
        (b.textContent ?? "").includes("当前环境没接邮件服务"),
      );
      if (!btn) return "";
      const m = (btn.textContent ?? "").match(/\b(\d{6})\b/);
      return m ? m[1] : "";
    });
    if (devCode) break;
  }
  check("发码成功（未配邮件服务时页面显示验证码）", sentOk && devCode.length === 6, devCode || "没拿到");

  /* 点验证码块填入 */
  if (devCode) {
    await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      const btn = [...(box?.querySelectorAll("button") ?? [])].find((b) =>
        (b.textContent ?? "").includes("当前环境没接邮件服务"),
      );
      if (btn instanceof HTMLElement) btn.click();
    });
    await sleep(400);
  }
  const codeValue = await page.$eval('[data-view="forgot"] input[name="resetCode"]', (el) => el.value);
  check("点验证码能自动填入", codeValue === devCode && codeValue.length === 6, codeValue || "空");

  /* 弱密码要被拦下，且不能消耗掉验证码 */
  await fillInto('[data-view="forgot"] input[name="resetNewPassword"]', "abc");
  await fillInto('[data-view="forgot"] input[name="resetConfirm"]', "abc");
  await clickText("改密码", '[data-view="forgot"]');
  let weakMsg = "";
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);
    weakMsg = await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      const err = box?.querySelector(".text-wrong");
      return (err?.textContent ?? "").trim();
    });
    if (weakMsg) break;
  }
  check("弱密码被拦下", weakMsg.includes("至少 8 位") || weakMsg.includes("字母"), weakMsg || "没有提示");

  /* 换成合规密码，同一枚码应当仍然有效 */
  await fillInto('[data-view="forgot"] input[name="resetNewPassword"]', NEW_PASSWORD);
  await fillInto('[data-view="forgot"] input[name="resetConfirm"]', NEW_PASSWORD);
  await clickText("改密码", '[data-view="forgot"]');
  let changed = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(400);
    changed = await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      return Boolean(box && (box.textContent ?? "").includes("密码已改好"));
    });
    if (changed) break;
  }
  check("验证码有效时改密码成功", changed, changed ? "已提示已改好" : "没成功");
  await page.screenshot({ path: `${SHOTS}/03-changed.png` });

  /* 关掉面板，回到改密码表单 */
  await clickText("知道了", '[data-view="forgot"]');
  let closed = false;
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);
    closed = await page.evaluate(() => !document.querySelector('[data-view="forgot"]'));
    if (closed) break;
  }
  check("点「知道了」收起面板", closed, closed ? "已收起" : "仍在");

  /* 新密码真的生效 */
  await clearCookies();
  const newOk = await login(EMAIL, NEW_PASSWORD);
  check("清掉会话后用新密码能登录", newOk, newOk ? "已进入站内" : "停在登录页");

  /* 旧密码必须失效 */
  await clearCookies();
  const oldOk = await login(EMAIL, OLD_PASSWORD);
  check("旧密码不能再登录", !oldOk, oldOk ? "旧密码竟然还能进" : "被拒（符合预期）");

  /* ────────────────── B. 手机号占位账号 ────────────────── */

  await clearCookies();
  const phoneLogin = await login(PHONE_EMAIL, OLD_PASSWORD);
  check("占位账号能登录（前置）", phoneLogin, phoneLogin ? "已进入站内" : "停在登录页");

  await page.goto(withShare("/profile"), { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  await clickText("忘记当前密码？");
  let phonePanel = { shown: false };
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);
    phonePanel = await page.evaluate(() => {
      const box = document.querySelector('[data-view="forgot"]');
      const text = box?.textContent ?? "";
      return {
        shown: Boolean(box),
        bindable: text.includes("去绑定邮箱"),
        hasSend: [...(box?.querySelectorAll("button") ?? [])].some(
          (b) => (b.textContent ?? "").trim() === "发送验证码",
        ),
        mentionNoMail: text.includes("验证码发不出去"),
      };
    });
    if (phonePanel.shown) break;
  }
  check("占位账号打开找回面板", phonePanel.shown, phonePanel.shown ? "已展开" : "没展开");

  /*
   * 占位账号的邮箱是合成的（138…@phone.local），收不到信 ——
   * 所以面板默认不该停在邮箱那一侧，否则一进来就是一句「发不出去」。
   */
  const phoneDefault = await page.$eval(
    '[data-view="forgot"] [role="tab"][aria-selected="true"]',
    (el) => el.getAttribute("data-channel"),
  );
  check("占位账号默认停在短信渠道", phoneDefault === "phone", String(phoneDefault));

  // 主动切到邮箱：必须给「去绑定邮箱」，而不是让人对着发不出去的码空等
  await page.$eval('[data-view="forgot"] [data-channel="email"]', (el) => el.click());
  await sleep(400);
  const emailSide = await page.evaluate(() => {
    const box = document.querySelector('[data-view="forgot"]');
    const text = box?.textContent ?? "";
    return {
      bindable: text.includes("去绑定邮箱"),
      hasSend: [...(box?.querySelectorAll("button") ?? [])].some(
        (b) => (b.textContent ?? "").trim() === "发送验证码",
      ),
    };
  });
  check(
    "合成邮箱渠道给出「去绑定邮箱」而不是让人空等验证码",
    emailSide.bindable && !emailSide.hasSend,
    `绑定入口=${emailSide.bindable} 发码按钮=${emailSide.hasSend}`,
  );
  await page.screenshot({ path: `${SHOTS}/04-phone-account.png` });

  /* ────────────────── 收尾 ────────────────── */

  /*
   * 报错按页面归因：首页 / 有一条既有的 React #418（水合文本不一致），
   * 与本功能无关，单独计一条，避免旧账把「找回流程干净」这个结论拖成红叉。
   */
  const flowErrors = jsErrors.filter((e) => !e.startsWith("/ ::"));
  const homeErrors = jsErrors.filter((e) => e.startsWith("/ ::"));
  check(
    "找回流程内无 JS 报错（登录页 / 我的）",
    flowErrors.length === 0,
    flowErrors.slice(0, 2).join(" | ") || "无",
  );
  check(
    "落地首页无 JS 报错（已知遗留 #418，单独计）",
    homeErrors.length === 0,
    homeErrors.length ? homeErrors[0].slice(0, 120) : "无",
  );
} finally {
  await browser.close();

  /* 清理本次测试账号，可重复运行 */
  try {
    for (const email of [EMAIL, PHONE_EMAIL, `forgotphone-${stamp}@qq.com`]) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (!user) continue;
      await prisma.answer.deleteMany({ where: { userId: user.id } });
      await prisma.favorite.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
      console.log(`  （已清理 ${email}）`);
    }
  } catch (e) {
    console.log(`  （清理失败，不影响结论：${e instanceof Error ? e.message : e}）`);
  }
  await prisma.$disconnect();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== 忘记密码（我的页）验收 ${pass}/${results.length} ====`);
  process.exit(pass === results.length ? 0 : 1);
}
