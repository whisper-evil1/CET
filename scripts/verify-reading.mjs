/**
 * 阅读答题模板验收：选词填空 / 段落匹配 / 仔细阅读，逐个交卷并截图。
 * 用法：NEXT_DIST_DIR=.next-s1 npx next dev -p 3010
 *       node scripts/verify-reading.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
/** 线上走分享链接时每个页面都要带 sharecode，否则被网关 403 */
const SHARE = process.env.CHECK_SHARE ?? "";
const url = (path) =>
  !SHARE ? `${BASE}${path}` : `${BASE}${path}${path.includes("?") ? "&" : "?"}sharecode=${SHARE}`;
const PAPER = process.env.PAPER ?? "cet4-2026-06-s1";
const OUT = process.env.SHOT_DIR ?? "./shots/reading";
const EXECUTABLE =
  process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

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

const clickText = async (text, tag = "button") => {
  const handle = await page.evaluateHandle(
    (t, g) => [...document.querySelectorAll(g)].find((el) => (el.textContent ?? "").includes(t)) ?? null,
    text,
    tag,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到元素：${text}`);
  await element.click();
  await sleep(260);
};

try {
  console.log("\n[1] 登录");
  await page.goto(url("/login"), { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', "demo@cet.local");
  await page.type('input[type="password"]', "demo1234");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(600);
  record("登录成功", !page.url().includes("/login"), page.url());

  console.log("\n[2] 打开阅读卷");
  await page.goto(url(`/practice/${PAPER}`), { waitUntil: "networkidle2" });
  await sleep(1200);

  const blankChips = await page.$$eval("p button[aria-label^='第']", (els) => els.length);
  record("正文内联空号渲染", blankChips === 10, `${blankChips} 个空号`);

  const bankCount = await page.$$eval("ul.grid button", (els) =>
    els.filter((el) => /^[A-O]/.test(el.textContent ?? "")).length,
  );
  record("词库 A–O 渲染", bankCount >= 15, `${bankCount} 个词`);

  const dupOptions = await page.evaluate(() => {
    const lists = [...document.querySelectorAll("li[id^='q-'] ul[role='radiogroup']")];
    return lists.length;
  });
  record("选词填空不再出现十份重复选项", dupOptions === 0, `${dupOptions} 份选项列表`);

  await page.screenshot({ path: `${OUT}/01-banked-empty.png` });

  console.log("\n[3] 选词填空：点词填空 + 交卷");
  // 依次点词库前 10 个词，自动填进 26–35
  const wordButtons = await page.$$("ul.grid button");
  for (let i = 0; i < 10 && i < wordButtons.length; i += 1) {
    await wordButtons[i].click();
    await sleep(90);
  }
  const filled = await page.$$eval("li[id^='q-'] button[data-question]", (els) =>
    els.filter((el) => !el.textContent?.includes("点这里选词")).length,
  );
  record("十个空全部填上", filled === 10, `${filled}/10`);
  await page.screenshot({ path: `${OUT}/02-banked-filled.png` });

  // 切到别的板块再切回来：填好的空不能丢（服务端首屏快照不该覆盖本地作答）
  await clickText("长篇阅读匹配");
  await sleep(500);
  await clickText("选词填空");
  await sleep(500);
  const stillFilled = await page.$$eval("li[id^='q-'] button[data-question]", (els) =>
    els.filter((el) => !el.textContent?.includes("点这里选词")).length,
  );
  record("切板块回来后作答不丢", stillFilled === 10, `${stillFilled}/10`);

  await clickText("交卷");
  await sleep(1400);

  const gradedRows = await page.$$eval("li[id^='q-']", (els) =>
    els.filter((el) => /答对|答错/.test(el.textContent ?? "")).length,
  );
  record("选词填空交卷后可判分", gradedRows === 10, `${gradedRows} 行有判分结果`);

  const correctLetterShown = await page.evaluate(() =>
    [...document.querySelectorAll("li[id^='q-']")].some((el) => /正确答案/.test(el.textContent ?? "")),
  );
  record("判分后显示正确答案（含字母）", correctLetterShown);

  const scoreChip = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((n) => /答对 \d+ 题/.test(n.textContent ?? ""));
    return el?.textContent ?? "";
  });
  record("顶部显示得分", /答对/.test(scoreChip), scoreChip);

  const instr = await page.evaluate(() => {
    const el = [...document.querySelectorAll("p")].find((n) =>
      /每题匹配|从词库|完成 \d+/.test(n.textContent ?? ""),
    );
    if (!el) return { h: 0, text: "" };
    return { h: el.getBoundingClientRect().height, text: el.textContent?.slice(0, 30) ?? "" };
  });
  record("题型说明行高度正常", instr.h >= 24, `高度 ${Math.round(instr.h)}px`);

  await page.screenshot({ path: `${OUT}/03-banked-graded.png` });

  console.log("\n[4] 段落匹配");
  await clickText("长篇阅读匹配");
  await sleep(600);
  const letterRows = await page.$$eval("li[id^='q-'] div[aria-label='匹配段落']", (els) => els.length);
  record("十道陈述各有一排段落字母", letterRows === 10, `${letterRows} 行`);
  const letterCount = await page.evaluate(() => {
    const first = document.querySelector("li[id^='q-'] div[aria-label='匹配段落']");
    return first ? first.querySelectorAll("button").length : 0;
  });
  record("段落字母覆盖到 F 及以后", letterCount >= 6, `第一行 ${letterCount} 个字母`);

  const rows = await page.$$("li[id^='q-'] div[aria-label='匹配段落']");
  for (const row of rows) {
    const buttons = await row.$$("button");
    if (buttons[1]) await buttons[1].click();
    await sleep(60);
  }
  const selectedLetters = await page.$$eval(
    "li[id^='q-'] div[aria-label='匹配段落'] button[aria-checked='true']",
    (els) => els.length,
  );
  record("十行都选中了段落字母", selectedLetters === 10, `${selectedLetters}/10`);
  await page.screenshot({ path: `${OUT}/04-matching-filled.png` });

  await clickText("交卷");
  await sleep(1400);
  const matchGraded = await page.$$eval("li[id^='q-']", (els) =>
    els.filter((el) => /答对|答错/.test(el.textContent ?? "")).length,
  );
  record("段落匹配交卷后可判分", matchGraded === 10, `${matchGraded} 行`);
  await page.screenshot({ path: `${OUT}/05-matching-graded.png` });

  console.log("\n[5] 仔细阅读（一）");
  await clickText("仔细阅读一");
  await sleep(600);
  const optionRows = await page.$$eval("li[id^='q-'] ul[aria-label='选项']", (els) => els.length);
  record("五道题各一组 A–D 选项", optionRows === 5, `${optionRows} 组`);

  const choiceRows = await page.$$("li[id^='q-'] ul[aria-label='选项']");
  for (const row of choiceRows) {
    const buttons = await row.$$("button");
    if (buttons[0]) await buttons[0].click();
    await sleep(60);
  }
  const selectedChoices = await page.$$eval(
    "li[id^='q-'] ul[aria-label='选项'] button[aria-checked='true']",
    (els) => els.length,
  );
  record("五道题都选好了选项", selectedChoices === 5, `${selectedChoices}/5`);
  await clickText("交卷");
  await sleep(1400);
  const choiceGraded = await page.$$eval("li[id^='q-']", (els) =>
    els.filter((el) => /答对|答错/.test(el.textContent ?? "")).length,
  );
  record("仔细阅读交卷后可判分", choiceGraded === 5, `${choiceGraded} 行`);
  await page.screenshot({ path: `${OUT}/06-choice-graded.png` });

  console.log("\n[6] 展开解析");
  const firstAnalysis = await page.$$("li[id^='q-'] button");
  const toggle = await page.evaluateHandle(() =>
    [...document.querySelectorAll("li[id^='q-'] button")].find((el) =>
      /看解析|直接看解析/.test(el.textContent ?? ""),
    ),
  );
  const toggleEl = toggle.asElement();
  if (toggleEl) {
    await toggleEl.click();
    await sleep(1200);
    const hasPanel = await page.evaluate(() => /正确答案/.test(document.body.textContent ?? ""));
    record("解析面板可展开", hasPanel);
    await page.screenshot({ path: `${OUT}/07-analysis.png` });
  } else {
    record("解析面板可展开", false, "找不到解析按钮");
  }

  console.log("\n[7] 控制台错误");
  const realErrors = consoleErrors.filter(
    (text) => !/favicon|Download the React DevTools|hydration/i.test(text),
  );
  record("无控制台错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (error) {
  record("脚本执行", false, error.message);
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) process.exitCode = 1;
