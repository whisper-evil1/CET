/**
 * 浏览器级验收：全题型界面 + 移动端布局 + 兼容性资源。
 *
 * 覆盖远端 v2.1 新增的能力：
 *   - 四个 Section（写作 / 听力 / 阅读 / 翻译）是否都能切换到并正确渲染
 *   - 写作/翻译：文本框 + AI 批改按钮 + 参考范文
 *   - 听力：播放器（授权音频用 audio，缺录音时用系统朗读）
 *   - 阅读：选项 + 交卷判分（含快捷键提示）
 *   - 老内核降级样式 legacy.css 是否真的被加载
 *   - 360px 移动端是否有横向溢出
 *   - 页面有无落进错误边界（Application error）
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3000";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

let pass = 0;
const fails = [];
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? " —— " + detail : ""}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}${detail ? " —— " + detail : ""}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
const badNet = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
const missingAssets = [];
page.on("response", (res) => {
  if (res.status() >= 500) badNet.push(`${res.status()} ${res.url().replace(BASE, "")}`);
  if (res.status() === 404) missingAssets.push(res.url().replace(BASE, ""));
});
await page.setCookie({
  name: "authjs.session-token",
  value: token,
  domain: "127.0.0.1",
  path: "/",
  httpOnly: true,
});

/* ---------- 1. 打开练习页 ---------- */
console.log("\n[1] 打开练习页");
await page.goto(`${BASE}/practice/cet4-2026-06-s1`, { waitUntil: "networkidle2" });
await sleep(1500);
const bodyText = await page.evaluate(() => document.body.innerText);
check("页面正常渲染（未落错误边界）", !/Application error|服务器开小差/.test(bodyText));
check("能看到试卷标题", bodyText.includes("2024") || bodyText.includes("四级"));

/* ---------- 2. Section 页签 ---------- */
console.log("\n[2] Section 页签");
const tabs = await page.evaluate(() => {
  const texts = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
  return [...new Set(texts)].filter((t) => ["写作", "听力", "阅读", "翻译"].some((k) => t.includes(k)));
});
console.log("     页面上的题型页签:", JSON.stringify(tabs));
check("四个题型页签都在", ["写作", "听力", "阅读", "翻译"].every((k) => tabs.some((t) => t.includes(k))), tabs.join(" / "));

/* ---------- 3. 逐个题型检查渲染 ---------- */
async function clickTab(name) {
  const h = await page.evaluateHandle(
    (n) => [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(n)) ?? null,
    name,
  );
  const el = h.asElement();
  if (!el) return false;
  await el.click();
  await sleep(1200);
  return true;
}

console.log("\n[3] 阅读：选项与提交");
if (await clickTab("阅读")) {
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    return {
      submit: btns.some((t) => t.includes("交卷判分") || t.includes("重新交卷") || t.includes("提交答案")),
      optionCount: btns.filter((t) => /^[A-D]/.test(t)).length,
      hasArticle: document.querySelectorAll("[data-word]").length,
    };
  });
  check("阅读题渲染了可点单词", info.hasArticle > 0, `${info.hasArticle} 个`);
  check("阅读题有交卷判分按钮", info.submit);
  check("阅读题四个选项齐全", info.optionCount >= 4, `${info.optionCount} 个`);
} else {
  check("阅读页签可点击", false);
}

console.log("\n[4] 写作：输入框 + AI 批改 + 参考范文");
if (await clickTab("写作")) {
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    return {
      textarea: document.querySelectorAll("textarea").length,
      ai: btns.some((t) => t.includes("AI 批改")),
      sample: document.body.innerText.includes("参考范文") || document.body.innerText.includes("参考"),
    };
  });
  check("写作题有作答文本框", info.textarea > 0, `${info.textarea} 个`);
  check("写作题有 AI 批改按钮", info.ai);
  check("写作题有参考内容", info.sample);
} else {
  check("写作页签可点击", false);
}

