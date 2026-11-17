/**
 * 线上验收（真环境，不是本地 dev）：第 13 轮 + 第 12 轮的关键承诺在线上是否成立。
 *
 * 和本地 shots-round*.mjs 的区别：本地脚本靠注入 AUTH_SECRET 签的 JWT cookie 跳过登录，
 * 线上 secret 不同、cookie 也加密，注入无效。所以这里走**真实登录流程**：
 *   1. 用 /api/auth/register 建一个临时账号（线上库真的写数据）
 *   2. 打开 /login，像用户一样填邮箱密码、点登录
 *   3. 再进练习页做听力断言
 *
 * 断言清单：
 *   A. 线上能登录（账号数据真的落库，不是前端假登录）
 *   B. 听力用的是 /api/listening/audio 返回的 mp3，currentTime 在走、duration > 30s
 *   C. 点「下一题」后音频 continue（不归零、不暂停）
 *   D. 切到阅读栏仍在播
 *   E. 页面上搜不到听力原文句子
 *   F. 「我的」有账号安全区（邮箱/手机号/改密码）
 *   G. 手机端 390px 无横向溢出
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";
const OUT = "shots/live-r13";
const q = (path) => `${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SC}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

/* ---------- 1. 建临时账号（线上库要真写进去） ---------- */
const stamp = Date.now().toString(36);
const EMAIL = process.env.LIVE_EMAIL ?? `live${stamp}@qq.com`;
const PASSWORD = process.env.LIVE_PASSWORD ?? `Live${stamp.slice(-6)}9`;

/**
 * 打开页面，直到真正渲染出应用界面。
 *
 * 线上容器会时不时回到启动阶段（发布后的编译、平台回收后冷启动），
 * 这时返回的是「正在启动 · 本页每 3 秒自动刷新」那张过渡页，状态码照样是 200。
 * 所以不能只看 HTTP 状态，要等页面上出现真实元素再往下走。
 */
async function go(target, path, tries = 10) {
  for (let i = 1; i <= tries; i += 1) {
    await target.goto(q(path), { waitUntil: "domcontentloaded", timeout: 90_000 }).catch(() => {});
    for (let k = 0; k < 15; k += 1) {
      await sleep(1500);
      const st = await target
        .evaluate(() => {
          const text = document.body?.innerText ?? "";
          return {
            boot: /正在启动|服务启动失败|应用启动失败/.test(text),
            drawn: Boolean(document.querySelector("input, form, main, [data-ready], button")),
          };
        })
        .catch(() => null);
      if (!st) continue;
      if (!st.boot && st.drawn) return true;
    }
    console.log(`  … 第 ${i} 次打开仍停在启动页，重新导航`);
  }
  return false;
}

/**
 * 等 React 完成 hydration。
 *
 * 为什么必须等：登录表单是靠 onSubmit 拦下默认提交的。JS 还没挂上时点「登录」，
 * 浏览器会按原生表单 GET 提交，密码直接进地址栏（/login?password=…）。
 * 线上首屏是服务端直出的，肉眼看着"已经能填了"，其实事件还没绑上。
 *
 * 探测方法：点一下「注册」标签，看表单是否真的切换成注册态（多出「昵称」）。
 * 换得动 = hydration 完成；换不动就再等。
 */
async function waitHydrated(page, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const switched = await page
      .evaluate(() => {
        const tab = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "注册");
        if (!tab) return false;
        tab.click();
        return new Promise((resolve) =>
          setTimeout(() => {
            const hasNick = [...document.querySelectorAll("label")].some((l) => /昵称/.test(l.textContent ?? ""));
            if (hasNick) {
              const back = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "登录");
              back?.click();
            }
            resolve(hasNick);
          }, 350),
        );
      })
      .catch(() => false);
    if (switched) {
      await sleep(400);
      return true;
    }
    await sleep(800);
  }
  return false;
}

/* ---------- 2. 真实登录 ---------- */
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));

