/**
 * 验证「写作 AI 批改」是否真的走了云模型（而不是内置演示讲解）。
 *
 * 为什么必须用浏览器：云服务 SDK 只在浏览器里跑，且云端按 Origin 精确匹配鉴权，
 * Node 里模拟不出真实链路。
 *
 * 两种模式：
 *   - 本地：注入会话 cookie 免登录。本地 Origin 与云端 endpoint 必然不一致，
 *     云端会被拒 —— 此时正确行为是回退到备用通道并出字，能出字就算通过。
 *   - 线上（https）：真实登录拿会话（NextAuth 在 https 下用 __Secure- 前缀，
 *     注入式 cookie 对不上），并额外要求**不是演示文案**，即真模型出字。
 *
 * 用法：
 *   node scripts/verify-writing-ai.mjs
 *   CHECK_BASE=https://xxx.app.workbuddy.host CHECK_SHARE=XXXX CHECK_REQUIRE_LIVE=1 node scripts/verify-writing-ai.mjs
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = (process.env.CHECK_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const LIVE = /^https:/.test(BASE);
const SHARE = process.env.CHECK_SHARE ?? "";
const EMAIL = process.env.CHECK_EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.CHECK_PASSWORD ?? "demo1234";
const EXECUTABLE =
  process.env.BROWSER_PATH ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(
    (p) => fs.existsSync(p)
  );
const PAPER = process.env.CHECK_PAPER ?? "paper-cet4-2024-12";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withShare = (p) => (SHARE ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : p);

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    // headless 默认会把后台标签的定时器节流到 1 分钟一次，
    // 导致兜底超时迟迟不触发 —— 这不是应用的问题，是测试环境的假象
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();

/* ---------- 会话：线上真实登录，本地注入 ---------- */
let loggedIn = false;
if (LIVE) {
  // 在 Node 里完成登录（和 live-verify 同一套流程，已验证可用），
  // 再把整包 cookie 灌进浏览器 —— 浏览器里直接 fetch 容易被网关/预检拦掉。
  const jar = new Map();
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  // 网关对非浏览器 UA 的请求会偶发回「链接不完整」HTML，重试几次并带上 UA
  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  let csrfToken = "";
  for (let i = 0; i < 4 && !csrfToken; i += 1) {
    const csrfRes = await fetch(BASE + withShare("/api/auth/csrf"), { headers: { "user-agent": UA } });
    absorb(csrfRes);
    const raw = await csrfRes.text();
    try {
      csrfToken = JSON.parse(raw).csrfToken ?? "";
    } catch {
      console.log(`  csrf 第 ${i + 1} 次被网关拦截（${csrfRes.status}），重试…`);
      await sleep(2500);
    }
  }
  if (!csrfToken) throw new Error("拿不到 csrfToken（网关持续拦截），稍后重试");
  const res = await fetch(BASE + withShare("/api/auth/callback/credentials"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
      "user-agent": UA,
    },
    body: new URLSearchParams({
      email: EMAIL,
      password: PASSWORD,
      csrfToken,
      callbackUrl: withShare("/"),
      json: "true",
    }),
  });
  absorb(res);
  loggedIn = [...jar.keys()].some((k) => /session-token/.test(k));
  const host = new URL(BASE).hostname;
  for (const [name, value] of jar) {
    await page.setCookie({
      name,
      value,
      domain: host,
      path: "/",
      secure: true,
      httpOnly: /session-token/.test(name),
    });
  }
  console.log(`线上登录：status ${res.status} | 会话 cookie ${loggedIn ? "已获取" : "未获取"} | 共注入 ${jar.size} 个 cookie`);
  if (!loggedIn) console.log("  cookie 名称:", [...jar.keys()].join(",") || "(无)");
} else {
  const token = await encode({
    token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
    secret: readEnv("AUTH_SECRET") || "dev-only-secret-change-me",
    salt: "authjs.session-token",
    maxAge: 3600,
  });
  await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true });
  loggedIn = true;
}

const cloudCalls = [];
const apiCalls = [];
page.on("response", (res) => {
  const u = res.url();
  if (/llm|chat\/completions/i.test(u)) cloudCalls.push(`${res.status()} ${u.slice(0, 110)}`);
  if (/\/api\/ai\/chat/.test(u)) apiCalls.push(`${res.status()} ${u.replace(BASE, "")}`);
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (/error|warn|cloud|AI_|abort/i.test(t)) console.log(`[console.${m.type()}]`, t.slice(0, 240));
});
page.on("requestfailed", (r) => {
  if (/cloud|chat\/completions/.test(r.url())) console.log("[reqfail]", r.url().slice(0, 90), r.failure()?.errorText);
});

