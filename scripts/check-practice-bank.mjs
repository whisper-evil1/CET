/**
 * 选词填空词库在刷题页的呈现验收。
 *
 * 十五词词库是「导入器合成 + 前端渲染」两段拼起来的，任何一段错位，用户看到的就是
 * 四个选项或者干脆没有词库。这里用真实浏览器打开一套卷的第 1 篇，检查：
 *   - 原文区出现「词库」段，且 A–O 十五个词都在
 *   - 题目区第一题渲染 15 个选项按钮（不是 4 个）
 *   - 1280 / 390 两档无横向溢出
 *
 * 用法：BASE_URL=http://127.0.0.1:3101 node scripts/check-practice-bank.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAPER = process.env.PAPER_ID || "cet4-2026-06-s1";

const pass = [];
const fail = [];
const rec = (name, ok, detail = "") => {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// 刷题页要登录才有内容：先注册一个一次性账号，再从登录页真正登进去（会话 cookie 由服务端下发）
const account = {
  email: `pb_${Date.now()}@qq.com`,
  password: "Passw0rd!",
  name: "词库验证",
};
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(account),
});
if (!reg.ok) throw new Error(`注册失败 ${reg.status}`);
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
const login = await loginViaUi(page, { email: account.email, pwd: account.password });
rec("登录成功", login.ok && !page.url().includes("/login"), page.url().replace(BASE, "") || "/");

async function inspect(width, height) {
  await page.setViewport({ width, height });
  await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 800));

  const info = await page.evaluate(() => {
    const text = document.body.innerText;
    const bankMatch = text.match(/词库\s*([A-O]\)[^\n]*)/);
    const bankText = bankMatch ? bankMatch[1] : "";
    const words = bankText ? bankText.split(/\s*[A-O]\)\s*/).filter(Boolean) : [];
    // 第一道题：找题干含 "blank 26" 的题目块，数它的选项按钮
    const blocks = [...document.querySelectorAll("div,section,li")];
    let optionCount = 0;
    for (const b of blocks) {
      if (b.innerText && /blank 26/i.test(b.innerText) && b.innerText.length < 400) {
        const btns = b.querySelectorAll("button");
        if (btns.length > optionCount) optionCount = btns.length;
      }
    }
    return {
      hasBank: /词库/.test(text),
      wordCount: words.filter((w) => w.trim()).length,
      optionCount,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  return info;
}

const desktop = await inspect(1280, 900);
rec("原文里出现词库段", desktop.hasBank);
rec("词库是 15 个词", desktop.wordCount >= 15, `${desktop.wordCount} 个`);
rec("第 1 题渲染 15 个选项", desktop.optionCount >= 15, `${desktop.optionCount} 个按钮`);
rec("[1280] 刷题页无横向溢出", desktop.overflow <= 1, `${desktop.overflow}px`);

const mobile = await inspect(390, 844);
rec("[390] 刷题页无横向溢出", mobile.overflow <= 1, `${mobile.overflow}px`);
rec("[390] 词库仍在（未被折叠丢失）", mobile.hasBank);

rec("无 JS 运行时错误", errors.length === 0, errors[0] ?? "");

await browser.close();
console.log(`\n结果：PASS ${pass.length} / FAIL ${fail.length}`);
process.exit(fail.length === 0 ? 0 : 1);