await go(page, "/login");
await page.waitForSelector('input[name="email"]', { timeout: 150_000 });

/* 账号由外部建好（curl 走注册接口，已验证 cloudSynced=true），这里只验登录 */
if (!process.env.LIVE_EMAIL) {
  const reg = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: "线上验收" }),
      });
      return { status: res.status, body: (await res.text()).slice(0, 160) };
    },
    { email: EMAIL, password: PASSWORD },
  ).catch((e) => ({ status: 0, body: String(e.message) }));
  check("线上注册真的写进了库", reg.status === 200, `HTTP ${reg.status} ${reg.body.slice(0, 120)}`);
}

const hydrated = await waitHydrated(page);
check("登录表单 hydration 完成（点登录不会变成 GET 提交）", hydrated);
await page.type('input[name="email"]', EMAIL, { delay: 12 });
await page.type('input[name="password"]', PASSWORD, { delay: 12 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.type === "submit");
  btn?.click();
});
await page
  .waitForFunction(() => !/\/login/.test(location.pathname), { timeout: 40_000 })
  .catch(() => null);
await sleep(1200);
const afterLogin = page.url();
const leaked = /[?&]password=/.test(afterLogin);
const loggedIn = !/\/login/.test(new URL(afterLogin).pathname);
const loginHint = await page
  .evaluate(() => document.body?.innerText?.replace(/\s+/g, " ").slice(0, 120) ?? "")
  .catch(() => "");
check("线上真实登录成功（账号落库）", loggedIn && !leaked, leaked ? "密码被带进地址栏（未 hydration）" : afterLogin.replace(BASE, ""));
if (!loggedIn) console.log("   页面提示:", loginHint);
await page.screenshot({ path: `${OUT}/01-after-login.png` });

/* ---------- 3. 进练习页，切到听力 ---------- */
await go(page, `/practice/${PAPER}`);
await sleep(1200);
const onPractice = /^\/practice\//.test(new URL(page.url()).pathname);
check("练习页可访问（未被打回登录）", onPractice, page.url().replace(BASE, ""));

// 点「听力」板块标签
const clickedListening = await page.evaluate(() => {
  const hit = [...document.querySelectorAll("button,a")].find(
    (el) => el.textContent?.trim() === "听力" && el.offsetParent !== null,
  );
  if (hit) { hit.click(); return true; }
  return false;
});
await sleep(1200);
check("能切到听力板块", clickedListening);

// 段落标签数量（新闻/长对话/篇章）
const passageTabs = await page.evaluate(() =>
  [...document.querySelectorAll("button")].filter((b) => /^(新闻|长对话|篇章|讲座)\s*\d+$/.test(b.textContent?.trim() ?? "")).length,
);
check("听力段落标签齐全（8 段）", passageTabs >= 8, `${passageTabs} 个标签`);

/* ---------- 4. 播放 ---------- */
const clickedPlay = await page.evaluate(() => {
  const hit = document.querySelector('button[aria-label="播放"]');
  if (hit) { hit.click(); return true; }
  return false;
});
check("有播放按钮并且点到了", clickedPlay);
await sleep(3500);

const state1 = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return a
    ? { src: a.getAttribute("src") ?? a.currentSrc, t: a.currentTime, d: a.duration, paused: a.paused, err: a.error?.code ?? null }
    : null;
});
check("播放器用的是服务端音频接口", Boolean(state1?.src?.includes("/api/listening/audio")), state1?.src?.slice(0, 90) ?? "没有 audio 元素");
check("音频真的在走（currentTime 增长）", Boolean(state1 && state1.t > 0.5), state1 ? `t=${state1.t.toFixed(2)}s` : "无");
check("音频时长合理（整段 >30s）", Boolean(state1 && Number.isFinite(state1.d) && state1.d > 30), state1 ? `duration=${Number.isFinite(state1.d) ? state1.d.toFixed(1) : state1.d}s` : "无");
check("播放无解码错误", Boolean(state1 && state1.err === null), state1 ? `error=${state1.err}` : "无");
await page.screenshot({ path: `${OUT}/02-listening-playing.png` });

