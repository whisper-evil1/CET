#!/usr/bin/env node
/**
 * 线上词书 / 导入 / 优先级队列的验收（真实网关 + 真实浏览器）。
 *
 * 与本地 e2e 的区别：
 *   1. 全程只走 HTTPS，不碰本地数据库（线上库在沙箱 ~/.cet-data，脚本无权直连）；
 *   2. 每个请求都必须带 ?sharecode=，漏带会被网关换成 3KB 错误页（HTTP 200 / text/html），
 *      所以断言里额外校验 content-type 是 JSON——否则会把错误页当成功；
 *   3. 浏览器侧覆盖 390 / 768 / 1280 三档，检查横向溢出与 JS 报错。
 *
 * 用法：node scripts/verify-live-vocab.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const CODE = process.env.SHARECODE || "2AI33QQETY";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const withCode = (p) => `${p}${p.includes("?") ? "&" : "?"}sharecode=${CODE}`;

const pass = [];
const fail = [];
const rec = (name, ok, detail = "") => {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const email = `lv_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";
let cookie = "";

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${withCode(path)}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  const ctype = res.headers.get("content-type") ?? "";
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  // 网关错误页：HTTP 200 + text/html，必须识别出来，不能当成功
  const gatewayHtml = ctype.includes("html") || body === null;
  return { status: res.status, body, ctype, gatewayHtml };
}

/* ---------- 1. 冷启动 / 网关可达 ---------- */
let ready = false;
for (let i = 0; i < 60; i++) {
  const probe = await api("/api/auth/csrf").catch(() => null);
  if (probe && probe.status === 200 && !probe.gatewayHtml) {
    ready = true;
    break;
  }
  await sleep(3000);
}
rec("线上服务就绪（返回 JSON 而非占位页）", ready);