console.log("\n[5] 听力：播放器");
if (await clickTab("听力")) {
  const info = await page.evaluate(() => ({
    audio: document.querySelectorAll("audio").length,
    // 没有授权录音时走系统朗读，「播放 / 语速」就是控件本身
    synth: /语速/.test(document.body.innerText) && /播放|本段录音|正在朗读/.test(document.body.innerText),
    transcriptToggle: /听力原文/.test(document.body.innerText),
    transcript: document.body.innerText.length > 200,
  }));
  check("听力题有播放控件（audio 或系统朗读）", info.audio > 0 || info.synth, info.audio ? "audio" : "synth");
  check("听力题可展开原文", info.transcriptToggle);
  check("听力题有正文内容", info.transcript);
} else {
  check("听力页签可点击", false);
}

console.log("\n[6] 翻译：输入框 + 参考译文");
if (await clickTab("翻译")) {
  const info = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
    return {
      textarea: document.querySelectorAll("textarea").length,
      sample: document.body.innerText.includes("参考译文") || document.body.innerText.includes("参考"),
      ai: btns.some((t) => t.includes("AI 批改")),
    };
  });
  check("翻译题有作答文本框", info.textarea > 0, `${info.textarea} 个`);
  check("翻译题有参考译文", info.sample);
  check("翻译题有 AI 批改按钮", info.ai);
} else {
  check("翻译页签可点击", false);
}

/* ---------- 7. 兼容性资源 ---------- */
console.log("\n[7] 兼容性资源");
const assets = await page.evaluate(async () => {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href") ?? "");
  // legacy.css 由 layout.tsx 直接 import，会被打进同一个 CSS bundle，link 里看不到文件名，
  // 只能去样式内容里找它独有、且现代浏览器不会生效的选择器
  let hasFallbackRules = false;
  for (const href of links) {
    try {
      const text = await fetch(href).then((r) => r.text());
      if (text.includes("data-css-fallback")) {
        hasFallbackRules = true;
        break;
      }
    } catch {
      /* 单个样式表取不到不影响判定 */
    }
  }
  return { links, hasFallbackRules };
});
const legacyLoaded = assets.hasFallbackRules;
console.log("     样式表:", JSON.stringify(assets.links.slice(0, 6)));
check(
  "legacy.css（老内核降级样式）已打进样式包",
  legacyLoaded,
  legacyLoaded ? "含 data-css-fallback 规则" : "样式包里没有降级规则",
);

/** 故意访问 404 页会记一条「Failed to load resource」，那是用例本身制造的，不算页面报错 */
const errorsBefore404 = errors.length;

const errPage = await page.goto(`${BASE}/error-check-not-exist`, { waitUntil: "domcontentloaded" }).catch(() => null);
check("404 路由有响应（未崩溃）", errPage?.status() === 404, String(errPage?.status()));

/* ---------- 8. 移动端 360px ---------- */
console.log("\n[8] 移动端 360px 布局");
await page.setViewport({ width: 360, height: 740, isMobile: true });
await page.goto(`${BASE}/practice/cet4-2026-06-s1`, { waitUntil: "networkidle2" });
await sleep(1500);
const mobile = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  hasTabSwitch: document.body.innerText.includes("原文") || document.body.innerText.includes("题目"),
  text: document.body.innerText.length,
}));
check("360px 无横向溢出", mobile.overflow <= 1, `溢出 ${mobile.overflow}px`);
check("移动端有原文/题目切换", mobile.hasTabSwitch);
check("移动端内容正常渲染", mobile.text > 150);

/* ---------- 9. 运行时报错 ---------- */
console.log("\n[9] 运行时报错");
const realErrors = errors
  .slice(0, errorsBefore404)
  .filter((e) => !/favicon|Download the React DevTools|hydrat/i.test(e));
check(
  "无页面级 JS 报错",
  realErrors.length === 0,
  realErrors.length ? `${realErrors.slice(0, 2).join(" | ")}${missingAssets.length ? ` ⟵ 404: ${missingAssets.slice(0, 3).join(", ")}` : ""}` : "",
);
check("无 5xx 响应", badNet.length === 0, badNet.slice(0, 2).join(" | "));

await browser.close();

console.log("\n" + "─".repeat(60));
console.log(`合计 ${pass + fails.length} 项，通过 ${pass}，失败 ${fails.length}`);
if (fails.length) console.log("失败项:", fails.join(" / "));
console.log("─".repeat(60));
process.exit(fails.length ? 1 : 0);
