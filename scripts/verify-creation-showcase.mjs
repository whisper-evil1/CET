import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const SC = process.env.SC ?? "";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (path) => `${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SC}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 150)));

/* sharecode 同步脚本会触发一次自动跳转，跳转瞬间 evaluate 会抛
   「Execution context was destroyed」。统一包一层重试。 */
const ev = async (fn, arg) => {
  for (let i = 0; i < 4; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      /* 跳转中 / 空文档都可能瞬时出现，统一重试 */
      if (i === 3) throw e;
      await sleep(1500);
    }
  }
  return null;
};

/* 网关对无头浏览器偶发 ERR_CONNECTION_CLOSED，goto 也重试 */
for (let i = 0; i < 5; i++) {
  try {
    await page.goto(url("/"), { waitUntil: "domcontentloaded", timeout: 90000 });
    break;
  } catch (e) {
    if (i === 4) throw e;
    console.log(`…goto 重试（${i + 1}/4）：${String(e).slice(0, 80)}`);
    await sleep(4000);
  }
}
await sleep(3500);

/* 线上沙箱资源加载慢，必须等 React 水合完成，tab 点击才会生效 */
await page
  .waitForFunction(
    () => [...document.querySelectorAll("*")].some((el) => Object.keys(el).some((k) => k.startsWith("__react"))),
    { timeout: 90000, polling: 1500 }
  )
  .catch(() => console.log("…等待水合超时（继续检查 SSR 内容）"));

/* 1. 展示区标题 */
const hasTitle = await ev(() =>
  (document.body?.innerText ?? "").includes("创作平台") &&
  (document.body?.innerText ?? "").includes("效果示例")
);
check("展示区标题「创作平台 + 效果示例」出现", hasTitle);

/* 2. 两个工作台面板 */
const panels = await ev(() => {
  const t = (document.body?.innerText ?? "");
  return { novel: t.includes("小说英译改编"), video: t.includes("短视频出海") };
});
check("小说英译改编面板存在", panels?.novel);
check("短视频出海面板存在", panels?.video);

/* 3. 小说效果示例：段级对照 + 专名表 */
const novelSample = await ev(() => {
  const t = (document.body?.innerText ?? "");
  return {
    pairs: t.includes("我冒了严寒") && t.includes("braved the bitter cold"),
    glossary: t.includes("专名表") && t.includes("故乡"),
    label: t.includes("鲁迅《故乡》"),
  };
});
check("小说示例含中英对照段", novelSample?.pairs);
check("小说示例含专名表", novelSample?.glossary);
check("小说示例标注出处", novelSample?.label);

/* 4. 视频效果示例：成片 + 发布包 */
const videoSample = await ev(() => {
  const v = document.querySelector("video[src*='hotpot-demo']");
  const t = (document.body?.innerText ?? "");
  return {
    video: !!v,
    title: t.includes("Chengdu Hotpot"),
    hooks: t.includes("开场钩子"),
    scenes: t.includes("秒级分镜"),
    tags: t.includes("#ChengduFood"),
    charCheck: t.includes("56/60"),
  };
});
check("成片视频元素存在（hotpot-demo.mp4）", videoSample?.video);
check("发布包含英文标题", videoSample?.title);
check("发布包含开场钩子", videoSample?.hooks);
check("发布包含秒级分镜", videoSample?.scenes);
check("发布包含话题标签", videoSample?.tags);
check("标题字数校验显示", videoSample?.charCheck);

/* 5. 切到创作教程 tab（点击-校验重试，容忍水合延迟） */
const clickTabAnd = async (panelIndex, expectText) => {
  for (let i = 0; i < 8; i++) {
    await ev((idx) => {
      const btns = [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "创作教程");
      if (btns[idx]) btns[idx].click();
    }, panelIndex);
    await sleep(700);
    const ok = await ev((t) => (document.body?.innerText ?? "").includes(t), expectText);
    if (ok) return true;
  }
  return false;
};

const tabCount = await ev(
  () => [...document.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "创作教程").length
);
check("「创作教程」按钮存在（≥2 个面板）", (tabCount ?? 0) >= 2, `实际 ${tabCount} 个`);

const novelGuide = await clickTabAnd(0, "贴入中文原文");
check("小说创作教程四步显示", novelGuide);

/* 6. 切到视频侧创作教程 */
const videoGuide = await clickTabAnd(1, "写一段中文口播稿");
check("视频创作教程四步显示", videoGuide);

/* 7. 「开始创作 →」入口 */
const createLinks = await ev(() => {
  const links = [...document.querySelectorAll("a")].filter((a) => (a.textContent ?? "").includes("开始创作"));
  return links.map((a) => a.getAttribute("href"));
});
check("两个「开始创作」入口", createLinks?.length === 2, `实际 ${createLinks?.length}`);
check("入口指向 /create/novel", createLinks?.includes("/create/novel"));
check("入口指向 /create/video", createLinks?.includes("/create/video"));

/* 8. 无 JS 报错 */
check("无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
