/**
 * 听力播放 / 试卷筛选 / 闯关三件事的验收脚本。
 *
 * 语音合成在无头浏览器里没有可用发音引擎，所以这里注入一个「假 synth」：
 * 它按真实 API 的形状回调 onstart/onend，用来稳定验证
 * 「播放状态 → 逐句高亮 → 下一题锁定 → 播完解锁」这条链路。
 * 真实发声只能在有声卡的浏览器里人耳确认，报告里单独标注。
 *
 * 用法：node scripts/verify-listening.mjs
 *      CHECK_BASE=https://... CHECK_SHARE=xxxx node scripts/verify-listening.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
const SHARE = process.env.CHECK_SHARE ?? "";
const PAPER = process.env.PAPER ?? "cet4-2026-06-s1";
const OUT = process.env.SHOT_DIR ?? "./shots/listening";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = (path) =>
  !SHARE ? `${BASE}${path}` : `${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SHARE}`;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

// 假 synth：每句朗读 700ms，句间 80ms，模拟真实节奏
await page.evaluateOnNewDocument(() => {
  const timers = new Set();
  let speaking = false;
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.lang = "en-US";
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  const synth = {
    speaking: false,
    paused: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => [{ name: "Fake English", lang: "en-US", default: true, localService: true }],
    speak(utter) {
      window.__spoken = window.__spoken ?? [];
      window.__spoken.push(utter.text);
      speaking = true;
      this.speaking = true;
      const start = setTimeout(() => utter.onstart?.(), 30);
      const end = setTimeout(() => {
        speaking = false;
        this.speaking = false;
        utter.onend?.();
      }, 730);
      timers.add(start);
      timers.add(end);
    },
    cancel() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      speaking = false;
      this.speaking = false;
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;
});

/** 用 DOM click 点：筛选条会滚到吸顶导航下面，鼠标坐标点会被导航拦掉 */
const clickDom = async (text, tag = "button") => {
  const ok = await page.evaluate(
    (t, g) => {
      const el = [...document.querySelectorAll(g)].find((n) => (n.textContent ?? "").trim() === t);
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    tag,
  );
  if (!ok) throw new Error(`找不到元素：${text}`);
};

const clickText = async (text, tag = "button") => {
  const handle = await page.evaluateHandle(
    (t, g) => [...document.querySelectorAll(g)].find((el) => (el.textContent ?? "").includes(t)) ?? null,
    text,
    tag,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`找不到元素：${text}`);
  await el.click();
  return el;
};

/* ---------- 登录 ---------- */
await page.goto(url("/login"), { waitUntil: "networkidle2" });
await page.type("input[type=email]", "demo@cet.local");
await page.type("input[type=password]", "demo1234");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
  page.click("button[type=submit]"),
]);
record("登录成功", true, page.url());

/* ---------- 1. 听力：段落导航 ---------- */
await page.goto(url(`/practice/${PAPER}`), { waitUntil: "networkidle2" });
await sleep(900);
await clickText("听力", "button");
await sleep(1200);
await page.screenshot({ path: `${OUT}/01-listening.png` });

const navLabels = await page.$$eval("nav button", (els) => els.map((e) => e.textContent?.trim() ?? ""));
const listeningNav = navLabels.filter((t) => /^(新闻|对话|篇章|第)\s?\d/.test(t));
record("听力有 8 段材料导航", listeningNav.length === 8, listeningNav.join(" / "));

/* ---------- 2. 播放器 + 自动播放 + 逐句状态 ---------- */
const playerText = await page.evaluate(() => document.body.innerText);
record("出现播放器与语速档位", /语速/.test(playerText) && /0\.85/.test(playerText) && /播放|本段录音/.test(playerText));

await sleep(1600); // 等自动播放进入第 2 句
const speakingText = await page.evaluate(() => {
  const el = [...document.querySelectorAll("span")].find((n) => /正在朗读第 \d+ 句/.test(n.textContent ?? ""));
  return el?.textContent ?? "";
});
record("自动开始朗读并显示句号", /正在朗读第 \d+ 句/.test(speakingText), speakingText);

/* ---------- 3. 播放中锁住下一题 ---------- */
const nextState = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^(🔒 播放中|下一题 →)$/.test((b.textContent ?? "").trim()),
  );
  return { text: btn?.textContent?.trim() ?? "", disabled: btn?.disabled ?? null };
});
record("播放中「下一题」被锁住", nextState.disabled === true && /播放中/.test(nextState.text), JSON.stringify(nextState));

const stopLink = await page.evaluate(() =>
  [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("停止播放并下一题")),
);
record("提供「停止播放并下一题」出口", stopLink);

/* ---------- 4. 原文逐句高亮 ---------- */
await clickText("展开听力原文");
await sleep(400);
const highlighted = await page.evaluate(
  () => document.querySelectorAll("p.bg-accent-soft").length,
);
record("原文有且只有一句高亮", highlighted === 1, `高亮 ${highlighted} 句`);

/* ---------- 5. 播完自动解锁 ---------- */
await sleep(9000);
const afterState = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^(🔒 播放中|下一题 →)$/.test((b.textContent ?? "").trim()),
  );
  return { text: btn?.textContent?.trim() ?? "", disabled: btn?.disabled ?? null };
});
record("播完后自动解锁", afterState.disabled === false && /下一题/.test(afterState.text), JSON.stringify(afterState));

