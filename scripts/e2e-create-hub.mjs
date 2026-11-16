/**
 * 创作中心 v2.1 改版验收。
 *
 * 范围：
 *   - 未登录空状态
 *   - 双渐变入口卡 / 搜题窄条 / 三 tab / 新建按钮
 *   - 服务端真实写入两件作品 → 页面更新 → tab 过滤 → 打开作品 → 删除 → 刷新后仍存在
 *   - 390 / 768 / 1280 / 1440 四档视口无横向溢出、栅格列数正确
 *   - 截图证据与结果 JSON 落盘
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3202 node scripts/e2e-create-hub.mjs
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3202").replace(/\/$/, "");
const OUT =
  process.env.EVIDENCE_DIR ||
  "D:/work buddy work/2026-11-01-23-11-42/交付/创作出海Agent工作台-v1.0/验收证据/v2.1";
mkdirSync(OUT, { recursive: true });

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const EXECUTABLE = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!EXECUTABLE) {
  console.error("未找到 Chrome/Edge，请设置 CHROME_PATH");
  process.exit(2);
}

const u = (path) => `${BASE}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const jsErrors = [];
const badResponses = [];
const screenshots = [];

const rec = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const bodyText = (page) => page.evaluate(() => document.body.innerText || "");

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function attachSinks(page, tag) {
  page.on("pageerror", (e) =>
    jsErrors.push(`[${tag}] ${page.url().replace(BASE, "") || "/"} :: ${String(e).slice(0, 180)}`),
  );
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|React DevTools|Download the React DevTools/i.test(t)) return;
    jsErrors.push(`[${tag}] ${page.url().replace(BASE, "") || "/"} :: console: ${t.slice(0, 180)}`);
  });
  page.on("response", (r) => {
    const s = r.status();
    if (s < 400) return;
    const path = r.url().replace(BASE, "").split("?")[0];
    if (/favicon/i.test(path)) return;
    badResponses.push(`[${tag}] ${s} ${path}`);
  });
}

async function newPage(browser, width, height, mobile, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await attachSinks(page, tag);
  return page;
}

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
  return path;
}

async function waitCards(page, count) {
  await page.waitForFunction(
    (n) => document.querySelectorAll(".hub-work-card").length === n,
    { timeout: 12000 },
    count,
  );
}

async function clickTab(page, label) {
  const clicked = await page.evaluate((text) => {
    const tab = [...document.querySelectorAll(".hub-tab")].find((b) =>
      (b.textContent || "").replace(/\s+/g, "").includes(text),
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`未找到 tab: ${label}`);
}

async function structureOf(page) {
  return page.evaluate(() => {
    const entries = [...document.querySelectorAll(".hub-entry")];
    const tabs = [...document.querySelectorAll(".hub-tab")];
    const grid = document.querySelector(".hub-grid");
    const entryGrid = entries[0]?.parentElement;
    const newBtn = document.querySelector(".hub-new-btn");
    return {
      title: (document.querySelector("h1")?.textContent || "").trim(),
      entryCount: entries.length,
      entryTitles: entries.map((e) => (e.querySelector(".hub-entry-title")?.textContent || "").trim()),
      entryHrefs: entries.map((e) => e.getAttribute("href") || ""),
      entryGradients: entries.map((e) => getComputedStyle(e).backgroundImage),
      entryCols: entryGrid
        ? getComputedStyle(entryGrid).gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0,
      solveHref: document.querySelector(".hub-solve-strip")?.getAttribute("href") || "",
      // tab 上带数量角标（如「小说英译1」），结构断言只取文字标签，不把计数当文案。
      tabLabels: tabs.map((t) =>
        (t.textContent || "")
          .replace(/\s+/g, "")
          .replace(/\d+$/, "")
          .trim(),
      ),
      activeTab: (document.querySelector(".hub-tab-active")?.textContent || "").replace(/\s+/g, "").trim(),
      newLabel: (newBtn?.textContent || "").trim(),
      newHref: newBtn?.getAttribute("href") || "",
      cardCount: document.querySelectorAll(".hub-work-card").length,
      gridCols: grid
        ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length
        : 0,
    };
  });
}

async function makeContext(browser) {
  if (typeof browser.createBrowserContext === "function") return browser.createBrowserContext();
  return browser.createIncognitoBrowserContext();
}

const account = { email: `hub_${Date.now()}@qq.com`, pwd: "Passw0rd!" };
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

try {
  /* ---------- 真实注册，避免拿旧数据冒充验证 ---------- */
  const reg = await fetch(u("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.pwd, name: "创作中心验收" }),
  });
  rec("注册独立验收账号", reg.ok, `HTTP ${reg.status}`);
  if (!reg.ok) throw new Error("注册失败，后续链路不可用");

  /* ---------- 未登录空状态（独立上下文，不影响登录态） ---------- */
  const guestCtx = await makeContext(browser);
  try {
    const guest = await guestCtx.newPage();
    await guest.setViewport({ width: 1280, height: 800 });
    await attachSinks(guest, "guest");
    const resp = await guest.goto(u("/create"), { waitUntil: "networkidle2", timeout: 45000 });
    const text = await bodyText(guest);
    rec("未登录 /create 可打开", resp && resp.status() === 200, `HTTP ${resp && resp.status()}`);
    rec(
      "未登录显示登录引导而非假作品",
      text.includes("登录后保存的作品会出现在这里") && text.includes("去登录"),
    );
    rec("未登录也有双入口与搜题条", text.includes("小说翻译创作") && text.includes("短视频出海创作") && text.includes("拍照搜题"));
    await shot(guest, "create-1280-guest.png");
  } finally {
    await guestCtx.close();
  }

  /* ---------- 登录 ---------- */
  const page = await newPage(browser, 1440, 900, false, "desktop-1440");
  await page.goto(u("/login"), { waitUntil: "networkidle2", timeout: 45000 });
  const login = await loginViaUi(page, account, { sleep });
  rec("登录成功", login.ok, login.url.replace(BASE, "") || "/");
  if (!login.ok) throw new Error("登录失败，后续链路不可用");

  /* ---------- 登录后空状态与页面结构 ---------- */
  await page.goto(u("/create"), { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForSelector(".hub-entry", { timeout: 10000 });
  const emptyText = await bodyText(page);
  rec("登录后空状态文案正确", emptyText.includes("还没有作品，选一个工作台开始"));
  await shot(page, "create-1440-empty.png");

  const s0 = await structureOf(page);
  rec("主标题为截图口径", s0.title.includes("用英语，讲好中国故事"), s0.title);
  rec("双入口卡存在且指向真实工作台", s0.entryCount === 2 && s0.entryHrefs.join(",") === "/create/novel,/create/video", s0.entryHrefs.join(" | "));
  rec("入口标题对齐参考板块", s0.entryTitles.join("|") === "小说翻译创作|短视频出海创作", s0.entryTitles.join(" | "));
  rec("入口卡使用渐变而非克隆高饱和蓝紫", s0.entryGradients.every((g) => g.includes("linear-gradient")), s0.entryGradients.map((g) => g.slice(0, 52)).join(" || "));
  rec("桌面端入口卡两列", s0.entryCols === 2, `${s0.entryCols} 列`);
  rec("搜题窄条保留真实入口", s0.solveHref === "/solve/photo", s0.solveHref);
  rec("三个 tab 与截图作品区同构", s0.tabLabels.join("|") === "全部作品|小说英译|短视频出海", s0.tabLabels.join(" | "));
  rec("默认 tab 为全部作品", s0.activeTab.includes("全部作品"), s0.activeTab);
  rec("默认新建按钮指向小说工作台", s0.newLabel.includes("新建作品") && s0.newHref === "/create/novel", `${s0.newLabel} ${s0.newHref}`);
  rec("1440 无横向溢出", (await overflow(page)) <= 1, `${await overflow(page)}px`);

  /* ---------- 真实写入两件作品（读取 → 提交 → 页面更新 → 刷新持久化） ---------- */
  const created = await page.evaluate(async () => {
    const payloads = [
      {
        kind: "novel",
        title: "验收样例·红楼梦英译",
        sourceText: "验收用中文原文，用于验证作品库读取、过滤和持久化链路。",
        output: JSON.stringify({ paragraphs: [{ en: "A Dream of Red Mansions — acceptance sample.", zh: "红楼梦·验收样例" }] }),
        meta: JSON.stringify({ source: "e2e" }),
      },
      {
        kind: "video",
        title: "验收样例·中国美食短视频",
        sourceText: "验收用视频需求描述，用于验证作品库读取、过滤和持久化链路。",
        output: JSON.stringify({ hooks: ["Chinese food, told to the world — acceptance sample."] }),
        meta: JSON.stringify({ source: "e2e", platform: "youtube" }),
      },
    ];
    const out = [];
    for (const payload of payloads) {
      const r = await fetch("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      out.push({ status: r.status, code: j?.code ?? null, id: j?.data?.id ?? "" });
    }
    return out;
  });
  rec("/api/create 真实写入两件作品", created.length === 2 && created.every((c) => c.status === 200 && c.code === 0), JSON.stringify(created));

  await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await waitCards(page, 2);
  const s1 = await structureOf(page);
  rec("提交后刷新，作品卡真实出现", s1.cardCount === 2, `${s1.cardCount} 张`);
  rec("1440 作品网格四列", s1.gridCols === 4, `${s1.gridCols} 列`);
  rec("卡片显示真实预览而非占位假数据", (await bodyText(page)).includes("Chinese food, told to the world"), "");
  await shot(page, "create-1440-with-works.png");

  /* ---------- tab 过滤与新建按钮联动 ---------- */
  await clickTab(page, "小说英译");
  await waitCards(page, 1);
  const sn = await structureOf(page);
  rec("小说 tab 只显示小说作品", sn.cardCount === 1 && sn.activeTab.includes("小说英译"), `${sn.cardCount} 张 / ${sn.activeTab}`);
  rec("小说 tab 新建按钮仍指向小说工作台", sn.newHref === "/create/novel", sn.newHref);
  await shot(page, "create-1440-tab-novel.png");

  await clickTab(page, "短视频出海");
  await waitCards(page, 1);
  const sv = await structureOf(page);
  rec("短视频 tab 只显示视频作品", sv.cardCount === 1 && sv.activeTab.includes("短视频出海"), `${sv.cardCount} 张 / ${sv.activeTab}`);
  rec("短视频 tab 新建按钮改为新建视频", sv.newLabel.includes("新建视频") && sv.newHref === "/create/video", `${sv.newLabel} ${sv.newHref}`);
  await shot(page, "create-1440-tab-video.png");

  await clickTab(page, "全部作品");
  await waitCards(page, 2);

  /* ---------- 打开作品 ---------- */
  const openHref = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".hub-work-card a")];
    const hit = links.find((a) => (a.textContent || "").includes("打开"));
    return hit ? hit.getAttribute("href") || "" : "";
  });
  rec("作品卡有真实打开链接", /^\/create\/(novel|video)\?id=/.test(openHref), openHref);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.evaluate(() => {
      const links = [...document.querySelectorAll(".hub-work-card a")];
      links.find((a) => (a.textContent || "").includes("打开"))?.click();
    }),
  ]);
  rec("点击打开进入对应工作台", page.url().includes("/create/") && page.url().includes("?id="), page.url().replace(BASE, ""));
  await page.goto(u("/create"), { waitUntil: "networkidle2", timeout: 45000 });
  await waitCards(page, 2);

  /* ---------- 删除 + 刷新持久化 ---------- */
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.accept();
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 45000 }).catch(() => {}),
    page.evaluate(() => {
      document.querySelector(".hub-work-card button")?.click();
    }),
  ]);
  await page.waitForFunction(() => document.querySelectorAll(".hub-work-card").length === 1, {
    timeout: 12000,
  });
  rec("删除按钮可用且列表即时更新", dialogs.length === 1 && (await structureOf(page)).cardCount === 1, dialogs[0] || "无确认框");
  await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await waitCards(page, 1);
  rec("删除结果刷新后仍持久化", (await structureOf(page)).cardCount === 1);

  /* ---------- 多视口视觉与布局 ---------- */
  for (const vp of [
    { w: 390, h: 844, mobile: true, entryCols: 1, gridCols: 1, name: "390" },
    { w: 768, h: 1024, mobile: false, entryCols: 2, gridCols: 2, name: "768" },
    { w: 1280, h: 800, mobile: false, entryCols: 2, gridCols: 4, name: "1280" },
  ]) {
    const p = await newPage(browser, vp.w, vp.h, vp.mobile, `viewport-${vp.name}`);
    if (vp.name === "390") {
      await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    }
    await p.goto(u("/create"), { waitUntil: "networkidle2", timeout: 45000 });
    await waitCards(p, 1);
    const s = await structureOf(p);
    const over = await overflow(p);
    rec(`[${vp.name}] 页面无横向溢出`, over <= 1, `${over}px`);
    rec(`[${vp.name}] 入口卡列数正确`, s.entryCols === vp.entryCols, `${s.entryCols} 列`);
    rec(`[${vp.name}] 作品网格列数正确`, s.gridCols === vp.gridCols, `${s.gridCols} 列`);
    rec(`[${vp.name}] 核心结构完整`, s.entryCount === 2 && s.tabLabels.length === 3 && s.cardCount === 1);
    if (vp.name === "390") {
      rec("[390] 减弱动效下内容仍可见", (await bodyText(p)).includes("小说翻译创作"));
    }
    await shot(p, `create-${vp.name}-final.png`);
    await p.close();
  }

  const meaningfulErrors = jsErrors.filter((e) => !/ResizeObserver|Script error/i.test(e));
  rec("全程无 JS 运行时错误", meaningfulErrors.length === 0, meaningfulErrors.slice(0, 3).join(" | ") || "无");
  rec("全程无失败请求", badResponses.length === 0, badResponses.slice(0, 3).join(" | ") || "无");
} catch (e) {
  rec("验收脚本执行完成", false, String(e && e.stack ? e.stack.split("\n")[0] : e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
const report = {
  base: BASE,
  time: new Date().toISOString(),
  browser: EXECUTABLE,
  account: account.email,
  passed,
  failed,
  results,
  jsErrors,
  badResponses,
  screenshots,
};
writeFileSync(join(OUT, "result.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`\n=== ${passed} 通过 / ${failed} 失败 ===`);
console.log(`证据目录：${OUT}`);
process.exit(failed === 0 ? 0 : 1);
