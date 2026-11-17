/**
 * 跨浏览器 × 跨尺寸 全功能端到端。
 *
 * 目的：不只验证「页面能打开」，而是每个内核、每种屏幕宽度下都真的点一遍：
 *   登录 → 进卷 → 点词查词 → 提交答案判题 → AI 抽屉 → 笔记抽屉 →
 *   收藏 → 生词本 → 排行 → 我的 → 错题 → 退出登录
 * 同时收集 JS 运行时错误、失败请求、横向溢出。
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3101 node scripts/e2e-cross-browser.mjs
 *   可选 ENGINE=chrome|edge|firefox 只跑一个；VIEWPORT=390 只跑一个宽度
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE = process.env.EDGE_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FIREFOX =
  process.env.FIREFOX_PATH || `${process.cwd()}/.build/browsers/ff/firefox.exe`.replace(/\\/g, "/");

// 线上（workbuddy.host 网关）要求每个同源请求都带 sharecode，本地不需要
const SHARECODE = (process.env.SHARECODE || "").trim();
const url = (p) => `${BASE}${p}${SHARECODE ? `${p.includes("?") ? "&" : "?"}sharecode=${SHARECODE}` : ""}`;

const onlyEngine = (process.env.ENGINE || "").toLowerCase();
const onlyViewport = process.env.VIEWPORT ? Number(process.env.VIEWPORT) : 0;

const ENGINES = [
  { name: "Chrome", product: "chrome", path: CHROME },
  { name: "Edge", product: "chrome", path: EDGE },
  { name: "Firefox", product: "firefox", path: FIREFOX },
].filter((e) => (onlyEngine ? e.name.toLowerCase() === onlyEngine : true) && existsSync(e.path));

const VIEWPORTS = [
  { name: "320", width: 320, height: 568, mobile: true },
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: false },
  { name: "1280", width: 1280, height: 800, mobile: false },
].filter((v) => (onlyViewport ? v.width === onlyViewport : true));

const results = [];
const rec = (scope, name, pass, detail) => {
  results.push({ scope, name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  [${scope}] ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 账号：每个「内核 × 尺寸」用独立账号 ----------
   共用一个账号时，前面跑过的题已经作答，后面几轮翻不到未作答的题，
   会把「重复作答」误判成功能坏了。注册限流是 5 次/分钟，本脚本顺序执行不会触顶。 */
let account = { email: "", pwd: "Passw0rd!" };

async function registerAccount(tag) {
  const email = `xb_${tag}_${Date.now()}@qq.com`;
  // 三种失败要分开处理，否则会把环境问题记成产品缺陷：
  //   1. 拿到「正在启动」占位页 —— HTTP 200 但正文是 HTML，账号根本没建；
  //   2. 429 注册限流（5 次/分钟）—— 等一会儿再来；
  //   3. 其它错误 —— 直接中止。
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url("/api/auth/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: account.pwd, name: "跨端测试" }),
    });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && ct.includes("json")) {
      const payload = JSON.parse(await res.text());
      if (payload?.code === 0) {
        account = { email, pwd: account.pwd };
        return true;
      }
      console.log(`  注册返回业务错误：${payload?.message ?? "未知"}（第 ${attempt} 次）`);
    } else if (res.status === 429) {
      console.log(`  注册被限流（第 ${attempt} 次），等 25 秒重试`);
      await sleep(25_000);
      continue;
    } else if (res.ok) {
      console.log(`  注册拿到的是占位页而非接口响应（应用正在冷启动），等 15 秒重试`);
      await sleep(15_000);
      continue;
    } else {
      console.log(`  注册 ${email} 失败 HTTP ${res.status}`);
    }
    await sleep(5000);
  }
  console.log("  注册未能完成：中止本轮，避免把环境问题记成产品缺陷");
  process.exit(2);
}

/* ---------- 页面小工具 ---------- */
const overflowOf = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function clickText(page, needle, tag = "button") {
  return page.evaluate(
    ({ needle, tag }) => {
      const els = [...document.querySelectorAll(tag)];
      const hit = els.find((e) => (e.textContent || "").replace(/\s+/g, " ").includes(needle));
      if (!hit) return false;
      hit.scrollIntoView({ block: "center" });
      hit.click();
      return true;
    },
    { needle, tag },
  );
}

async function hasText(page, needle) {
  return page.evaluate((n) => (document.body.textContent || "").includes(n), needle);
}

async function waitText(page, needle, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await hasText(page, needle)) return true;
    await sleep(150);
  }
  return false;
}