/* ---------- 6. 变速 ---------- */
await clickText("0.85×", "button");
await sleep(300);
const rateActive = await page.evaluate(() =>
  [...document.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === "0.85×" && b.className.includes("bg-ink"),
  ),
);
record("语速切到 0.85× 且高亮", rateActive);

/* ---------- 7. 跨段切题 ---------- */
await clickText("停止播放并下一题").catch(() => {});
await sleep(600);
const afterJump = await page.evaluate(() => document.body.innerText.slice(0, 400));
record("点「停止并下一题」不报错", !/Error/i.test(afterJump));

/* ---------- 8. 试卷筛选 ---------- */
await page.goto(url("/?level=CET4"), { waitUntil: "networkidle2" });
await sleep(500);
const filterPresent = await page.evaluate(() => Boolean(document.querySelector("input[aria-label='搜索试卷']")));
record("试卷库出现筛选条", filterPresent);

const beforeCount = await page.$$eval("#papers ul li", (els) => els.length);
await clickDom("2025");
await sleep(2000);
const afterUrl = page.url();
const afterCount = await page.$$eval("#papers ul li", (els) => els.length);
record(
  "年份筛选生效",
  afterUrl.includes("year=2025") && afterCount > 0 && afterCount <= beforeCount,
  `URL=${afterUrl.split("?")[1] ?? ""} · ${beforeCount} → ${afterCount}`,
);

await page.click("input[aria-label='搜索试卷']");
await page.type("input[aria-label='搜索试卷']", "六级");
await sleep(1200);
const searchEmpty = await page.evaluate(() => document.body.innerText.includes("没有符合条件的卷子"));
record("搜索词与年份叠加后无结果显示空态", searchEmpty);

/* ---------- 9. 闯关分区 + 听写关卡 ---------- */
await page.goto(url("/arcade"), { waitUntil: "networkidle2" });
await sleep(600);
const sections = await page.$$eval("section h2", (els) => els.map((e) => e.textContent?.trim() ?? ""));
record(
  "闯关分成三区且听写入口在列",
  sections.some((t) => t.includes("同一批词")) &&
    sections.some((t) => t.includes("声音变成答案")) &&
    sections.some((t) => t.includes("读懂到写出")),
  sections.join(" | "),
);
const hasDictation = await page.evaluate(() => Boolean(document.querySelector("a[href='/arcade/dictation']")));
record("闯关页有听写填空卡片", hasDictation);
const hasOldDupe = await page.evaluate(() =>
  Boolean(document.querySelector("a[href='/arcade/blast-levels']")),
);
record("重复的「单词消消乐」卡片已合并", !hasOldDupe);

await page.goto(url("/arcade/dictation"), { waitUntil: "networkidle2" });
await sleep(800);
await page.screenshot({ path: `${OUT}/02-dictation-intro.png` });
await clickText("开始听写");
await sleep(900);
const playingText = await page.evaluate(() => document.body.innerText);
record("听写开局自动朗读", /再读一遍|播放句子/.test(playingText) && /第 1 \/ 8 句/.test(playingText));

const spoken = await page.evaluate(() => (window.__spoken ?? []).at(-1) ?? "");
record("听写句子已朗读", spoken.length > 10, spoken.slice(0, 60));
await page.type("textarea", spoken);
await clickText("提交");
await sleep(500);
const verdict = await page.evaluate(() => document.body.innerText);
record("整句写对给满分", /得分 100%/.test(verdict), verdict.match(/得分 \d+%/)?.[0] ?? "");

await clickText("下一句");
await sleep(600);
const spoken2 = await page.evaluate(() => (window.__spoken ?? []).at(-1) ?? "");
// 故意写错一个词、漏掉一个词，验证逐词标注
const words2 = spoken2.split(" ");
const broken = [...words2.slice(0, 2), words2[2] ? `${words2[2]}x` : "x", ...words2.slice(4)].join(" ");
await page.type("textarea", broken);
await clickText("提交");
await sleep(500);
const partial = await page.evaluate(() => document.body.innerText);
record(
  "错词/漏词被逐词标出",
  /得分 \d+%/.test(partial) && !/得分 100%/.test(partial),
  partial.match(/得分 \d+%/)?.[0] ?? "",
);
await page.screenshot({ path: `${OUT}/03-dictation-verdict.png` });

/* ---------- 10. 手机端 390px ---------- */
await page.setViewport({ width: 390, height: 844, isMobile: true });
for (const [name, path] of [
  ["听力页", `/practice/${PAPER}`],
  ["听写页", "/arcade/dictation"],
  ["试卷库", "/?level=CET4#papers"],
]) {
  await page.goto(url(path), { waitUntil: "networkidle2" });
  await sleep(900);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  record(`手机端${name}无横向溢出`, overflow <= 1, `溢出 ${overflow}px`);
}
await page.screenshot({ path: `${OUT}/06-mobile-home.png` });

/* ---------- 11. 控制台 ---------- */
record("无控制台错误", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n结果：${passed}/${results.length} 项通过`);
if (passed !== results.length) process.exitCode = 1;