/* ---------- 5. 点「下一题」音频不能断 ---------- */
const tBefore = state1?.t ?? 0;
const clickedNext = await page.evaluate(() => {
  const hit = [...document.querySelectorAll("button")].find((b) => /下一题/.test(b.textContent ?? "") && !b.disabled);
  if (hit) { hit.click(); return true; }
  return false;
});
await sleep(2600);
const state2 = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return a ? { t: a.currentTime, paused: a.paused, src: a.getAttribute("src") ?? a.currentSrc } : null;
});
check("「下一题」按钮可用", clickedNext);
check(
  "切题后音频继续播（不中断、不归零）",
  Boolean(state2 && !state2.paused && state2.t > tBefore + 0.8),
  `切题前 ${tBefore.toFixed(2)}s → 切题后 ${state2 ? state2.t.toFixed(2) : "?"}s, paused=${state2?.paused}`,
);
await page.screenshot({ path: `${OUT}/03-after-next-question.png` });

/* ---------- 6. 切到阅读栏仍在播 ---------- */
await page.evaluate(() => {
  const hit = [...document.querySelectorAll("button,a")].find(
    (el) => el.textContent?.trim() === "阅读" && el.offsetParent !== null,
  );
  hit?.click();
});
await sleep(2500);
const state3 = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return a ? { t: a.currentTime, paused: a.paused } : null;
});
check(
  "切到阅读栏仍在播",
  Boolean(state3 && !state3.paused && state3.t > (state2?.t ?? 0) + 0.5),
  `阅读栏下 t=${state3 ? state3.t.toFixed(2) : "?"}s, paused=${state3?.paused}`,
);

/* ---------- 7. 不显示听力原文 ---------- */
await page.evaluate(() => {
  const hit = [...document.querySelectorAll("button,a")].find(
    (el) => el.textContent?.trim() === "听力" && el.offsetParent !== null,
  );
  hit?.click();
});
await sleep(1000);
const leaks = await page.evaluate(() => {
  // 只看整句原文（题干里可能撞到单词，所以用原文独有长句）
  const needles = ["A terrified cat has survived", "Cats Protection", "shouting for me to come"];
  const text = document.body.innerText;
  return needles.filter((n) => text.includes(n));
});
check("页面上搜不到听力原文", leaks.length === 0, leaks.length ? `泄漏：${leaks.join(" / ")}` : "干净");
const hasTranscriptToggle = await page.evaluate(() =>
  /展开听力原文|查看原文|听力原文/.test(document.body.innerText),
);
check("没有「展开听力原文」入口", !hasTranscriptToggle);

/* ---------- 8. 「我的」账号安全区 ---------- */
await go(page, "/profile");
await sleep(1200);
const profileText = await page.evaluate(() => document.body.innerText);
check("「我的」页有账号安全区", /账号安全|账号与安全/.test(profileText));
check("显示绑定邮箱", /邮箱/.test(profileText) && profileText.includes("live"), "");
check("有手机号绑定入口", /手机号/.test(profileText));
check("有改密码/设密码入口", /(修改|修改密码|设置密码|改密码)/.test(profileText));
await page.screenshot({ path: `${OUT}/04-profile-security.png` });

/* ---------- 9. 手机端 ---------- */
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await m.setCookie(...(await page.cookies()));
await go(m, `/practice/${PAPER}`);
await sleep(1500);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("手机端 390px 无横向溢出", overflow <= 2, `溢出 ${overflow}px`);
await m.screenshot({ path: `${OUT}/05-mobile.png` });

check("无页面级 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 线上验收 ${pass}/${results.length} ====`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ base: BASE, paper: PAPER, email: EMAIL, results }, null, 2));
process.exit(pass === results.length ? 0 : 1);
