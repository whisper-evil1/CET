/**
 * 线上验收「听力一段一页」。
 *
 * 判定依据（都是页面可见事实，不依赖内部状态）：
 *   1. 右栏底部出现「交本段」而不是「交本题」—— 只有一段多题才需要按段交；
 *   2. 同一屏能数到 ≥2 组选择题（上一版是逐题一页，一屏只有一组）；
 *   3. 点「下一段 →」后，段号与题目内容都变（是真的翻段，不是翻题）。
 *
 * 登录不走表单：线上表单水合慢，用 HTTP 换 cookie 再塞进浏览器更稳。
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.LIVE_EMAIL ?? "live-study@qq.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "Live2026#study";
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 用 HTTP 换会话 cookie ---------- */
const jar = new Map();
const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
for (const c of csrfRes.headers.getSetCookie?.() ?? []) {
  const [pair] = c.split(";");
  const i = pair.indexOf("=");
  if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
}
const { csrfToken } = await csrfRes.json();
const loginRes = await fetch(url("/api/auth/callback/credentials"), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    origin: BASE,
    referer: url("/login"),
  },
  body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: `${BASE}/`, json: "true" }),
  redirect: "manual",
});
for (const c of loginRes.headers.getSetCookie?.() ?? []) {
  const [pair] = c.split(";");
  const i = pair.indexOf("=");
  if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
}
const sessionName = [...jar.keys()].find((k) => /session-token$/.test(k));
check("拿到线上会话", Boolean(sessionName), sessionName ?? "无");

/* ---------- 2. 浏览器带 cookie 打开试卷 ---------- */
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 960 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url().split("?")[0].replace(BASE, "")} :: ${String(e.message).slice(0, 120)}`));

if (sessionName) {
  await page.setCookie({
    name: sessionName,
    value: jar.get(sessionName),
    domain: new URL(BASE).hostname,
    path: "/",
    secure: sessionName.startsWith("__Secure"),
    httpOnly: true,
  });
}

let opened = false;
for (let i = 0; i < 6 && !opened; i += 1) {
  try {
    await page.goto(url(`/practice/${PAPER}?t=${Date.now()}`), { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch {
    await sleep(4000);
    continue;
  }
  opened = await page
    .waitForSelector("text/听力", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await sleep(4000);
}
check("打开试卷并看到「听力」部分", opened, page.url().replace(BASE, "").slice(0, 50));

/* ---------- 3. 切到听力 ---------- */
if (opened) {
  // 「听力」是顶部 tab。线上慢，点一次不一定切过去，最多点三次并等选项组出现。
  let switched = false;
  for (let i = 0; i < 3 && !switched; i += 1) {
    await page.evaluate(() => {
      const t = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "听力");
      if (t instanceof HTMLElement) t.click();
    });
    for (let k = 0; k < 12 && !switched; k += 1) {
      await sleep(900);
      switched = await page.evaluate(() => document.querySelectorAll('[role="radiogroup"]').length > 0);
    }
  }

  const pane = await page.evaluate(() => {
    const txt = document.body.innerText;
    const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    // 一组选择题 = 一组 radio；数连续出现的选项组
    const groups = document.querySelectorAll('[role="radiogroup"]').length;
    const radios = document.querySelectorAll('input[type="radio"]').length;
    return {
      hasSubmitSegment: btns.some((t) => /交本段/.test(t)),
      hasNextSegment: btns.some((t) => /下一段/.test(t)),
      hasNextQuestion: btns.some((t) => /下一题/.test(t)),
      groups,
      radios,
      segment: (txt.match(/第\s*\d+\s*\/\s*\d+\s*段/) ?? [""])[0],
      body: txt.replace(/\s+/g, " ").slice(0, 160),
    };
  });

  check("听力右栏按段提交（有「交本段」）", pane.hasSubmitSegment, `groups=${pane.groups} radios=${pane.radios}`);
  check("同一屏有 ≥2 组选择题", pane.groups >= 2, `${pane.groups} 组 / ${pane.radios} 个选项`);
  check("提供「下一段」而不是「下一题」", pane.hasNextSegment && !pane.hasNextQuestion, `下一段=${pane.hasNextSegment} 下一题=${pane.hasNextQuestion}`);
  check("顶栏显示段序号", /\d+\s*\/\s*\d+\s*段/.test(pane.segment), pane.segment || pane.body);

  const before = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  const moved = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /下一段/.test(x.textContent ?? ""));
    if (b instanceof HTMLElement) {
      b.click();
      return true;
    }
    return false;
  });
  await sleep(2500);
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
  check("点「下一段」后内容真的换了", moved && before !== after, moved ? "已切换" : "没找到按钮");

  await page.screenshot({ path: "shots/live/listening-segment.png" });
}

check("听力页无 JS 报错", errors.length === 0, errors[0] ?? "");

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上听力按段验收 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
