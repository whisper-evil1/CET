/**
 * 复现真实用户操作路径，抓出所有非 2xx 响应及其响应体。
 *
 * 为什么需要这个脚本：
 *   live-verify.mjs 发的是串行、单次的接口请求，全绿但用户仍在报错。
 *   差异只可能来自「真实浏览器里的操作序列」——多个请求并发、带状态、
 *   中间夹着页面跳转与流式读取。所以这里用真浏览器把整条路径走一遍，
 *   把每一个失败响应连同 body 一起打出来，不靠猜。
 *
 * 用法：
 *   CHECK_BASE=https://xxx.app.workbuddy.host CHECK_SHARE=XXXX node scripts/repro-user-path.mjs
 */
import { launchAndLogin, sleep } from "./lib/live-browser.mjs";

const BASE = (process.env.CHECK_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const SHARE = process.env.CHECK_SHARE || "";
const EMAIL = process.env.CHECK_EMAIL || "demo@cet.local";
const PASSWORD = process.env.CHECK_PASSWORD || "demo1234";
const PAPER = process.env.CHECK_PAPER || "paper-cet4-2024-12";

const withShare = (p) => (SHARE ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SHARE}` : "");

/* ---------- 全局请求记录 ---------- */
const failures = [];
const allApi = [];

const { browser, page, loggedIn } = await launchAndLogin({
  base: BASE,
  share: SHARE,
  email: EMAIL,
  password: PASSWORD,
});
console.log(`登录：${loggedIn ? "成功" : "失败"}`);

page.on("response", async (res) => {
  const url = res.url();
  const status = res.status();
  if (!url.includes("/api/") && !url.includes("/practice/")) return;

  const short = url.replace(BASE, "").replace(/[?&]sharecode=[^&]*/, "");
  allApi.push(`${status} ${res.request().method()} ${short}`);

  if (status >= 400) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = "(读不到 body)";
    }
    failures.push({ status, method: res.request().method(), url: short, body });
  }
});

page.on("pageerror", (e) => {
  failures.push({ status: "JS", method: "-", url: "pageerror", body: String(e).slice(0, 300) });
});
page.on("console", (msg) => {
  if (msg.type() === "error") {
    const t = msg.text();
    if (!/favicon|Failed to load resource/.test(t)) {
      failures.push({ status: "CONSOLE", method: "-", url: "console.error", body: t.slice(0, 300) });
    }
  }
});

/* ---------- 1. 打开练习页 ---------- */
console.log("\n[1] 打开练习页");
await page.goto(BASE + withShare(`/practice/${PAPER}`), {
  waitUntil: "networkidle2",
  timeout: 90000,
});
await sleep(2500);
const banner1 = await page.evaluate(() => {
  const m = document.body.innerText.match(/服务器开小差[^\n]*/);
  return m ? m[0] : "";
});
console.log("  页面错误横幅:", banner1 || "(无)");

/* ---------- 2. 点单词 → 查词 → 加入生词本 ---------- */
console.log("\n[2] 点单词查词并加入生词本");
const clicked = await page.evaluate(() => {
  // 点击正文里的一个英文单词（article 区域）
  const words = [...document.querySelectorAll("article span, .passage-text span, p span")];
  const hit = words.find((el) => /^[A-Za-z]{4,}$/.test((el.textContent || "").trim()));
  if (!hit) return null;
  hit.click();
  return (hit.textContent || "").trim();
});
console.log("  点中单词:", clicked || "(未找到可点单词)");
await sleep(3000);

// 词卡里的「+ 加入生词本」
const addBtn = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /加入生词本/.test(b.textContent || ""),
  );
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
console.log("  加入生词本按钮:", addBtn);
await sleep(3500);

const vocabMsg = await page.evaluate(() => {
  const body = document.body.innerText;
  const m = body.match(/加入失败[^\n]*|已加入[^\n]*|加入成功[^\n]*/);
  return m ? m[0] : "(无提示)";
});
console.log("  词卡反馈:", vocabMsg);

// 关闭词卡
await page.keyboard.press("Escape");
await sleep(800);

/* ---------- 3. 选答案并提交 ---------- */
console.log("\n[3] 选答案并提交");
const picked = await page.evaluate(() => {
  const opts = [...document.querySelectorAll("button")].filter((b) =>
    /^[A-D]$/.test((b.textContent || "").trim()),
  );
  if (!opts.length) return null;
  opts[1].click();
  return (opts[1].textContent || "").trim();
});
console.log("  选中选项:", picked || "(未找到选项)");
await sleep(800);

const submitted = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /提交答案/.test(b.textContent || ""),
  );
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
console.log("  提交按钮:", submitted);
await sleep(4000);

const submitMsg = await page.evaluate(() => {
  const body = document.body.innerText;
  const m = body.match(/服务器开小差[^\n]*|提交失败[^\n]*|回答正确[^\n]*|答对了[^\n]*|回答错误[^\n]*/);
  return m ? m[0] : "(无提示)";
});
console.log("  提交反馈:", submitMsg);

/* ---------- 4. 展开解析 ---------- */
console.log("\n[4] 展开答案解析");
const toggle = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /答案与解析|解析/.test(b.textContent || ""),
  );
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
console.log("  解析开关:", toggle);
await sleep(3500);

/* ---------- 5. 收藏 ---------- */
console.log("\n[5] 收藏本题");
const fav = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label*="收藏"], [title*="收藏"]');
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
console.log("  收藏按钮:", fav);
await sleep(2000);

/* ---------- 6. 切几道题，覆盖多篇阅读 ---------- */
console.log("\n[6] 连续切题 5 次");
for (let i = 0; i < 5; i += 1) {
  await page.keyboard.press("ArrowRight");
  await sleep(900);
}

/* ---------- 7. 打开 AI 抽屉 ---------- */
console.log("\n[7] 打开 AI 答疑抽屉");
const aiBtn = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /问\s*AI|AI\s*答疑/.test(b.textContent || ""));
  if (!btn) return "no-button";
  btn.click();
  return "clicked";
});
console.log("  AI 按钮:", aiBtn);
await sleep(2500);

const ctxMsg = await page.evaluate(() => {
  const body = document.body.innerText;
  const m = body.match(/服务器开小差[^\n]*|上下文[^\n]*/);
  return m ? m[0] : "(无)";
});
console.log("  抽屉状态:", ctxMsg);
await sleep(3000);

/* ---------- 汇总 ---------- */
console.log("\n=== 失败响应 ===");
if (!failures.length) {
  console.log("(无)");
} else {
  for (const f of failures) {
    console.log(`${f.status} | ${f.method} ${f.url}`);
    console.log(`   body: ${f.body.replace(/\s+/g, " ").slice(0, 400)}`);
  }
}

console.log("\n=== 全部 API 调用 ===");
for (const line of allApi) console.log(" ", line);

await browser.close();
process.exit(failures.filter((f) => f.status !== "CONSOLE").length > 0 ? 1 : 0);
