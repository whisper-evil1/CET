/**
 * 生词本词书整合验收（本地）：
 * 1. /vocab 打开，「词书」tab 是左右布局书架（阅读生词 + 内置四六级 + 我的词本）
 * 2. 能新建词本
 * 3. 选中词本后右侧展示内容，可加词
 * 4. 内置词书可直接「开始背」，15 个一轮
 * 5. /study 重定向到 /vocab?tab=books
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
// 线上环境需要 sharecode 才能过网关；本地则忽略
const SC = process.env.SC ?? "";
const withSc = (p) => (SC ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}` : p);
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const evalClick = (re) =>
  page.evaluate((pattern) => {
    const rx = new RegExp(pattern);
    const b = [...document.querySelectorAll("button")].find((x) => rx.test((x.textContent ?? "").trim()));
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    b.click();
    return true;
  }, re.source);

/* 登录（演示账号） */
await page.goto(withSc(`${BASE}/login`), { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(
  () => {
    const b = document.querySelector('button[type="submit"]');
    return Boolean(b) && !b.disabled;
  },
  { timeout: 120000 },
);
await page.evaluate(() =>
  [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("演示账号"))?.click(),
);
await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 120000 }).catch(() => {});
await sleep(2000);

/* 1. /study 重定向到 /vocab */
await page.goto(withSc(`${BASE}/study`), { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(2000);
const redirectedUrl = page.url();
check("/study 重定向到 /vocab", redirectedUrl.includes("/vocab"), redirectedUrl);

/* 2. 切到词书 tab */
await page.goto(withSc(`${BASE}/vocab`), { waitUntil: "domcontentloaded", timeout: 60000 });
await sleep(3000);
const booksTab = await evalClick(/词书/);
await sleep(2500);
check("词书 tab 可切换", booksTab);

/* 3. 书架：左侧列表应包含 阅读生词 / 内置词书 / 我的词本 */
const bookNames = await page.evaluate(() =>
  [...document.querySelectorAll("aside button")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()),
);
check("左侧书架有词书列表", bookNames.length >= 3, bookNames.slice(0, 6).join(" | "));
check("包含「阅读生词」", bookNames.some((n) => n.includes("阅读生词")));
check("包含内置四六级词书", bookNames.some((n) => n.includes("四级") || n.includes("六级") || n.includes("高频")));
check("包含「我的」词本", bookNames.some((n) => n.includes("我的")));

/* 4. 左右布局：有 aside（左）和右侧 section */
const layout = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  return { hasAside: Boolean(aside) };
});
check("左右布局（有左侧 aside）", layout.hasAside);

/* 5. 选中一个词本（点第一个内置词书），右侧展示内容 */
const clickedBook = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("aside button")];
  const target = btns.find((b) => (b.textContent ?? "").includes("四级") || (b.textContent ?? "").includes("六级"));
  if (!target) return false;
  target.click();
  return true;
});
await sleep(2500);
const rightPane = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("section")];
  const s = sections.find((x) => (x.textContent ?? "").includes("开始背"));
  return s ? (s.textContent ?? "").slice(0, 80) : "";
});
check("选中词书后右侧有「开始背」", clickedBook && rightPane.includes("开始背"), rightPane.slice(0, 50));

/* 6. 新建词本 */
const bookName = "验收词本" + Date.now().toString().slice(-4);
await page.evaluate((name) => {
  const input = [...document.querySelectorAll("input")].find((i) => i.placeholder?.includes("词本名字"));
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, name);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, bookName);
await sleep(300);
const created = await evalClick(/^新建$/);
// 线上响应慢，轮询等新词本出现在书架
let newBookShown = false;
for (let i = 0; i < 8 && !newBookShown; i++) {
  await sleep(1500);
  newBookShown = await page.evaluate((name) => {
    const btns = [...document.querySelectorAll("aside button")];
    return btns.some((b) => (b.textContent ?? "").includes(name));
  }, bookName);
}
check("新建词本成功并出现在书架", created && newBookShown, bookName);

/* 7. 加词到新建词本（新建后已自动选中，无需再点） */
let addInput = false;
for (let i = 0; i < 8 && !addInput; i++) {
  addInput = await page.evaluate(() => {
    const input = [...document.querySelectorAll("input")].find((i) => i.placeholder?.includes("加词"));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "abandon abandon");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  if (!addInput) await sleep(1500);
}
await sleep(300);
const added = addInput && (await evalClick(/^加入$/));
let wordShown = false;
for (let i = 0; i < 8 && !wordShown; i++) {
  await sleep(1500);
  wordShown = await page.evaluate(() => document.body.innerText.includes("abandon"));
}
check("往新建词本加词成功", added && wordShown);

/* 8. 直接背内置词书（15 个一轮） */
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("aside button")];
  const target = btns.find((b) => (b.textContent ?? "").includes("四级") || (b.textContent ?? "").includes("六级"));
  target?.click();
});
await sleep(2500);
const started = await evalClick(/开始背/);
await sleep(4000);
const session = await page.evaluate(() => {
  const roundTag = [...document.querySelectorAll("span")].find((s) => (s.textContent ?? "").includes("第") && (s.textContent ?? "").includes("轮"));
  const progress = [...document.querySelectorAll("span")].find((s) => /^1\/\d+$/.test((s.textContent ?? "").trim()));
  return { round: roundTag?.textContent?.trim() ?? "", progress: progress?.textContent?.trim() ?? "" };
});
check("背词会话开始，显示「第 1 轮」", started && session.round.includes("第 1 轮"), session.round);
check("本轮进度分母是 15", /^1\/15$/.test(session.progress), session.progress || "未取到");

/* 9. 全程无 JS 报错 */
check("全程无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
