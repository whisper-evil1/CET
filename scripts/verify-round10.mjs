/**
 * 第 10 轮验收：账号不再随发布消失 / 背单词并入生词本 / 听力是整段完整稿。
 *
 * 覆盖：
 *   A. 账号保险库：注册 → 删掉本地 User 行（模拟发布重置）→ 原邮箱原密码仍能登录，
 *      且重建出来的 id 与原账号一致（作答、生词本不会挂在废墟上）。
 *   B. 会话自愈：已登录状态下 User 行被删，接口不 500，账号自动重建。
 *   C. 背单词在生词本里，不再是游戏厅的一关；旧路由 /arcade/review 会跳过去。
 *   D. 听力：播放器显示「全文 N 句」，原文可展开且 ≥8 句，整段逐句都交给朗读引擎。
 *
 * 用法：node scripts/verify-round10.mjs
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round10";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prisma = new PrismaClient();

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}
const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";

fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

/* ---------------- A / B：账号恢复（纯 HTTP，不需要浏览器） ---------------- */
async function login(email, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrf = await csrfRes.json();
  const jar = (csrfRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, email, password, json: "true" }),
    redirect: "manual",
  });
  const set = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  const sessionCookie = [...jar, ...set].find((c) => c.startsWith("authjs.session-token="));
  return { status: res.status, sessionCookie };
}

async function vocabWith(cookie) {
  const res = await fetch(`${BASE}/api/vocab`, { headers: { cookie } });
  return res.status;
}

console.log("\n[A] 账号保险库：库被重置后还能用原密码登回来");
const email = `r10probe${Date.now()}@qq.com`;
const password = "test123456";
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password, name: "第10轮" }),
});
const regBody = await reg.json();
check("注册成功", reg.ok && regBody?.data?.id, `id=${regBody?.data?.id} vaultReady=${regBody?.data?.vaultReady}`);

const created = await prisma.user.findUnique({ where: { email } });
const originalId = created?.id;
check("新账号的凭据已写入保险库", regBody?.data?.vaultReady === true);

// 模拟「发布沙箱重置运行时库」：把这条账号从本地库删掉
await prisma.user.delete({ where: { email } }).catch(() => {});
check("已模拟整库重置（本地 User 行删除）", (await prisma.user.findUnique({ where: { email } })) === null);

const relogin = await login(email, password);
check("重置后用原邮箱原密码仍可登录", Boolean(relogin.sessionCookie), `status=${relogin.status}`);

const revived = await prisma.user.findUnique({ where: { email } });
check("账号被原样重建（id 不变）", revived?.id === originalId, `${originalId} → ${revived?.id}`);
check("重建后接口可用（不再是「一点就报错」）", (await vocabWith(relogin.sessionCookie)) === 200);

console.log("\n[B] 会话自愈：登录态有效、账号行又没了");
await prisma.user.delete({ where: { email } }).catch(() => {});
const afterDelete = await vocabWith(relogin.sessionCookie);
check("接口没有 500", afterDelete !== 500, `status=${afterDelete}`);
const healed = await prisma.user.findUnique({ where: { email } });
check("会话触发的自动重建成功", healed?.id === originalId, `id=${healed?.id}`);

/* ---------------- 浏览器部分 ---------------- */
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,960", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });

// 假语音引擎：把交给合成器的文本记到 window.__spoken，用来验证「整段都念了」
await page.evaluateOnNewDocument(() => {
  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const synth = {
    speaking: false,
    getVoices: () => [],
    cancel() {},
    speak(u) {
      window.__spoken = window.__spoken ?? [];
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), 120);
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
});

console.log("\n[C] 背单词并入生词本");
await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
await sleep(900);
const vocabText = await page.evaluate(() => document.body.innerText);
check("生词本里有「背单词」入口", /背单词/.test(vocabText));
check("入口说清规则（连对 3 次）", /连对\s*3\s*次/.test(vocabText));

