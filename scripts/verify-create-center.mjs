// 创作中心（v2.1）合并验收脚本
// 覆盖：/create 首页（CreateHub 组件 + hub-* 样式 + tab 切换）
//       /create/novel（NovelStudio）、/create/video（VideoStudio）
//       Agent/视频导出 API 路由与 lib 存在性
// 用法：BASE=http://127.0.0.1:3100 node scripts/verify-create-center.mjs
//       线上：BASE=https://xxx SC=xxx node scripts/verify-create-center.mjs
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

const errors = [];
const notFounds = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push("[console] " + m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push("[pageerror] " + String(e).slice(0, 200)));
page.on("response", (r) => {
  if (r.status() === 404) notFounds.push(r.url());
});

async function waitHydrated() {
  for (let i = 0; i < 40; i++) {
    const h = await page
      .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
      .catch(() => false);
    if (h) return true;
    await sleep(1000);
  }
  return false;
}

async function doLogin() {
  await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitHydrated();
  await sleep(1500);
  for (let i = 0; i < 5; i++) {
    const ok = await page
      .evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /演示账号/.test(x.textContent ?? ""));
        if (b) {
          b.click();
          return true;
        }
        return false;
      })
      .catch(() => false);
    if (ok) break;
    await sleep(1500);
  }
  for (let i = 0; i < 12; i++) {
    if (!page.url().includes("/login")) break;
    await sleep(1500);
  }
  return !page.url().includes("/login");
}

async function load(p, label) {
  await page.goto(url(p), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitHydrated();
  if (page.url().includes("/login")) await doLogin();
  await sleep(2500);
  console.log(`\n【${label}】 URL: ${page.url().replace(BASE, "")}`);
}

/* ---------- 0. 显式登录 ---------- */
const loggedIn = await doLogin();
check("演示账号登录成功", loggedIn);

/* ---------- 1. /create 创作中心首页 ---------- */
await load("/create", "创作中心首页");
let info = await page.evaluate(() => {
  const t = document.body?.innerText ?? "";
  const html = document.body?.innerHTML ?? "";
  return {
    title: t.includes("我的创作"),
    hasTabs: ["全部作品", "小说英译", "短视频出海"].every((x) => t.includes(x)),
    hasNewBtn: t.includes("新建作品") || t.includes("新建视频"),
    hasHubTab: html.includes("hub-tab"),
    hasGrid: html.includes("hub-grid"),
    hasEmpty: html.includes("hub-empty"),
    hasCards: html.includes("hub-work-card") || html.includes("hub-cover"),
  };
});
check("创作中心首页标题「我的创作」", info.title);
check("三个 tab 齐全（全部作品/小说英译/短视频出海）", info.hasTabs);
check("「新建作品/新建视频」入口存在", info.hasNewBtn);
check("CreateHub 组件已渲染（hub-tab 存在）", info.hasHubTab);
check("作品区已渲染（网格或空状态）", info.hasGrid || info.hasEmpty || info.hasCards);

// tab 切换：点「小说英译」
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /小说英译/.test(x.textContent ?? ""));
  b?.click();
});
await sleep(600);
const tabActive = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find(
    (x) => (x.className || "").includes("hub-tab-active") && /小说英译/.test(x.textContent ?? ""),
  );
  return !!el;
});
check("tab 可切换（小说英译激活态）", tabActive);

/* ---------- 2. /create/novel 小说工作台 ---------- */
await load("/create/novel", "小说英译工作台");
info = await page.evaluate(() => {
  const t = document.body?.innerText ?? "";
  const ta = [...document.querySelectorAll("textarea")].length;
  const btn = [...document.querySelectorAll("button")].some((b) => /生成|翻译|改写/.test(b.textContent ?? ""));
  return {
    title: t.includes("中文一段") || t.includes("英文一段"),
    hasTextarea: ta > 0,
    hasAction: btn,
    hasImport: t.includes("上传文件导入"),
  };
});
check("小说工作台标题（中文一段，英文一段）", info.title);
check("小说工作台有输入框", info.hasTextarea);
check("小说工作台有生成按钮", info.hasAction);
check("小说工作台有「上传文件导入」入口", info.hasImport);

/* ---------- 3. /create/video 短视频工作台 ---------- */
await load("/create/video", "短视频出海工作台");
info = await page.evaluate(() => {
  const t = document.body?.innerText ?? "";
  const ta = [...document.querySelectorAll("textarea")].length;
  const btn = [...document.querySelectorAll("button")].some((b) => /生成|口播|视频/.test(b.textContent ?? ""));
  return {
    hasTextarea: ta > 0,
    hasAction: btn,
  };
});
check("短视频工作台有输入框", info.hasTextarea);
check("短视频工作台有生成按钮", info.hasAction);

/* ---------- 4. 导出/视频 API 路由存在性（静态验证源码） ---------- */
const routes = [
  "src/app/api/create/export/route.ts",
  "src/app/api/create/export-subs/route.ts",
  "src/app/api/create/export-video/route.ts",
  "src/app/api/create/export-video-file/route.ts",
  "src/app/api/create/ingest/route.ts",
  "src/app/api/create/video-probe/route.ts",
  "src/app/api/agent/creation/route.ts",
  "src/app/api/agent/solver/photo/route.ts",
];
const libs = [
  "src/lib/agent-client.ts",
  "src/lib/agent-adapter.ts",
  "src/lib/agent-builtin.ts",
  "src/lib/agent-redact.ts",
  "src/lib/dify-agent.ts",
  "src/lib/agent-photo-builtin.ts",
  "src/lib/video-dub.ts",
  "src/lib/video-export.ts",
  "src/lib/video-probe.ts",
  "src/lib/doc-ingest.ts",
];
const missingRoutes = routes.filter((f) => !fs.existsSync(f));
const missingLibs = libs.filter((f) => !fs.existsSync(f));
check("8 个创作/Agent API 路由已就位", missingRoutes.length === 0, missingRoutes.join(","));
check("10 个创作/Agent lib 已就位", missingLibs.length === 0, missingLibs.join(","));

/* ---------- 5. 无 JS 报错（404 仅允许 favicon 类） ---------- */
const fatal = errors.filter((e) => !/favicon|Hydration|418/i.test(e));
const real404 = notFounds.filter((u) => !/favicon/i.test(u));
check("全程无 JS 报错", fatal.length === 0, fatal.slice(0, 3).join(" | "));
check("无异常 404（排除 favicon）", real404.length === 0, real404.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n== 结果 == 通过 ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
