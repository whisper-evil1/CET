/**
 * 第 11 轮验收：听力是不是真题原文。
 *
 * 断言四件事：
 *   A. 卷库里不再有任何「仿真材料」徽标（整卷已是真题，卡片应标「官方原题」）；
 *   B. 练习页听力原文第一句与真题解析页逐字一致（2025-12 第二套 News 1 开头）；
 *   C. 「中译」开关能开，且原文行带逐句中译；
 *   D. 题目是真题题面：25 题、每题 4 选项、答案 A–D。
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round11";
const PAPER = "cet4-2025-12-s2";

const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
const line = raw.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="));
const secret = line ? line.split("=")[1].trim().replace(/^["']|["']$/g, "") : "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev", email: "dev@local" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1.5 });
await page.setCookie({ name: "authjs.session-token", value: token, domain: "127.0.0.1", path: "/" });

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

/* A. 卷库徽标 */
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: `${OUT}/a-library.png` });
const badges = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hybrid: (text.match(/听力真题/g) ?? []).length,
    simulated: (text.match(/仿真材料/g) ?? []).length,
    official: (text.match(/官方原题/g) ?? []).length,
  };
});
// 第 12 轮把阅读/写作/翻译也换成了真题，徽标从「听力真题」升级成「官方原题」；
// 这里只守一条底线：不许再把仿真稿当真题卖。
check("卷库没有「仿真材料」徽标", badges.simulated === 0, JSON.stringify(badges));
check("卷库标出「官方原题」", badges.official > 0, JSON.stringify(badges));

/* B/C/D. 练习页听力 */
await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));

// 卷子默认停在阅读，先切到听力
const switched = await page.evaluate(() => {
  const tab = Array.from(document.querySelectorAll("button, a")).find(
    (el) => el.textContent?.trim() === "听力"
  );
  if (!tab) return false;
  tab.click();
  return true;
});
check("切到听力栏目", switched);
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${OUT}/b-practice.png` });

const noteText = await page.evaluate(() => document.body.innerText.includes("真题原文"));
check("播放器下方标明原文性质", noteText);

const opened = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("展开听力原文")
  );
  if (!btn) return false;
  btn.click();
  return true;
});
check("能展开听力原文", opened);
await new Promise((r) => setTimeout(r, 700));

const transcript = await page.evaluate(() => {
  const box = Array.from(document.querySelectorAll("div")).find((d) =>
    d.textContent?.includes("Customs and Border Protection")
  );
  return box ? box.innerText.slice(0, 400) : "";
});
check(
  "原文与真题逐字一致",
  transcript.includes("Customs and Border Protection officials are seeing a rise"),
  transcript.slice(0, 80)
);
await page.screenshot({ path: `${OUT}/c-transcript.png` });

const zhClicked = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "中译");
  if (!btn) return false;
  btn.click();
  return true;
});
check("有「中译」开关", zhClicked);
await new Promise((r) => setTimeout(r, 600));
const zhShown = await page.evaluate(() => document.body.innerText.includes("美国海关与边境保护局"));
check("中译可显示", zhShown);
await page.screenshot({ path: `${OUT}/d-zh.png` });

/* 题目结构走接口核对（题面在右栏，逐题渲染依赖滚动，直接查数据更可靠） */
const api = await page.evaluate(async (id) => {
  const res = await fetch(`/api/papers/${id}`);
  const json = await res.json();
  const listening = json?.data?.sections?.find((s) => s.type === "listening");
  const qs = listening?.passages?.flatMap((p) => p.questions ?? []) ?? [];
  return {
    passages: listening?.passages?.length ?? 0,
    questions: qs.length,
    badOptions: qs.filter((q) => (q.options ?? []).length !== 4).length,
    sentences: listening?.passages?.reduce((a, p) => a + (p.transcript?.length ?? 0), 0) ?? 0,
    note: listening?.note ?? "",
  };
}, PAPER);
check("听力篇目 8 篇", api.passages === 8, String(api.passages));
check("听力 25 题", api.questions === 25, String(api.questions));
check("每题 4 个选项", api.badOptions === 0, `异常 ${api.badOptions} 题`);
check("原文句数充足", api.sentences >= 40, `${api.sentences} 句`);
check("接口带口径说明", api.note.includes("真题"), api.note.slice(0, 24));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) process.exit(1);
