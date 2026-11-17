// 创作作品「自动入库 → 回列表可见」闭环验收
//
// 覆盖用户反馈的两个真实问题：
//   1. 做了一版之后网页端没有记录可以查看；
//   2. 切出去再回来，作品库还是空的。
//
// 做法：用演示账号登录 → 走前端同一条保存接口（POST /api/create，即
// persist() 内部调用的那条）存一条带唯一标题的作品 → 打开 /create 断言
// 标题出现在「我的创作」里 → DELETE 清理，不污染演示账号。
//
// 用法：BASE=http://127.0.0.1:3100 node scripts/verify-create-autosave.mjs
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://127.0.0.1:3100";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
};

const TITLE = `验收作品-${Date.now().toString(36)}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

async function waitHydrated() {
  for (let i = 0; i < 40; i++) {
    const h = await page
      .evaluate(() => Object.keys(document.body || {}).some((k) => k.startsWith("__react")))
      .catch(() => false);
    if (h) return true;
    await sleep(1000);
  }
  return false;
}

/* ---------- 登录（演示账号） ---------- */
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
await sleep(1500);
for (let i = 0; i < 5; i++) {
  const clicked = await page
    .evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /演示账号/.test(x.textContent ?? ""));
      if (b) {
        b.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (clicked) break;
  await sleep(1500);
}
for (let i = 0; i < 12; i++) {
  if (!page.url().includes("/login")) break;
  await sleep(1500);
}
check("演示账号登录成功", !page.url().includes("/login"));

/* ---------- 保存一条作品（前端 persist 走的同一条接口） ---------- */
const saved = await page.evaluate(async (title) => {
  const res = await fetch("/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "novel",
      title,
      sourceText: "验收用原文，仅用于确认作品能落库并在列表里出现。",
      output: JSON.stringify({ title, paragraphs: [{ zh: "验收", en: "acceptance check" }] }),
      meta: JSON.stringify({ style: "literary", paragraphs: 2 }),
    }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, id: json?.data?.id ?? null, code: json?.code ?? null };
}, TITLE);
check("POST /api/create 保存成功", saved.status === 200 && Boolean(saved.id), `id=${saved.id}`);

/* ---------- 回列表看得到 ---------- */
await page.goto(`${BASE}/create`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await waitHydrated();
await sleep(2500);
const listed = await page.evaluate((title) => (document.body?.innerText ?? "").includes(title), TITLE);
check("作品库里能看到刚保存的一版", listed, TITLE);

/* ---------- 清理，不留测试数据 ---------- */
const cleaned = await page.evaluate(async (id) => {
  const res = await fetch(`/api/create/${id}`, { method: "DELETE" });
  return res.status;
}, saved.id);
check("测试作品已清理", cleaned === 200 || cleaned === 204, `status=${cleaned}`);

await browser.close();
console.log(`\n== 结果 == 通过 ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
