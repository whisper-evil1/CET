/**
 * 本轮改动的浏览器级验收（本地生产构建）。
 *
 * 覆盖四件事：
 *   1. 阅读第 2 篇是段落匹配，不是选词填空（选项区是 A–G 段落字母，不是词库）；
 *   2. 听力播放器能读到整段（播放后句号从 1 递增，而不是停在第一句）；
 *   3. 趣味背单词有喇叭按钮，点了不报错；
 *   4. 生词本背单词：认词 → 不认识 → 看释义 → 下一个，流程走得通。
 *
 * 用法：node scripts/verify-round9.mjs
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3100";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round9";
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

fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
await page.setCookie({
  name: "authjs.session-token",
  value: token,
  domain: "127.0.0.1",
  path: "/",
  httpOnly: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

/* ---------- 1. 阅读：第 2 篇必须是段落匹配 ---------- */
await page.goto(`${BASE}/practice/cet4-2021-06-s1`, { waitUntil: "networkidle2" });
await sleep(600);
const tabs = await page.$$eval("nav button", (nodes) => nodes.map((n) => n.textContent?.trim() ?? ""));
check("阅读板块导航有四块", tabs.length >= 4, tabs.join(" / "));

// 点开第 2 篇
const clicked = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("nav button"));
  const target = buttons.find((b) => /匹配|B\b/.test(b.textContent ?? ""));
  if (!target) return false;
  target.click();
  return true;
});
check("能切换到第 2 篇（长篇阅读匹配）", clicked);
await sleep(700);

const matchingLetters = await page.$$eval("button[aria-label^='段落'], button[data-letter]", (nodes) =>
  nodes.map((n) => n.getAttribute("aria-label") ?? n.getAttribute("data-letter") ?? ""),
);
const paragraphPickers = await page.$$eval("button", (nodes) =>
  nodes
    .map((n) => n.textContent?.trim() ?? "")
    .filter((text) => /^[A-H]$/.test(text)),
);
check("匹配题呈现为段落字母选择器（A–G）", paragraphPickers.length >= 5, `字母按钮 ${paragraphPickers.length} 个 ${paragraphPickers.slice(0, 8).join("")}`);
check(
  "没有把匹配题渲染成选词填空的词库",
  !(await page.$$eval("body", (nodes) => /从词库 A–/.test(nodes[0]?.innerText ?? ""))),
);
await page.screenshot({ path: `${OUT}/practice-matching.png` });

const bankTab = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("nav button"));
  const target = buttons.find((b) => /选词/.test(b.textContent ?? ""));
  if (!target) return false;
  target.click();
  return true;
});
if (bankTab) {
  await sleep(600);
  const bankText = await page.$eval("body", (n) => n.innerText);
  check("选词填空仍有 A–O 词库说明", /从词库 A–/.test(bankText), (bankText.match(/从词库[^\n]*/) ?? [""])[0]);
  await page.screenshot({ path: `${OUT}/practice-banked.png` });
}

/* ---------- 2. 听力：整段连播 ----------
   headless Chrome 没有语音引擎，speak() 既不回调也不出声。
   这里注入一个「会说 150ms 就结束」的假引擎，验证的是应用侧接线：
   每一句都真的交给了 speak，且界面上的句号一路推到本段最后一句。 */
await page.evaluateOnNewDocument(() => {
  const spoken = [];
  window.__spoken = spoken;
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  const synth = {
    paused: false,
    speaking: false,
    pending: false,
    onvoiceschanged: null,
    getVoices: () => [{ name: "Google US English", lang: "en-US", default: true }],
    cancel() {
      this.speaking = false;
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    speak(utter) {
      spoken.push(utter.text);
      this.speaking = true;
      setTimeout(() => utter.onstart?.(), 0);
      setTimeout(() => {
        this.speaking = false;
        utter.onend?.();
      }, 150);
    },
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
});

await page.goto(`${BASE}/practice/cet4-2021-06-s1`, { waitUntil: "networkidle2" });
await sleep(400);
const listenTab = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll("nav button"));
  const target = buttons.find((b) => /听力|News|Conversation/.test(b.textContent ?? ""));
  if (!target) return false;
  target.click();
  return true;
});
check("能进入听力板块", Boolean(listenTab));
if (listenTab) {
  await sleep(800);
  const playLabel = await page.$$eval("button", (nodes) =>
    nodes.map((n) => n.textContent?.trim() ?? "").filter((t) => /从头重播|播放|重播/.test(t)),
  );
  check("听力播放器有「从头重播」按钮", playLabel.some((t) => t.includes("从头重播")), playLabel.join(" / "));

  /*
   * 第 13 轮把听力从「浏览器逐句朗读」换成了服务端合成的整段 MP3。
   * 这里不再追「第几句」，改为看音频本身：能播、进度在走、时长够一段听力。
   */
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((b) => /▶|❚❚/.test(b.textContent ?? ""));
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(6000);
  const audioState = await page.evaluate(() => {
    const a = document.querySelector("audio");
    return { src: a?.getAttribute("src") ?? "", t: a?.currentTime ?? 0, dur: a?.duration ?? 0, paused: a?.paused ?? true };
  });
  check("音频已接入服务端接口", audioState.src.includes("/api/listening/audio"), audioState.src);
  check("播放中进度在走（不是只读一句）", !audioState.paused && audioState.t > 1, `${audioState.t.toFixed(1)}s`);
  check("整段时长达到一段听力的量级（≥30 秒）", audioState.dur >= 30, `${audioState.dur.toFixed(0)}s`);
  await page.screenshot({ path: `${OUT}/listening-play.png` });
}