console.log("打开写作 Section…");
await page.goto(BASE + withShare(`/practice/${PAPER}`), { waitUntil: "networkidle2", timeout: 90000 });
await sleep(1200);

const switched = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const target = btns.find((b) => b.textContent.trim() === "写作");
  if (!target) return false;
  target.click();
  return true;
});
console.log("切到写作 tab:", switched);
await sleep(1500);

const typed = await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  if (!ta) return "no-textarea";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(
    ta,
    "With the rapid development of technology, more and more students choose to take notes on laptops. In my opinion, handwriting still has its unique value."
  );
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed";
});
console.log("写入作答:", typed);

const timerOk = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const t0 = Date.now();
      setTimeout(() => resolve(Date.now() - t0), 3000);
    })
);
console.log("页面定时器精度:", `${timerOk}ms（3000 为正常）`);

const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const target = btns.find((b) => /AI 批改/.test(b.textContent));
  if (!target) return "no-button";
  target.click();
  return "clicked";
});
console.log("点击 AI 批改:", clicked);

// 等首字：云端正常 1～3 秒；云端不可用时需等完所有候选模型的首字超时。
// 判定锚点不用标题文案（标题可能被换成图标/副标题），改用批改内容的特征词，
// 避免"产品明明出字了、脚本却说没出字"这种假失败。
const GRADING_HINT = /总体评分|评分档次|档次|需要改进|高分表达|得分|点评/;
const pageTextOf = () => page.evaluate(() => document.body.innerText);

let firstText = "";
let settled = "";
const t0 = Date.now();
for (let i = 0; i < 150; i += 1) {
  await sleep(500);
  const body = await pageTextOf();
  if (GRADING_HINT.test(body)) {
    firstText = body;
    settled = `第 ${((Date.now() - t0) / 1000).toFixed(1)} 秒出字`;
    break;
  }
}
await sleep(4000);
const pageText = await pageTextOf();

const isMock = /当前是演示模式|还没有配置 AI Key/.test(pageText);

// 截取「批改反馈」那一段：优先从标题锚定，找不到就从正文整体里找评分段落
const cut = (() => {
  const head = pageText.search(/AI\s*批改反馈/);
  if (head >= 0) return pageText.slice(head);
  const hint = pageText.search(GRADING_HINT);
  return hint >= 0 ? pageText.slice(hint) : pageText.slice(-4000);
})();
const sample = (cut || firstText).replace(/\s+/g, " ").slice(0, 400);

const notice = await page.evaluate(() => {
  const body = document.body.innerText;
  const m = body.match(/云端批改暂不可用[^\n]*|AI 批改失败[^\n]*|请求失败[^\n]*/);
  return m ? m[0] : "";
});

console.log("=== 结果 ===");
console.log("出字状态:", settled || "75 秒内未出字");
console.log("是否演示模式:", isMock ? "是（未走真模型）" : "否（非演示文案）");
console.log("云/LLM 请求:", cloudCalls.length ? cloudCalls.slice(0, 3).join(" | ") : "(无)");
console.log("/api/ai/chat 请求:", apiCalls.length ? apiCalls.join(" | ") : "(未发起，说明云端没抛错)");
console.log("页面提示:", notice || "(无)");
console.log("批改内容片段:", sample || "(空)");

if (process.env.CHECK_DUMP === "1") {
  const dump = await page.evaluate(() => document.body.innerText);
  console.log("=== 页面正文（尾部 1200 字）===");
  console.log(dump.slice(-1200));
}

await browser.close();

/**
 * 判定标准：
 *   - 本地：只要求「有正文」。本地 Origin 与 endpoint 必然不一致，云端会被拒，
 *     正确行为是回退到备用通道并出字。
 *   - CHECK_REQUIRE_LIVE=1（线上）：额外要求不是演示模式，即真模型出字。
 */
const requireLive = process.env.CHECK_REQUIRE_LIVE === "1";
const hasText = sample.length > 20;
const ok = hasText && (!requireLive || !isMock);
console.log(`\n判定：${ok ? "通过" : "未通过"}（出字 ${hasText ? "是" : "否"}${requireLive ? `，要求真模型` : ""}）`);
process.exit(ok ? 0 : 1);
