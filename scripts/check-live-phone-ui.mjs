/**
 * 线上验证（真实浏览器）：手机号 + 邮箱双渠道找回密码是否真的到了线上。
 *
 * 走的是免登录路径 —— 打开登录页 → 点「忘记密码？」→ 看渠道切换栏。
 * 不需要任何账号凭据，也不会给任何号码发短信（只读界面结构，不点发码）。
 *
 * 用法：
 *   node scripts/check-live-phone-ui.mjs
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const SHOT_DIR = path.resolve("shots/live-phone");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error("找不到本机 Chrome/Edge，无法做浏览器验收");
  process.exit(2);
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

fs.mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,900"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message ?? e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`${BASE}/login?sharecode=${SC}`, { waitUntil: "domcontentloaded", timeout: 90_000 });

  // 水合锚点：submit 按钮 !disabled（SSR 里就有这个 form，水合前点击会被吞）
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('button[type="submit"]');
      return Boolean(btn) && !btn.disabled;
    },
    { timeout: 120_000 },
  );
  check("线上登录页水合完成", true, "submit 按钮已可交互");

  // 点「忘记密码？」进重置视图
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("忘记密码"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check("登录页存在「忘记密码？」入口", opened);

  if (!opened) throw new Error("入口按钮不存在，后续断言无从谈起");

  await page.waitForSelector('[data-view="reset"]', { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 400));

  const reset = await page.evaluate(() => {
    const root = document.querySelector('[data-view="reset"]');
    if (!root) return null;
    const channels = [...root.querySelectorAll("[data-channel]")].map((el) => ({
      key: el.getAttribute("data-channel"),
      text: (el.textContent ?? "").trim(),
      active: el.getAttribute("aria-selected") === "true" || el.className.includes("bg-ink"),
    }));
    const inputNames = [...root.querySelectorAll("input")].map((el) => el.name).filter(Boolean);
    return { channels, inputNames, text: (root.textContent ?? "").slice(0, 200) };
  });

  check(
    "重置视图有「短信验证码」渠道",
    Boolean(reset?.channels?.some((c) => c.key === "phone" || c.text.includes("短信"))),
    reset?.channels?.map((c) => `${c.key}:${c.text}`).join(" | ") ?? "",
  );
  check(
    "重置视图有「邮箱验证码」渠道",
    Boolean(reset?.channels?.some((c) => c.key === "email" || c.text.includes("邮箱"))),
    reset?.channels?.map((c) => c.text).join(" | ") ?? "",
  );

  // 默认渠道：登录页没填邮箱时应停在手机号
  const defaultKey = reset?.channels?.find((c) => c.active)?.key ?? "";
  check("登录页默认停在短信渠道（不知道该邮箱是谁）", defaultKey === "phone", `默认=${defaultKey || "未识别"}`);

  // 手机号输入框可编辑（登录页此时不知道你是谁，必须能手输）
  const phoneInput = await page.$eval('[data-view="reset"] input[name="resetPhone"]', (el) => ({
    editable: !el.readOnly && !el.disabled,
    placeholder: el.getAttribute("placeholder") ?? "",
  })).catch(() => null);
  check("登录页手机号可手输（未锁定）", Boolean(phoneInput?.editable), phoneInput?.placeholder ?? "字段缺失");

  // 切到邮箱：邮箱框可编辑，字段齐全
  await page.evaluate(() => {
    const el = document.querySelector('[data-view="reset"] [data-channel="email"]');
    el?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const emailFields = await page.evaluate(() =>
    [...document.querySelectorAll('[data-view="reset"] input')].map((el) => el.name).filter(Boolean),
  );
  check(
    "切到邮箱后字段齐全（邮箱/验证码/新密码/确认）",
    ["email", "code", "newPassword", "confirmPassword"].every((n) => emailFields.includes(n)),
    emailFields.join(","),
  );

  await page.screenshot({ path: `${SHOT_DIR}/live-reset-email.png`, fullPage: false });

  // 全程零 JS 报错
  check("线上页面零 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
} catch (err) {
  check("线上浏览器验收未抛异常", false, String(err?.message ?? err).slice(0, 160));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
