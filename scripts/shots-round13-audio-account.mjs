/**
 * 第 13 轮验收：听力「能听、能切、不露原文」+ 账号安全。
 *
 * 这一轮改的是三件用户直接抱怨的事，所以断言也按这三件事写：
 *   A. 听力播放器真的在放（currentTime 在走），用的是 <audio src=/api/listening/audio>；
 *   B. 页面上看不到听力原文（没有任何一句原文文本、没有「展开听力原文」入口）；
 *   C. 切到题目后音频不断（换题、切栏之后 currentTime 继续增长）；
 *   D. 换到下一段会自动切歌（src 变了）；
 *   E. 「我的」页有账号安全区（绑定手机号 / 邮箱、改密码）；
 *   F. 手机端 390px 无横向溢出，无 JS 报错。
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3011";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round13";
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";

const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
const line = raw.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="));
const secret = line ? line.split("=")[1].trim().replace(/^["']|["']$/g, "") : "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    // headless 里没有声卡，加一个假输出设备，否则 play() 可能直接 reject
    "--use-fake-device-for-media-stream",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1.5 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/i.test(m.text())) errors.push(m.text().slice(0, 200));
});

await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = async (text, exact = true) =>
  page.evaluate(
    (t, ex) => {
      const nodes = Array.from(document.querySelectorAll("button, a"));
      const hit = nodes.find((n) => (ex ? n.textContent?.trim() === t : n.textContent?.includes(t)));
      if (!hit) return false;
      hit.click();
      return true;
    },
    text,
    exact,
  );

// ---------- 进入试卷 → 听力 ----------
await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
await wait(1200);
check("切到听力栏目", await clickText("听力"));
await wait(1200);
await page.screenshot({ path: `${OUT}/a-listening.png` });

// A. 原文不露
const leak = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasToggle: /展开听力原文|收起听力原文|听力原文/.test(text),
    /*
     * 只认原文独有的句子。题干里出现 "engine cover" 是正常的 ——
     * 第 1 题问的就是「猫在哪被发现」，拿关键词判会把自己的题目当成原文。
     */
    hasSentence: /A terrified cat has survived|Cats Protection|shouting for me to come|five-mile round trip/i.test(text),
    hasPlayButton: Array.from(document.querySelectorAll("button")).some((b) =>
      /▶|❚❚/.test(b.textContent ?? ""),
    ),
  };
});
check("听力页没有「展开原文」入口", !leak.hasToggle);
check("页面上不出现听力原文句子", !leak.hasSentence);
check("有播放按钮", leak.hasPlayButton);

// B. 点播放 → currentTime 真的在走
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => /▶|❚❚/.test(b.textContent ?? ""));
  btn?.click();
});
await wait(7000);
const playing1 = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return { t: a?.currentTime ?? 0, paused: a?.paused ?? true, dur: a?.duration ?? 0, src: a?.getAttribute("src") ?? "" };
});
check("音频进入播放状态", !playing1.paused, JSON.stringify({ t: +playing1.t.toFixed(1), dur: +playing1.dur.toFixed(1) }));
check(
  "播放器用的是 <audio> 真实音频（不是浏览器朗读）",
  playing1.src.includes("/api/listening/audio"),
  playing1.src,
);
check("播放进度在推进（>2s）", playing1.t > 2, `${playing1.t.toFixed(1)}s`);

// C. 切到题目：音频不中断
const beforeSwitch = playing1.t;
await clickText("下一题");
await wait(4000);
const playing2 = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return { t: a?.currentTime ?? 0, paused: a?.paused ?? true, url: location.href };
});
check("切到下一题后音频没停", !playing2.paused);
check("切题后进度继续前进", playing2.t > beforeSwitch + 1.5, `${beforeSwitch.toFixed(1)}s → ${playing2.t.toFixed(1)}s`);

// 切到阅读再切回听力，声音也不该断
await clickText("阅读");
await wait(1200);
const stillPlaying = await page.evaluate(() => !(document.querySelector("audio")?.paused ?? true));
check("切到阅读栏后音频仍在播", stillPlaying);
await clickText("听力");
await wait(1000);
await page.screenshot({ path: `${OUT}/b-playing.png` });

// D. 换段 → 换音频
const srcBefore = await page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? "");
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("nav button")).find((b) =>
    /^新闻\s*2$/.test(b.textContent?.trim() ?? ""),
  );
  btn?.click();
});
await wait(5000);
const afterPassage = await page.evaluate(() => {
  const a = document.querySelector("audio");
  return { src: a?.getAttribute("src") ?? "", t: a?.currentTime ?? 0, paused: a?.paused ?? true };
});
check("换段后音频地址跟着换", afterPassage.src !== srcBefore, `${srcBefore.split("&")[1] ?? srcBefore} → ${afterPassage.src.split("&")[1] ?? afterPassage.src}`);
check("换段后自动续播", !afterPassage.paused);

// E. 账号安全
await page.goto(`${BASE}/profile`, { waitUntil: "networkidle2" });
await wait(900);
const account = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasSection: /账号与安全/.test(text),
    hasPhoneRow: /手机号/.test(text),
    hasBind: /绑定手机号|换绑手机/.test(text),
    hasPwd: /修改密码|设置密码/.test(text),
    hasBindEmail: /绑定邮箱|换绑邮箱/.test(text),
  };
});
check("「我的」页有账号与安全区", account.hasSection);
check("可以绑定/换绑手机号", account.hasPhoneRow && account.hasBind);
check("可以绑定/换绑邮箱", account.hasBindEmail);
check("可以改密码", account.hasPwd);
await page.screenshot({ path: `${OUT}/c-account.png`, fullPage: false });

// F. 手机端
const mobile = await browser.newPage();
await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });
await mobile.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
await wait(1200);
await mobile.evaluate(() => {
  const t = Array.from(document.querySelectorAll("button, a")).find((b) => b.textContent?.trim() === "听力");
  t?.click();
});
await wait(1500);
await mobile.screenshot({ path: `${OUT}/d-mobile-listening.png` });
const mobileInfo = await mobile.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  // 播放器元素是点了播放才创建的，这里看按钮在不在
  hasPlayButton: Array.from(document.querySelectorAll("button")).some((b) => /▶|❚❚/.test(b.textContent ?? "")),
}));
check("手机端无横向溢出", !mobileInfo.overflow);
check("手机端也有播放按钮", mobileInfo.hasPlayButton);

check("没有 JS 运行时报错", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log("失败项：");
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`));
  process.exit(1);
}