async function attachErrorSinks(page) {
  const errors = [];
  // 记下出错时所在路径：只说「有 JS 报错」没法定位，加上路由才知道去哪一页复现
  const where = () => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return "?";
    }
  };
  page.on("pageerror", (e) => errors.push(`pageerror@${where()}: ${String(e).slice(0, 160)}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // 云模型/词典等外部请求的 CORS/网络噪音不算页面缺陷
      if (/\.cloud\/|favicon|Download the React DevTools/i.test(t)) return;
      errors.push(`console@${where()}: ${t.slice(0, 160)}`);
    }
  });
  const bad = [];
  page.on("response", (r) => {
    const u = r.url();
    const s = r.status();
    // 未登录时的 /api/... 401 属于预期
    if (s >= 400 && !/\/api\/me|\/login|401/.test(`${u} ${s}`)) bad.push(`${s} ${u.split("?")[0]}`);
  });
  return { errors, bad };
}

/* ---------- 单个内核 × 单个尺寸 ---------- */
async function runOne(engine, vp) {
  const scope = `${engine.name} ${vp.name}`;
  const launchOpts = {
    executablePath: engine.path,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    defaultViewport: { width: vp.width, height: vp.height, isMobile: vp.mobile, hasTouch: vp.mobile },
  };
  if (engine.product === "firefox") launchOpts.browser = "firefox";

  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    rec(scope, "启动浏览器", false, String(e).slice(0, 120));
    return;
  }

  try {
    const page = await browser.newPage();
    const { errors, bad } = await attachErrorSinks(page);
    try {
      await page.setViewport({
        width: vp.width,
        height: vp.height,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
    } catch {
      /* Firefox(BiDi) 不支持 setViewport 时用 defaultViewport 兜住 */
    }

    /* 1. 登录（hydration 抢输入 / 提交导航抢后续操作，都由 loginViaUi 统一兜住） */
    const r = await page.goto(url("/login"), { waitUntil: "networkidle2", timeout: 45000 });
    rec(scope, "登录页 200", r && r.status() === 200, `HTTP ${r && r.status()}`);
    const formOk = await page.evaluate(
      () => Boolean(document.querySelector('input[type="email"]') && document.querySelector('input[type="password"]')),
    );
    rec(scope, "登录表单可用", formOk);
    const login = await loginViaUi(page, account, { sleep });
    const submitted = login.attempts > 0;
    const loggedIn = login.ok;
    rec(scope, "登录并跳转", submitted && loggedIn, login.url);
    if (!loggedIn) {
      // 把现场记下来：输入框实际值、页面报错、当前 Tab，避免下次又靠猜
      const diag = await page
        .evaluate(() => ({
          email: document.querySelector('input[type="email"]')?.value ?? "(无输入框)",
          pwdLen: (document.querySelector('input[type="password"]')?.value ?? "").length,
          body: (document.body.innerText || "").replace(/\n+/g, " | ").slice(0, 200),
        }))
        .catch(() => null);
      console.log(`  诊断: ${JSON.stringify(diag)}  账号=${account.email}`);
      rec(scope, "后续流程", false, "登录失败，跳过");
      return;
    }

    /* 2. 首页 / 试卷列表 */
    await page.goto(url("/"), { waitUntil: "domcontentloaded", timeout: 45000 });
    rec(scope, "首页无横向溢出", (await overflowOf(page)) <= 1, `${await overflowOf(page)}px`);
    const practiceHref = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/practice/"]');
      return a ? a.getAttribute("href") : "";
    });
    rec(scope, "首页有可进入的试卷", Boolean(practiceHref), practiceHref || "未找到");

    /* 3. 练习页 */
    if (practiceHref) {
      await page.goto(url(practiceHref), { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(1200);
      rec(scope, "练习页无横向溢出", (await overflowOf(page)) <= 1, `${await overflowOf(page)}px`);

      // 点词 → 词卡（手机端先确保在「文章」Tab）
      if (vp.mobile) {
        await clickText(page, "文章");
        await sleep(300);
      }
      const wordClicked = await page.evaluate(() => {
        const w = document.querySelector("article .word") || document.querySelector(".word");
        if (!w) return false;
        w.scrollIntoView({ block: "center" });
        w.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      });
      await sleep(900);
      const cardOk = await page.evaluate(
        () => Boolean(document.querySelector('[role="dialog"][aria-label*="释义"]')) ||
          /生词本|音标|释义/.test(document.body.textContent || ""),
      );
      rec(scope, "点词弹出词卡", wordClicked && cardOk);
      // 关掉词卡
      await page.keyboard.press("Escape").catch(() => {});
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /关闭|关闭词卡|×|✕/.test((b.getAttribute("aria-label") || "") + (b.textContent || "")),
        );
        btn && btn.click();
      });
      await sleep(300);

      // 题目 Tab + 选项 + 提交
      if (vp.mobile) {
        await clickText(page, "题目");
        await sleep(400);
      }
      // 同一账号会重复跑多个内核，前面的题可能已经作答过（页面直接显示判题结果）。
      // 先翻到一道还没作答的题，顺带把「下一题」也点一遍。
      let already = await page.evaluate(() => /答对了|答错了/.test(document.body.textContent || ""));
      for (let i = 0; i < 6 && already; i++) {
        await clickText(page, "下一题");
        await sleep(600);
        already = await page.evaluate(() => /答对了|答错了/.test(document.body.textContent || ""));
      }
      rec(scope, "翻到未作答的题目", !already);
      const picked = await page.evaluate(() => {
        const radio = document.querySelector('[role="radiogroup"] [role="radio"]');
        if (!radio) return false;
        radio.scrollIntoView({ block: "center" });
        radio.click();
        return true;
      });
      await sleep(300);
      const submittedAns = await clickText(page, "提交答案");
      const verdict = submittedAns
        ? await waitText(page, "答对了", 9000) || (await waitText(page, "答错了", 2000))
        : false;
      rec(scope, "选答案并提交判题", picked && submittedAns && verdict);

      // AI 抽屉
      const aiOpen = await clickText(page, "问 AI");
      await sleep(700);
      const aiOk = aiOpen && (await page.evaluate(() => Boolean(document.querySelector("aside, [role='dialog']"))));
      rec(scope, "AI 抽屉可打开", aiOk);
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(300);

      // 笔记与讨论
      const cmOpen = await clickText(page, "笔记与讨论");
      await sleep(700);
      const cmOk = cmOpen && (await page.evaluate(() => Boolean(document.querySelector("aside, [role='dialog']"))));
      rec(scope, "笔记抽屉可打开", cmOk);
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
    }

    /* 4. 其余页面 */
    const pages = [
      ["/favorites", "收藏"],
      ["/vocab", "生词"],
      ["/leaderboard", "排行"],
      ["/profile", "我的"],
      ["/mistakes", "错题"],
    ];
    for (const [path, keyword] of pages) {
      const resp = await page.goto(url(path), { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(500);
      const status = resp && resp.status();
      const textOk = (await hasText(page, keyword)) || (await hasText(page, "暂无")) || (await hasText(page, "还没有"));
      const ov = await overflowOf(page);
      let where = "";
      if (ov > 1) {
        const bad2 = await page.evaluate(() => {
          const vw = window.innerWidth;
          const hits = [];
          document.querySelectorAll("*").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            if (r.right > vw + 1)
              hits.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 34)}@${Math.round(r.right)}`);
          });
          return hits.slice(0, 4).join(" , ");
        });
        where = `；越界元素：${bad2}`;
      }
      rec(scope, `${path} 可用且不溢出`, status === 200 && textOk && ov <= 1, `HTTP ${status} 溢出${ov}px${where}`);
    }

    /* 5. 退出登录 */
    await page.goto(url("/profile"), { waitUntil: "domcontentloaded", timeout: 45000 });
    const outClicked = await clickText(page, "退出登录");
    let outOk = false;
    for (let i = 0; i < 60 && !outOk; i++) {
      outOk = !page.url().includes("/profile");
      if (!outOk) await sleep(250);
    }
    rec(scope, "退出登录", outClicked && outOk, page.url());

    /* 6. 全程无 JS 错误 / 无失败请求 */
    rec(scope, "无 JS 运行时错误", errors.length === 0, errors.slice(0, 2).join(" | ") || "无");
    rec(scope, "无失败请求（4xx/5xx）", bad.length === 0, bad.slice(0, 3).join(" | ") || "无");
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------- 主流程 ---------- */
console.log(`内核：${ENGINES.map((e) => e.name).join(" / ") || "无"}`);
console.log(`尺寸：${VIEWPORTS.map((v) => `${v.width}px`).join(" / ")}\n`);
for (const engine of ENGINES) {
  for (const vp of VIEWPORTS) {
    const ok = await registerAccount(`${engine.name}${vp.width}`.toLowerCase());
    if (!ok) console.log(`  ${engine.name} ${vp.width}: 账号注册失败，可能触到限流`);
    await runOne(engine, vp, account);
    await sleep(600);
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n=== ${passed}/${results.length} 通过 ===`);
const fails = results.filter((r) => !r.pass);
if (fails.length) {
  console.log("失败项：");
  for (const f of fails) console.log(`  - [${f.scope}] ${f.name}`);
  process.exit(1);
}