/* ---------- 2. 注册 + 登录 ---------- */
let registered = false;
for (let attempt = 1; attempt <= 4; attempt++) {
  const res = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: pwd, name: "线上验收" }),
  });
  if (res.status === 200 && res.body?.code === 0) {
    registered = true;
    break;
  }
  if (res.status === 429) {
    console.log("  注册限流，等 25 秒");
    await sleep(25_000);
    continue;
  }
  if (res.gatewayHtml) {
    await sleep(15_000);
    continue;
  }
  console.log(`  注册失败 HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  break;
}
rec("线上注册可用", registered, email);

/* ---------- 3. 用真实浏览器登录，拿到会话 cookie 再做接口断言 ----------
   直接在 Node 里构造 NextAuth JWT 需要线上 AUTH_SECRET，脚本里没有也不该有，
   所以走真登录页拿 cookie：这样断言用的权限和真实用户完全一致。 */
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

const jsErrors = [];
const failedRequests = [];

const sessionPage = await browser.newPage();
await sessionPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await sessionPage.goto(`${BASE}${withCode("/login")}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
const firstLogin = await loginViaUi(sessionPage, { email, pwd }, { attempts: 3, waitMs: 900, sleep });
rec("线上登录成功", firstLogin.ok, firstLogin.url.replace(BASE, ""));

const jar = await sessionPage.cookies();
await sessionPage.close();
cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");

/* ---------- 4. 词书接口 ---------- */
const books = await api("/api/vocab/wordbooks");
const bookList = books.body?.data ?? [];
rec("词书接口返回 JSON", books.status === 200 && !books.gatewayHtml, `ctype=${books.ctype.split(";")[0]}`);
rec("返回三本词书", bookList.length === 3, bookList.map((b) => `${b.id}:${b.count}`).join(", "));
rec(
  "词书规模正确（1500/1500/800）",
  bookList[0]?.count === 1500 && bookList[1]?.count === 1500 && bookList[2]?.count === 800,
  bookList.map((b) => b.count).join("/"),
);

const page1 = await api("/api/vocab/wordbooks/cet4-core?offset=0&limit=10");
const rows = page1.body?.data?.entries ?? [];
rec("词书分页可用", rows.length === 10, `${rows.length} 条`);
rec(
  "词频排名升序且带释义",
  rows.every((r, i) => (i === 0 || rows[i - 1].rank <= r.rank) && r.definitions.length > 0),
  rows.slice(0, 3).map((r) => `${r.word}#${r.rank}`).join(", "),
);

/* ---------- 4. 导入 ---------- */
const text = ["quixotic\t空想的", "peruse, 细读", "ephemeral n. 短暂的", "serendipity"].join("\n");
const imported = await api("/api/vocab/import", { method: "POST", body: JSON.stringify({ text }) });
const stat = imported.body?.data ?? {};
rec("文本导入成功", imported.status === 200 && stat.added === 4, JSON.stringify(stat));

const fromBook = await api("/api/vocab/import", {
  method: "POST",
  body: JSON.stringify({ wordbookId: "cet-essential", count: 20 }),
});
const bookStat = fromBook.body?.data ?? {};
rec("词书一键导入 20 词", fromBook.status === 200 && bookStat.added === 20, JSON.stringify(bookStat));

/* ---------- 5. 队列与优先级 ---------- */
const queue = await api("/api/vocab/queue?limit=10");
const q = queue.body?.data ?? {};
rec("今日队列可用", queue.status === 200 && Array.isArray(q.items) && q.items.length > 0, `${q.items?.length ?? 0} 条`);
rec(
  "队列按优先级降序",
  (q.items ?? []).every((item, i) => i === 0 || q.items[i - 1].priority >= item.priority),
  (q.items ?? []).slice(0, 4).map((i) => `${i.word}:${i.priority}`).join(" > "),
);
rec(
  "每条带到期状态与排序理由",
  (q.items ?? []).every((i) => typeof i.dueLabel === "string" && i.dueLabel.length > 0 && typeof i.reason === "string"),
  (q.items ?? [])[0]?.reason,
);

/* ---------- 6. 复习调度 ---------- */
const target = (q.items ?? [])[0];
const r1 = await api(`/api/vocab/${target.id}/review`, { method: "POST", body: JSON.stringify({ result: "known" }) });
rec("答对 → 间隔 1 天", r1.body?.data?.intervalDays === 1, `${r1.body?.data?.nextLabel}`);
const r2 = await api(`/api/vocab/${target.id}/review`, { method: "POST", body: JSON.stringify({ result: "known" }) });
rec("再答对 → 间隔 2 天", r2.body?.data?.intervalDays === 2, `${r2.body?.data?.nextLabel}`);
const r3 = await api(`/api/vocab/${target.id}/review`, { method: "POST", body: JSON.stringify({ result: "known" }) });
rec("第三次答对 → 移入已掌握", r3.body?.data?.status === "mastered", `${r3.body?.data?.intervalDays} 天后`);
const r4 = await api(`/api/vocab/${target.id}/review`, { method: "POST", body: JSON.stringify({ result: "unknown" }) });
rec("答错 → 10 分钟后再来", r4.body?.data?.nextLabel === "10 分钟后", `lapses=${r4.body?.data?.lapses}`);

/* ---------- 7. 浏览器：三档视口 ---------- */
const VIEWPORTS = [
  { name: "手机 390", width: 390, height: 844, mobile: true },
  { name: "平板 768", width: 768, height: 1024, mobile: false },
  { name: "桌面 1280", width: 1280, height: 900, mobile: false },
];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => jsErrors.push(`[${vp.name}] ${String(e).slice(0, 140)}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|React DevTools|\.cloud\/|Failed to load resource/i.test(t)) return;
    jsErrors.push(`[${vp.name}] console: ${t.slice(0, 140)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    // 排除三类非缺陷：
    //   1. favicon / 统计脚本；
    //   2. Next 的 Link 预取（?_rsc=…）：页面切走后浏览器会主动 abort，这是设计行为；
    //   3. 跳转打断的 preload。
    if (/favicon|analytics/i.test(u)) return;
    if (/[?&]_rsc=/.test(u) && /ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return;
    failedRequests.push(`[${vp.name}] ${u.replace(BASE, "")} ${r.failure()?.errorText ?? ""}`);
  });

  /**
   * 点一个按钮，等条件成立；线上网络比本地慢，固定 sleep 会假失败。
   * 匹配策略：先精确匹配文案，找不到再退回「文案包含」取最短的那个——
   * 按钮上带图标（"🎴 开始刷词"）时精确匹配会永远找不到，曾因此假失败。
   */
  const clickAndWait = async (label, predicate, timeout = 20_000) => {
    const clicked = await page.evaluate((text) => {
      const buttons = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim());
      const exact = buttons.find((b) => (b.textContent || "").trim() === text);
      const fuzzy = exact
        ? null
        : buttons
            .filter((b) => (b.textContent || "").trim().includes(text))
            .sort((a, b) => a.textContent.trim().length - b.textContent.trim().length)[0];
      const target = exact || fuzzy;
      if (!target) return false;
      target.click();
      return true;
    }, label);
    if (!clicked) return false;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const ok = await page.evaluate(predicate).catch(() => false);
      if (ok) return true;
      await sleep(300);
    }
    return false;
  };

  await page.setCookie(...jar);
  await page.goto(`${BASE}${withCode("/vocab")}`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForFunction(() => (document.body.innerText || "").includes("生词本"), { timeout: 30_000 }).catch(() => {});

  // 词表优先级读数器：取 li 最多的那个 ul（页面上的主列表），徽标取带 title 的 span
  await page.evaluate(() => {
    window.__priorities = () => {
      const lists = [...document.querySelectorAll("ul")];
      const main = lists.sort(
        (a, b) => b.querySelectorAll("li").length - a.querySelectorAll("li").length,
      )[0];
      if (!main) return [];
      return [...main.querySelectorAll("li")]
        .map((li) => {
          const badge =
            li.querySelector("span[title]") ||
            [...li.querySelectorAll("span")].find((s) => /^\d{1,3}$/.test((s.textContent || "").trim()));
          if (!badge) return NaN;
          const n = Number((badge.textContent || "").trim());
          return Number.isNaN(n) ? NaN : n;
        })
        .filter((n) => !Number.isNaN(n));
    };
  });

  const overflow = async () =>
    page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }));

  const base = await overflow();
  rec(`[${vp.name}] 生词本无横向溢出`, base.overflow <= 1, `${base.overflow}px`);

  /* 词书：等到三本词书的卡片真的出现，而不是 sleep 完就断言 */
  const booksShown = await clickAndWait(
    "词书",
    () => {
      const t = document.body.innerText || "";
      return t.includes("四级高频") && t.includes("六级高频") && t.includes("必备核心");
    },
    25_000,
  );
  rec(`[${vp.name}] 词书页渲染三本词书`, booksShown);

  const bookOverflow = await overflow();
  rec(`[${vp.name}] 词书页无横向溢出`, bookOverflow.overflow <= 1, `${bookOverflow.overflow}px`);

  /* 一键导入 50：等到出现「新增 N 个」或「已在词库 N 个」 */
  const importClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入 50");
    if (!btn) return false;
    btn.click();
    return true;
  });
  let notice = "";
  for (let i = 0; i < 70; i++) {
    await sleep(400);
    notice = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find(
        (p) => (p.textContent || "").includes("新增") || (p.textContent || "").includes("已在词库"),
      );
      return el ? el.textContent.trim() : "";
    });
    if (/新增\s*\d+/.test(notice) || /已在词库\s*\d+/.test(notice)) break;
  }
  rec(`[${vp.name}] 一键导入有反馈`, importClicked && notice.length > 0, notice);

  /* 生词本 + 优先级排序 */
  // 判定「词表出来了」不能用 placeholder 文案：placeholder 不进 innerText，
  // 之前用它当条件，条件永远不成立，排序按钮根本没被点到，白判一次失败。
  const listShown = await clickAndWait(
    "生词本",
    () =>
      Boolean(document.querySelector('input[placeholder*="搜索单词"]')) ||
      (document.body.innerText || "").includes("开始刷词"),
    25_000,
  );

  /** 优先级徽标 = 带 title 的 span（复习次数 0/3 那种不是纯数字，别误取） */
  // 挂在 window 上，是因为 clickAndWait 的断言函数会被序列化后丢进页面执行，
  // 引用不了 Node 侧闭包里的变量。
  const readPriorities = () => (window.__priorities ? window.__priorities() : []);

  const sorted = listShown
    ? await clickAndWait(
        "优先级",
        () => {
          const nums = window.__priorities ? window.__priorities() : [];
          if (nums.length < 4) return false;
          return nums.every((n, i) => i === 0 || nums[i - 1] >= n);
        },
        25_000,
      )
    : false;

  const order = listShown ? await page.evaluate(readPriorities) : [];
  rec(
    `[${vp.name}] 优先级排序递减`,
    sorted,
    order.slice(0, 5).join(" ≥ ") || "（未取到词表）",
  );

  const listOverflow = await overflow();
  rec(`[${vp.name}] 生词本列表无横向溢出`, listOverflow.overflow <= 1, `${listOverflow.overflow}px`);

  /* 粘贴导入 */
  await clickAndWait("导入", () => (document.body.innerText || "").includes("导入到生词本"), 25_000);
  await clickAndWait("填入示例", () => (document.body.innerText || "").includes("abandon"), 15_000);
  const pasted = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("导入到生词本"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  let importMsg = "";
  for (let i = 0; i < 70; i++) {
    await sleep(400);
    importMsg = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => (p.textContent || "").includes("解析"));
      return el ? el.textContent.trim() : "";
    });
    if (/解析\s*\d+\s*个词/.test(importMsg)) break;
  }
  rec(`[${vp.name}] 粘贴导入有统计结果`, pasted && /解析\s*\d+\s*个词/.test(importMsg), importMsg);

  const importOverflow = await overflow();
  rec(`[${vp.name}] 导入页无横向溢出`, importOverflow.overflow <= 1, `${importOverflow.overflow}px`);

  /* 刷词 */
  await clickAndWait("生词本", () => (document.body.innerText || "").includes("开始刷词"), 25_000);
  const flash = await clickAndWait("开始刷词", () => (document.body.innerText || "").includes("不认识"), 25_000);
  rec(`[${vp.name}] 刷词卡片可打开`, flash);

  const judged = await page.evaluate(() => {
    const t = (b) => (b.textContent || "").trim();
    const btn = [...document.querySelectorAll("button")].find(
      (b) => t(b).length <= 10 && t(b).endsWith("认识") && !t(b).includes("不认识"),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  let nextHint = "";
  for (let i = 0; i < 50; i++) {
    await sleep(300);
    nextHint = await page.evaluate(() => {
      const m = (document.body.innerText || "").match(/下次复习：\s*([^\n]+)/);
      return m ? m[1].trim() : "";
    });
    if (nextHint) break;
  }
  rec(`[${vp.name}] 答对后提示下次复习时间`, judged && Boolean(nextHint), nextHint);

  await page.close();
}

const meaningfulErrors = jsErrors.filter((e) => !/ResizeObserver|Script error/i.test(e));
rec("三档视口全程无 JS 报错", meaningfulErrors.length === 0, meaningfulErrors.slice(0, 3).join(" | "));
rec("三档视口无失败请求", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

await browser.close();

console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
if (fail.length > 0) console.log(`失败项：\n${fail.map((n) => `  - ${n}`).join("\n")}`);
process.exit(fail.length === 0 ? 0 : 1);