const clicked = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    /背单词/.test(b.textContent ?? ""),
  );
  if (!btn) return false;
  btn.click();
  return true;
});
check("点击后进入背单词视图", clicked);
await sleep(1200);
const reviewView = await page.evaluate(() => ({
  url: location.pathname + location.search,
  text: document.body.innerText.slice(0, 800),
}));
check("仍在 /vocab（不是跳去游戏厅）", reviewView.url.startsWith("/vocab"), reviewView.url);
check("出现开局说明", /连对|四选一|近义/.test(reviewView.text));
await page.screenshot({ path: `${OUT}/vocab-review.png`, fullPage: false });

const back = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    /回生词本|回词表/.test(b.textContent ?? ""),
  );
  if (!btn) return false;
  btn.click();
  return true;
});
await sleep(600);
check("能回到词表", back && (await page.evaluate(() => /学习中|已掌握/.test(document.body.innerText))));

await page.goto(`${BASE}/arcade`, { waitUntil: "networkidle2" });
await sleep(600);
const arcadeText = await page.evaluate(() => document.body.innerText);
check("游戏厅里不再有「生词本背单词」这一关", !/生词本背单词/.test(arcadeText));

await page.goto(`${BASE}/arcade/review`, { waitUntil: "networkidle2" });
await sleep(600);
const redirected = await page.evaluate(() => location.pathname + location.search);
check("旧链接 /arcade/review 自动跳到生词本", redirected.startsWith("/vocab"), redirected);

console.log("\n[D] 听力：真音频、不露原文");
await page.goto(`${BASE}/practice/cet4-2021-06-s1`, { waitUntil: "networkidle2" });
await sleep(500);
await page.evaluate(() => {
  const target = Array.from(document.querySelectorAll("nav button, button")).find((b) =>
    (b.textContent ?? "").trim() === "听力",
  );
  target?.click();
});
await sleep(1000);

/*
 * 第 13 轮起听力不再展示原文：考试里看不到原文，练听力时看着原文听等于没练。
 * 这里守两条底线：
 *   1. 页面上没有「展开原文」这类入口，也没有原文句子；
 *   2. 播放真的走 <audio> + /api/listening/audio，不是靠浏览器语音合成碰运气。
 */
const leak = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    toggle: /展开听力原文|收起听力原文/.test(text),
    sentence: /terrified cat has survived|shopping centre|Christine/i.test(text),
    playBtn: Array.from(document.querySelectorAll("button")).some((b) => /▶|❚❚/.test(b.textContent ?? "")),
  };
});
check("听力页没有「展开原文」入口", !leak.toggle);
check("听力页不出现原文句子", !leak.sentence);
check("听力页有播放按钮", leak.playBtn);

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => /▶|❚❚/.test(b.textContent ?? ""));
  btn?.click();
});
await sleep(5000);
const audio = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return { src: a?.getAttribute("src") ?? "", t: a?.currentTime ?? 0, paused: a?.paused ?? true };
});
check("播放走的是服务端音频接口", audio.src.includes("/api/listening/audio"), audio.src);
check("音频真的在播（进度在走）", !audio.paused && audio.t > 1, `${audio.t.toFixed(1)}s`);
await page.screenshot({ path: `${OUT}/listening-full.png` });

console.log("\n[E] 登录页会记住账号");
// 已登录时 /login 会直接跳首页，先清掉会话 cookie 才能看到表单
const cdp = await page.createCDPSession();
await cdp.send("Network.clearBrowserCookies");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await sleep(400);
const formAttrs = await page.evaluate(() => {
  const email = document.querySelector("input#login-email");
  const pwd = document.querySelector("input#login-password");
  return {
    emailName: email?.getAttribute("name"),
    emailAc: email?.getAttribute("autocomplete"),
    pwdName: pwd?.getAttribute("name"),
    pwdAc: pwd?.getAttribute("autocomplete"),
    hint: /30\s*天/.test(document.body.innerText),
  };
});
check("邮箱/密码字段可被浏览器密码管理器识别", formAttrs.emailName === "email" && formAttrs.pwdName === "password" && formAttrs.pwdAc === "current-password", JSON.stringify(formAttrs));
check("登录页写明「30 天免登录 + 可恢复」", formAttrs.hint);

await page.screenshot({ path: `${OUT}/login.png` });
await browser.close();

// 清理本轮测试账号
await prisma.user.deleteMany({ where: { email } }).catch(() => {});
await prisma.$disconnect();

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项未通过`}`);
process.exit(failed === 0 ? 0 : 1);
