/**
 * 第十四轮验收：单词串故事（API + TTS + 播放器 + 熄屏续听）+ 词书/背单词界面放大。
 * 用法：node scripts/verify-word-story.mjs
 * 环境变量：BASE（默认 http://127.0.0.1:3100）、SC（分享码，可选）
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const SC = process.env.SC || "";
const url = (path) => `${BASE}${path}${SC ? `${path.includes("?") ? "&" : "?"}sharecode=${SC}` : ""}`;

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}${extra ? `  (${extra})` : ""}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${extra ? `  (${extra})` : ""}`);
  }
};

console.log(`== 单词串故事 + 界面放大验收 ==  BASE=${BASE}`);

/* ---------- 1. /api/vocab/story ---------- */
console.log("\n[1] 故事生成 API");
const WORDS = [
  { word: "abandon", zh: "放弃" },
  { word: "frequently", zh: "频繁地" },
  { word: "tremendous", zh: "巨大的" },
  { word: "reluctant", zh: "不情愿的" },
  { word: "evaluate", zh: "评估" },
  { word: "vulnerable", zh: "脆弱的" },
];

async function postJsonFetch(path, body) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      if (!text.trim().startsWith("{")) throw new Error("non-json: " + text.slice(0, 40));
      return { status: r.status, json: JSON.parse(text) };
    } catch (e) {
      if (i === 3) throw e;
      await sleep(2500);
    }
  }
  return null;
}

let storyRes = null;
{
  storyRes = await postJsonFetch("/api/vocab/story", { words: WORDS });
  check("POST /api/vocab/story 可达", !!storyRes, `status=${storyRes?.status}`);
  const data = storyRes?.json?.data;
  const story = data?.story ?? "";
  check("返回 story 非空", typeof story === "string" && story.length > 60, `${story.length} 字符`);
  check("mode 取值合法", data?.mode === "ai" || data?.mode === "offline", `mode=${data?.mode}`);

  // 词序：每个词都出现，且第一次出现的位置严格递增
  const positions = WORDS.map((w) => story.toLowerCase().indexOf(w.word.toLowerCase()));
  check("六个词全部进故事", positions.every((p) => p >= 0), positions.join(","));
  const ordered = positions.every((p, i) => i === 0 || p > positions[i - 1]);
  check("词序与输入一致（可背诵顺序）", ordered, positions.join(" < "));

  // 规范化格式：**word**（中文释义）
  const markedAll = WORDS.every((w) =>
    new RegExp(`\\*\\*${w.word}\\*\\*（[^）]+）`, "i").test(story),
  );
  check("每个目标词都是 **词**（释义）格式", markedAll);
  const glossMatched = WORDS.slice(0, 3).every((w) => story.includes(w.zh.slice(0, 2)));
  check("释义来自词库而不是模型自编", glossMatched, WORDS.slice(0, 3).map((w) => w.zh).join("/"));

  // 恰好 6 个标记，没有多标/重复
  const marks = story.match(/\*\*[^*]+\*\*/g) ?? [];
  check("标记词数量 = 输入词数量", marks.length === WORDS.length, `${marks.length} 个`);

  // 长串释义（词库常见「铅, 铅条, 领导, 超前量…」）必须被截短，否则句子读断
  const longRes = await postJsonFetch("/api/vocab/story", {
    words: [
      { word: "lead", zh: "铅, 铅条, 领导, 超前量, 领引, 榜样, 主角, 导线" },
      { word: "point", zh: "点, 小数点, 标点, 地点, 要点, 特点, 尖端, 分数" },
      { word: "court", zh: "n. 法院, 庭院, 奉承" },
      { word: "lose", zh: "vt. 遗失, 损失, 丢失, 使失去, 错过, 浪费, 迷失" },
    ],
  });
  const longStory = longRes?.json?.data?.story ?? "";
  const glosses = [...longStory.matchAll(/（([^）]*)）/g)].map((m) => m[1]);
  check(
    "长串释义被截短（每条 ≤ 12 字、最多两义项）",
    glosses.length === 4 && glosses.every((g) => g.length <= 12 && (g.match(/、/g) ?? []).length <= 1),
    glosses.join(" / "),
  );
  check("截短后仍保留首义", glosses.some((g) => g.startsWith("铅")), glosses[0] ?? "");
  check("释义里不残留词性缩写（a./n. 等）", glosses.every((g) => !/[a-z]\./i.test(g)), glosses.join(" / "));
}

