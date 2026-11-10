/**
 * 线上产物语法底线校验（含登录后各路由的懒加载 chunk）。
 *
 * 背景：workbuddy.host 网关要求每个请求都带 ?sharecode=，漏带时返回约 3KB 的
 * 错误页（HTTP 200 / text/html）。直接 acorn 解析这种内容会得到 ESnull，结论完全作废。
 * 因此本脚本对每个 chunk 做三道硬校验：
 *   1) content-type 必须是 javascript
 *   2) 正文不得像 HTML
 *   3) 全部文件体积不得完全相同（错误页的典型特征）
 * 任何一步不过即标记失败，绝不给出假结论。
 *
 * 采集路径两条：
 *   A. 匿名可访问页（/、/login）的 SSR HTML 内联 script
 *   B. 浏览器登录后依次访问 9 个路由，从 performance 资源条目取真实加载的 chunk
 *      —— 路由 chunk 是进页面才拉的，只看首页会漏掉整站一半代码
 *
 * 用法：node scripts/syntax-floor-live.mjs
 *      跳过浏览器：NO_BROWSER=1 node scripts/syntax-floor-live.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { loginViaUi } from "./lib/login.mjs";

const require = createRequire(import.meta.url);
const acorn = require("next/dist/compiled/acorn");

const BASE = (process.env.BASE || "https://cet-reading-02555.app.workbuddy.host").replace(/\/$/, "");
const SHARECODE = process.env.SHARECODE || "2AI33QQETY";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const NO_BROWSER = process.env.NO_BROWSER === "1";

const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARECODE}`;

const versions = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const label = {
  2015: "Chrome 49 / Safari 10",
  2016: "Chrome 52 / Safari 10",
  2017: "Chrome 58 / Safari 11",
  2018: "Chrome 62 / Safari 11.1",
  2019: "Chrome 66 / Safari 12",
  2020: "Chrome 80 / Safari 13.1",
  2021: "Chrome 85 / Safari 14",
  2022: "Chrome 94 / Safari 16.4",
};

const minVersion = (code) => {
  for (const v of versions) {
    for (const sourceType of ["script", "module"]) {
      try {
        acorn.parse(code, { ecmaVersion: v, sourceType, allowHashBang: true });
        return v;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
  }
  return null;
};

const fail = [];
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  fail.push(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`线上地址：${BASE}\n`);

/**
 * 等服务真正就绪。
 * server.cjs 先 listen 再后台拉 Next，冷启动期间所有请求都会拿到「正在启动」的 HTML 占位页
 * （HTTP 200、内联 <style>、没有任何 /_next/static 资源）。若不先等，
 * 「产物缺 polyfill / 缺 CSS 兜底」这类断言会全部假失败。
 */
async function waitForApp(timeoutMs = 150_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url("/api/auth/csrf"));
      if (res.ok && (res.headers.get("content-type") || "").includes("json")) return true;
    } catch {
      /* 还没通 */
    }
    await sleep(3000);
  }
  return false;
}

if (!(await waitForApp())) {
  console.log("应用启动超时，未开始检查（避免把冷启动误判成产物缺陷）");
  process.exit(3);
}
console.log("应用已就绪\n");

/* ================= 一、首页与兜底产物 ================= */
const htmlRes = await fetch(url("/"));
const html = await htmlRes.text();
console.log("一、首页与兼容产物");
if (htmlRes.status !== 200) bad(`首页 HTTP ${htmlRes.status}`);
else ok(`首页 HTTP 200，${Math.round(html.length / 1024)}KB`);

for (const [name, needle] of [
  ["Array.prototype.at polyfill", "Array.prototype.at"],
  ["Object.hasOwn polyfill", "Object.hasOwn"],
  ["String.replaceAll polyfill", "replaceAll"],
  ["structuredClone polyfill", "structuredClone"],
  ["低版本浏览器提示条 __compat_notice", "__compat_notice"],
  ["CSS 兜底探测 data-css-fallback", "data-css-fallback"],
]) {
  if (html.includes(needle)) ok(`产物含 ${name}`);
  else bad(`产物缺 ${name}`);
}

/* ================= 二、采集 chunk 地址 ================= */
const srcSet = new Set([...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));

console.log("\n二、匿名可访问页");
for (const r of ["/", "/login"]) {
  const res = await fetch(url(r));
  const h = await res.text();
  const got = [...h.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const g of got) srcSet.add(g);
  if (res.status === 200) ok(`${r} → HTTP 200，${got.length} 个脚本`);
  else bad(`${r} → HTTP ${res.status}`);
}

/* ================= 三、浏览器登录后遍历路由 ================= */
const ROUTES = ["/cet4", "/cet6", "/leaderboard", "/favorites", "/mistakes", "/vocab", "/profile", "/admin"];
// 这三个路由本来就会重定向（/cet4→/?level=CET4、/admin→/ 非管理员拦截），不算失败
const EXPECT_REDIRECT = new Set(["/cet4", "/cet6", "/admin"]);