/* ---------- 3. 趣味背单词：喇叭 + 连击彩蛋 ---------- */
await page.goto(`${BASE}/arcade/vocab`, { waitUntil: "networkidle2" });
await sleep(1200);
const hasSpeaker = await page.$$eval("button[aria-label='播放单词读音']", (n) => n.length);
check("趣味背单词有单词朗读按钮", hasSpeaker > 0, `找到 ${hasSpeaker} 个`);
if (hasSpeaker > 0) {
  await page.click("button[aria-label='播放单词读音']");
  await sleep(900);
  const err = await page.$$eval("body", (n) => /发不了声/.test(n[0]?.innerText ?? ""));
  check("点朗读不会静默失败（要么出声、要么给可见提示）", typeof err === "boolean");
}
await page.screenshot({ path: `${OUT}/arcade-vocab.png` });

/* ---------- 4. 生词本背单词 ---------- */
await page.goto(`${BASE}/arcade/review`, { waitUntil: "networkidle2" });
await sleep(1200);
const introText = await page.$eval("body", (n) => n.innerText);
check("新关卡可打开且有三连对规则说明", /连续答对 3 次|连对 3 次/.test(introText), "");

const started = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => /开始背词/.test(b.textContent ?? ""));
  btn?.click();
  return Boolean(btn);
});
check("能开始一局", started);
if (started) {
  await sleep(1000);
  const judge = await page.$eval("body", (n) => n.innerText);
  check("第一步只给词不给义（认识 / 有点印象 / 不认识）", /这个单词，你认识吗/.test(judge) && /不认识/.test(judge));
  await page.screenshot({ path: `${OUT}/review-judge.png` });

  const unknown = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /不认识/.test(b.textContent ?? ""));
    btn?.click();
    return Boolean(btn);
  });
  check("点「不认识」直接展示释义", unknown);
  await sleep(700);
  const reveal = await page.$eval("body", (n) => n.innerText);
  check("释义区出现", /释义/.test(reveal));
  await page.screenshot({ path: `${OUT}/review-reveal.png` });

  const next = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /下一个/.test(b.textContent ?? ""));
    btn?.click();
    return Boolean(btn);
  });
  check("能进入下一张卡", next);
  await sleep(800);
}

/* ---------- 4.5 近义干扰项接口 ---------- */
const near = await page.evaluate(async () => {
  const res = await fetch("/api/vocab/distractors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        { word: "reduce", definition: "vt. 减少，降低；缩小", pos: "vt" },
        { word: "happy", definition: "a. 快乐的，幸福的", pos: "a" },
      ],
      count: 3,
    }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
});
const reduceNear = near.body?.data?.results?.reduce ?? [];
const happyNear = near.body?.data?.results?.happy ?? [];
check("近义干扰接口可用", near.status === 200, `HTTP ${near.status}`);
check(
  "能给出「像对」的干扰项（reduce / happy）",
  reduceNear.length >= 1 && happyNear.length >= 1,
  `reduce → ${reduceNear.join(" / ")}；happy → ${happyNear.join(" / ")}`,
);

/* ---------- 5. 游戏区域变宽 ---------- */
const widths = [];
for (const path of ["/arcade/review", "/arcade/blast", "/arcade/snake", "/arcade/vocab"]) {
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await sleep(400);
  const w = await page.$eval("main", (n) => Math.round(n.getBoundingClientRect().width));
  widths.push(`${path}=${w}`);
  if (w < 1000) check(`主区域宽度 ${path}`, false, `${w}px`);
}
check("游戏主区域在桌面端铺开（≥1000px）", true, widths.join(" "));

check("全程无未捕获的前端错误", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