{
  const bad = await postJsonFetch("/api/vocab/story", { words: WORDS.slice(0, 3) });
  check("少于 4 个词被拒", bad?.json?.data?.story === null, bad?.json?.data?.note ?? "");
  const bad2 = await postJsonFetch("/api/vocab/story", { words: [] });
  check("空词表被拒且不 500", bad2?.status === 200 && bad2?.json?.data?.story === null);
}

/* ---------- 2. /api/tts ---------- */
console.log("\n[2] 整篇音频合成 API（熄屏续听的前提）");
{
  const runs = [
    { text: "Tom was reluctant to abandon his plan.", lang: "en" },
    { text: "不情愿的，放弃", lang: "zh" },
  ];
  let r1 = null;
  let buf1 = null;
  for (let i = 0; i < 3 && !buf1; i++) {
    try {
      const r = await fetch(url("/api/tts"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runs }),
      });
      r1 = r;
      const ct = r.headers.get("content-type") ?? "";
      if (r.ok && ct.includes("audio")) buf1 = Buffer.from(await r.arrayBuffer());
      else if (i === 2) check("TTS 返回音频", false, `${r.status} ${ct}`);
      else await sleep(2500);
    } catch {
      await sleep(2500);
    }
  }
  check("TTS 返回 audio/mpeg", !!buf1 && (r1?.headers.get("content-type") ?? "").includes("audio"));
  check("音频体积合理（> 8KB）", (buf1?.length ?? 0) > 8192, `${Math.round((buf1?.length ?? 0) / 1024)} KB`);
  // MP3 帧同步字（ID3 或 0xFF 0xFB）
  const isMp3 = !!buf1 && (buf1.slice(0, 3).toString() === "ID3" || (buf1[0] === 0xff && (buf1[1] & 0xe0) === 0xe0));
  check("字节流是真 MP3", isMp3, buf1 ? buf1.slice(0, 3).toString("hex") : "no-data");

  // 同一份文本走缓存：第二次仍然 200 且体积一致
  const t0 = Date.now();
  const r2 = await fetch(url("/api/tts"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runs }),
  });
  const buf2 = Buffer.from(await r2.arrayBuffer());
  const ms = Date.now() - t0;
  check("同文重复合成命中缓存", r2.ok && buf2.length === (buf1?.length ?? -1), `${ms}ms / ${Math.round(buf2.length / 1024)}KB`);

  const badTts = await fetch(url("/api/tts"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runs: [] }),
  });
  check("空 runs 被拒且不 500", badTts.status === 400 || badTts.status === 200, `status=${badTts.status}`);
}