async function collectViaBrowser() {
  if (NO_BROWSER) {
    console.log("\n三、浏览器遍历（已跳过 NO_BROWSER=1）");
    return;
  }
  if (!existsSync(CHROME)) {
    console.log(`\n三、浏览器遍历（跳过：找不到 ${CHROME}）`);
    return;
  }
  console.log("\n三、浏览器登录遍历路由");
  const puppeteer = (await import("puppeteer-core")).default;
  const tag = `sf_${Date.now()}`;
  const email = `${tag}@qq.com`;
  const pwd = "Passw0rd!";

  const reg = await fetch(url("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pwd, name: "语法校验" }),
  });
  if (!reg.ok) bad(`注册测试账号 HTTP ${reg.status}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url("/login"), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });
    const login = await loginViaUi(page, { email, pwd }, { sleep });
    const logged = login.ok;
    if (logged) ok("登录并跳转");
    else bad("登录失败，后续路由 chunk 无法采集");

    // 逐路由访问，把 hydration 后的懒加载 chunk 都拉出来
    for (const r of ROUTES) {
      const before = srcSet.size;
      try {
        await page.goto(url(r), { waitUntil: "networkidle2", timeout: 45000 });
        await sleep(600);
      } catch {
        // 超时不致命，继续收集已加载的
      }
      const urls = await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.includes("/_next/static/") && n.split("?")[0].endsWith(".js"))
      );
      for (const u of urls) {
        const path = u.replace(BASE, "").split("?")[0];
        srcSet.add(path);
      }
      const cur = await page.evaluate(() => location.pathname + location.search);
      if (cur.includes(r)) ok(`${r} 进入成功，新增 ${srcSet.size - before} 个 chunk`);
      else if (EXPECT_REDIRECT.has(r)) ok(`${r} 重定向到 ${cur}（该路由设计如此）`);
      else bad(`${r} 实际停在 ${cur}，非预期重定向`);
    }
  } finally {
    await browser.close();
  }
}
await collectViaBrowser();

/* ================= 四、逐个下载并解析 ================= */
const uniq = [...srcSet];
console.log(`\n四、chunk 下载与解析（${uniq.length} 个）`);
if (uniq.length < 5) bad(`chunk 数量异常偏少（${uniq.length}），采集可能不完整`);

const rows = [];
for (const s of uniq) {
  const r = await fetch(url(s));
  const ct = r.headers.get("content-type") || "";
  const code = await r.text();
  const head = code.slice(0, 60).replace(/\s+/g, " ").trim();

  if (r.status !== 200) {
    bad(`${s} → HTTP ${r.status}`);
    continue;
  }
  if (!/javascript|ecmascript/i.test(ct)) {
    bad(`${s} → content-type=${ct}（非 JS，抓取无效）`);
    continue;
  }
  if (/^<(!doctype|html|\?xml)/i.test(head)) {
    bad(`${s} → 正文是 HTML（抓取无效）`);
    continue;
  }
  rows.push({ file: s.split("/").pop(), v: minVersion(code), kb: Math.round(code.length / 1024) });
}

rows.sort((a, b) => (b.v ?? 0) - (a.v ?? 0));
console.log();
for (const r of rows) console.log(`  ${String(r.v ?? "?").padEnd(5)} ${String(r.kb + "KB").padEnd(8)} ${r.file}`);

if (rows.length > 2) {
  const sizes = new Set(rows.map((r) => r.kb));
  if (sizes.size === 1) bad(`全部 chunk 体积相同（${[...sizes][0]}KB），判定为错误页，结论作废`);
}

/* ================= 五、结论 ================= */
console.log("\n五、语法底线");
if (rows.length === 0) {
  bad("没有任何有效 chunk，无法给出结论");
} else {
  const worst = Math.max(...rows.map((r) => r.v ?? 0));
  const nulls = rows.filter((r) => r.v === null);
  if (nulls.length) bad(`${nulls.length} 个 chunk 超 ES2025 仍解析失败：${nulls.map((r) => r.file).join(", ")}`);
  if (worst <= 2020) {
    ok(`最严一档 ES${worst} → ${label[worst]}（覆盖 iOS 13.4+ / Chrome 80+）`);
  } else {
    bad(`最严一档 ES${worst} → ${label[worst] ?? "更新"}，低于预期覆盖范围`);
  }
  // 能过 ES2020 就证明不含 class static block / 私有字段 / ??= 等
  const risky = rows.filter((r) => (r.v ?? 0) > 2020);
  for (const r of risky) bad(`${r.file} 触达 ES${r.v}，可能含 static block 或私有字段`);
}

/* ================= 六、CSS 兜底 ================= */
console.log("\n六、CSS 兜底（Chrome 99–110 认 @layer 但不认 color-mix）");
const cssHrefs = [...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]);
if (cssHrefs.length === 0) {
  bad("首页未引用任何 CSS 文件");
} else {
  let joined = "";
  for (const h of [...new Set(cssHrefs)]) {
    const r = await fetch(url(h));
    const t = await r.text();
    if (r.status !== 200) bad(`${h} → HTTP ${r.status}`);
    else joined += t;
  }
  console.log(`  CSS 共 ${Math.round(joined.length / 1024)}KB`);
  const usesColorMix = joined.includes("color-mix");
  const hasFallback = /@supports\s+not\s*\(\s*background-color\s*:\s*color-mix/.test(joined);
  if (usesColorMix) ok("使用了 color-mix（Tailwind v4 半透明底）");
  else console.log("  NOTE  未使用 color-mix，无需兜底");
  if (!usesColorMix || hasFallback) ok("存在 @supports not (color-mix) 兜底块");
  else bad("用了 color-mix 但缺少 @supports 兜底，Chrome 99–110 半透明底会消失");
  if (joined.includes("100dvh")) ok("含 100dvh 视口高度修正");
  else console.log("  NOTE  未见 100dvh");
  if (joined.includes("env(safe-area-inset-bottom)")) ok("含 iOS 安全区 env(safe-area-inset-bottom)");
  else console.log("  NOTE  未见安全区适配");
}

console.log(`\n结果：${fail.length === 0 ? "全部通过" : `${fail.length} 项未通过`}`);
if (fail.length) {
  console.log("未通过项：\n" + fail.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