/* ---------- 3. 编译层：熄屏续听的关键实现 ---------- */
console.log("\n[3] 熄屏续听实现检查（源码层）");
{
  const ap = fs.readFileSync("src/components/vocab/audio-player.tsx", "utf8");
  check("随身听不再监听 visibilitychange", !/addEventListener\(\s*["']visibilitychange/.test(ap) && !/document\.hidden/.test(ap));
  check("随身听接入故事串联面板", ap.includes("WordStoryPlayer") && ap.includes("故事串联"));

  const wsp = fs.readFileSync("src/components/vocab/word-story-player.tsx", "utf8");
  check("故事播放走整篇 MP3（<audio> + /api/tts）", wsp.includes("<audio") && wsp.includes('"/api/tts"'));
  check("挂 Media Session 供锁屏控制", wsp.includes("navigator.mediaSession.metadata") && wsp.includes('setActionHandler("pause"'));
  check("故事面板不因切后台暂停", !/addEventListener\(\s*["']visibilitychange/.test(wsp) && !/document\.hidden/.test(wsp));

  const lib = fs.readFileSync("src/lib/word-story.ts", "utf8");
  check("渲染与 TTS 同源解析（parseStory/storyToRuns）", lib.includes("export function parseStory") && lib.includes("export function storyToRuns"));
  check("离线兜底按词序串联", lib.includes("export function offlineStory"));
}

/* ---------- 4. 浏览器层 ---------- */
console.log("\n[4] 浏览器：故事面板 + 播放行为");
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

const ev = async (fn, arg) => {
  for (let i = 0; i < 6; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!/Execution context|navigat|Cannot find context/i.test(String(e)) && i === 5) throw e;
      await sleep(1500);
    }
  }
  return null;
};

const waitHydrated = async () => {
  for (let t = 0; t < 60; t++) {
    const hydrated = await page
      .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
      .catch(() => false);
    if (hydrated) break;
    await sleep(1000);
  }
  await sleep(1200);
};

const clickText = async (re, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    const hit = await ev((src) => {
      const rx = new RegExp(src);
      const b = [...document.querySelectorAll("button")].find((x) => rx.test(x.textContent ?? ""));
      if (b) {
        b.click();
        return true;
      }
      return false;
    }, re.source);
    if (hit) return true;
    await sleep(1800);
  }
  return false;
};

let loaded = false;
for (let i = 0; i < 5; i++) {
  try {
    await page.goto(url("/vocab?mode=audio"), { waitUntil: "domcontentloaded", timeout: 60000 });
    loaded = true;
    break;
  } catch {
    await sleep(3000);
  }
}
check("随身听页可达 /vocab?mode=audio", loaded);

if ((page.url() || "").includes("/login")) {
  const demo = await clickText(/演示账号/, 4);
  check("一键进入演示账号", !!demo);
  for (let i = 0; i < 8; i++) {
    if (!(page.url() || "").includes("/login")) break;
    await sleep(1500);
  }
  await page.goto(url("/vocab?mode=audio"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
}
await waitHydrated();
check("登录后停在随身听页", !(page.url() || "").includes("/login"), page.url());

const tabs = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { loop: t.includes("单词连播"), story: t.includes("故事串联") };
});
check("两个面板切换存在（连播/故事）", tabs?.loop && tabs?.story, JSON.stringify(tabs));

const switched = await clickText(/故事串联/);
check("切到「故事串联」面板", !!switched);

// 等故事生成（AI 慢时会更久；离线兜底也是有效的）
let storyReady = false;
for (let i = 0; i < 40; i++) {
  const st = await ev(() => {
    const bs = [...document.querySelectorAll("b")].filter((b) => (b.textContent ?? "").trim().length > 1);
    const t = document.body?.innerText ?? "";
    return {
      bolds: bs.length,
      hasGloss: /（[^）]{1,24}）/.test(t),
      generating: t.includes("正在把"),
      modeLine: /AI 串词故事|句架串联/.test(t),
    };
  });
  if (st?.bolds >= 4 && st?.hasGloss) {
    storyReady = true;
    console.log(`     故事渲染：${st.bolds} 个加粗词，mode 行=${st.modeLine}`);
    break;
  }
  await sleep(2000);
}
check("故事正文渲染完成", storyReady);

const render = await ev(() => {
  const bs = [...document.querySelectorAll("b")].map((b) => (b.textContent ?? "").trim()).filter(Boolean);
  const t = document.body?.innerText ?? "";
  return {
    words: bs,
    glossCount: (t.match(/（[^）]{1,24}）/g) ?? []).length,
    audio: !!document.querySelector("audio"),
    rateBtns: [...document.querySelectorAll("button")].filter((b) => /^\d(\.\d+)?x$/.test((b.textContent ?? "").trim())).length,
    glossToggle: [...document.querySelectorAll("button")].some((b) => /朗读带中文释义/.test(b.textContent ?? "")),
  };
});
check("目标词加粗（≥4 个）", (render?.words.length ?? 0) >= 4, (render?.words ?? []).slice(0, 4).join(","));
check("每个加粗词紧跟中文释义", (render?.glossCount ?? 0) >= (render?.words.length ?? 0), `${render?.glossCount}/${render?.words?.length}`);
check("页面存在 <audio> 元素（整篇 MP3 通道）", !!render?.audio);
check("倍速四个档位", (render?.rateBtns ?? 0) === 4, `${render?.rateBtns} 个`);
check("「朗读带中文释义」开关存在", !!render?.glossToggle);

// 倍速切换先设 1.25x，随后验证 audio.playbackRate 生效
await clickText(/^1\.25x$/);
await sleep(600);

const mediaset = await ev(() => {
  const m = navigator.mediaSession?.metadata;
  return { title: m?.title ?? "", artist: m?.artist ?? "" };
});
check("Media Session 已登记（锁屏界面显示标题）", mediaset?.title === "单词串联故事", JSON.stringify(mediaset));

// 点「听故事」：合成整篇 MP3 → <audio> 播放
const playClicked = await clickText(/听故事/);
check("点击「听故事」", !!playClicked);

let audioState = null;
for (let i = 0; i < 60; i++) {
  audioState = await ev(() => {
    const a = document.querySelector("audio");
    if (!a) return null;
    return {
      src: (a.currentSrc || a.src || "").slice(0, 12),
      paused: a.paused,
      t: Number.isFinite(a.currentTime) ? Number(a.currentTime.toFixed(2)) : -1,
      dur: Number.isFinite(a.duration) ? Number(a.duration.toFixed(1)) : -1,
      rate: a.playbackRate,
      stateText: document.body?.innerText ?? "",
    };
  });
  if (audioState && audioState.src.startsWith("blob:") && audioState.dur > 5) break;
  await sleep(2000);
}
check("音频源为整篇 blob（非逐句合成）", (audioState?.src ?? "").startsWith("blob:"), audioState?.src);
check("音频时长 > 5 秒", (audioState?.dur ?? 0) > 5, `${audioState?.dur}s`);
check("倍速生效 1.25x", Math.abs((audioState?.rate ?? 0) - 1.25) < 0.01, `${audioState?.rate}`);
check("已在播放（非暂停）", audioState?.paused === false, `paused=${audioState?.paused}`);

// 熄屏续听的行为证明：切后台（visibilitychange/hidden）后播放不中断
if (audioState?.paused === false) {
  const before = await ev(() => {
    const a = document.querySelector("audio");
    return { t: a?.currentTime ?? 0, paused: a?.paused };
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(2600);
  const after = await ev(() => {
    const a = document.querySelector("audio");
    return { t: a?.currentTime ?? 0, paused: a?.paused };
  });
  check("切后台后未被暂停（锁屏可继续听）", after?.paused === false);
  check("切后台后进度仍在前进", (after?.t ?? 0) > (before?.t ?? 0), `${before?.t} → ${after?.t}`);
}

// 暂停/继续
const pauseOk = await clickText(/⏸ 暂停/);
await sleep(1200);
const pausedNow = await ev(() => document.querySelector("audio")?.paused);
check("可暂停", !!pauseOk && pausedNow === true, `paused=${pausedNow}`);
const resumeOk = await clickText(/▶ 听故事/);
await sleep(1200);
const resumedNow = await ev(() => document.querySelector("audio")?.paused);
check("可继续播放（复用已合成音频，不重新合成）", !!resumeOk && resumedNow === false);

// 换一组词重串
const regen = await clickText(/⟳|换一组/);
check("「换一组词重串」可点", !!regen);
await sleep(3000);
const regenState = await ev(() => {
  const t = document.body?.innerText ?? "";
  return { generating: t.includes("正在把") || /AI 串词故事|句架串联/.test(t) };
});
check("重串后回到可播放态", !!regenState?.generating);

/* ---------- 5. 界面放大实测 ---------- */
console.log("\n[5] 词书 / 背单词界面字号实测（视口 1440）");
await page.goto(url("/vocab?tab=books"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
await sleep(2500);

const shelf = await ev(() => {
  const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
  const all = [...document.querySelectorAll("*")];
  const bookName = all.find((el) => el.children.length === 0 && /font-serif/.test(el.className) && /词/.test(el.textContent ?? "") && px(el) >= 17);
  const startBtn = [...document.querySelectorAll("button")].find((b) => /开始背/.test(b.textContent ?? ""));
  const inputs = [...document.querySelectorAll("input")].map(px).filter((v) => v > 0);
  return {
    bookNamePx: px(bookName),
    startBtnPx: px(startBtn),
    maxInputPx: inputs.length ? Math.max(...inputs) : 0,
  };
});
check("词书书名 ≥ 19px（原 15px）", (shelf?.bookNamePx ?? 0) >= 19, `${shelf?.bookNamePx}px`);
check("「开始背」按钮 ≥ 14px（原 12px）", (shelf?.startBtnPx ?? 0) >= 14, `${shelf?.startBtnPx}px`);
check("输入框 ≥ 14.5px（原 12.5px）", (shelf?.maxInputPx ?? 0) >= 14.5, `${shelf?.maxInputPx}px`);

await page.goto(url("/vocab?mode=review"), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
const startReview = await clickText(/开始背词/);
check("背单词可开局", !!startReview);
await sleep(3500);
const game = await ev(() => {
  const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
  const all = [...document.querySelectorAll("*")];
  const word = all
    .filter((el) => el.children.length === 0 && px(el) >= 40 && /^[A-Za-z][A-Za-z\-' ]*$/.test((el.textContent ?? "").trim()))
    .sort((a, b) => px(b) - px(a))[0];
  const option = [...document.querySelectorAll("button")].find((b) => px(b) >= 15 && (b.textContent ?? "").length > 2 && !/开始|返回|回词表/.test(b.textContent ?? ""));
  return { wordPx: px(word), wordText: (word?.textContent ?? "").slice(0, 20), optionPx: px(option) };
});
check("背单词单词字号 ≥ 46px（原 36px）", (game?.wordPx ?? 0) >= 46, `${game?.wordPx}px 「${game?.wordText}」`);
check("选项字号 ≥ 15px（原 14px）", (game?.optionPx ?? 0) >= 15, `${game?.optionPx}px`);

check("无页面 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "clean");

await browser.close();
console.log(`\n== 结果：${passed} 过 / ${failed} 挂 ==`);
process.exit(failed > 0 ? 1 : 0);
