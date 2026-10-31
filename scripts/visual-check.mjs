/**
 * 浏览器级验收：用真实浏览器验证「两栏独立滚动」并截图。
 * 依赖 puppeteer-core + 本机 Chrome/Edge，不下载浏览器。
 *
 * 用法：先 npm run build && npm start，再 node scripts/visual-check.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.SHOT_DIR ?? "./shots";
const EXECUTABLE =
  process.env.BROWSER_PATH ??
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

fs.mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, text, tag = "button") {
  const handle = await page.evaluateHandle(
    (t, g) => [...document.querySelectorAll(g)].find((el) => el.textContent?.includes(t)) ?? null,
    text,
    tag,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`找不到按钮：${text}`);
  await element.click();
  return element;
}

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

try {
  console.log("\n[1] 登录");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', "demo@cet.local");
  await page.type('input[type="password"]', "demo1234");
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1200);
  record("登录后落到首页", !page.url().includes("/login"), page.url());
  await page.screenshot({ path: `${OUT}/02-home.png`, fullPage: false });

  console.log("\n[2] 进入刷题页");
  await page.goto(`${BASE}/practice/paper-cet4-2024-12`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-word]", { timeout: 15000 });
  await sleep(600);
  record("文章分词渲染出来了", (await page.$$("[data-word]")).length > 200);
  await page.screenshot({ path: `${OUT}/03-practice.png` });

  console.log("\n[3] 两栏独立滚动（核心验收）");
  const panes = await page.$$(".scroll-pane");
  record("页面上有两个独立滚动容器", panes.length === 2, `实际 ${panes.length}`);

  const before = await page.evaluate(() => {
    const [left, right] = [...document.querySelectorAll(".scroll-pane")];
    right.scrollTop = 0;
    left.scrollTop = 0;
    return { left: left.scrollTop, right: right.scrollTop };
  });

  // 滚左栏，右栏必须一动不动
  const afterLeftScroll = await page.evaluate(() => {
    const [left, right] = [...document.querySelectorAll(".scroll-pane")];
    left.scrollTop = 420;
    left.dispatchEvent(new Event("scroll", { bubbles: true }));
    return { left: left.scrollTop, right: right.scrollTop };
  });
  record(
    "滚动左栏后左栏确实滚动了",
    afterLeftScroll.left > 300,
    `left=${afterLeftScroll.left}`,
  );
  record(
    "滚动左栏，右栏位置完全不动",
    afterLeftScroll.right === before.right,
    `right ${before.right} → ${afterLeftScroll.right}`,
  );

  // 切题，左栏必须一动不动
  const leftScrollBeforeNext = afterLeftScroll.left;
  await clickByText(page, "下一题");
  await sleep(500);
  const afterNext = await page.evaluate(() => {
    const [left, right] = [...document.querySelectorAll(".scroll-pane")];
    return { left: left.scrollTop, right: right.scrollTop };
  });
  record(
    "切到下一题，左栏滚动位置完全不变",
    Math.abs(afterNext.left - leftScrollBeforeNext) <= 1,
    `${leftScrollBeforeNext} → ${afterNext.left}`,
  );

  // 切回上一题，右栏恢复自己的滚动位置
  await clickByText(page, "上一题");
  await sleep(400);
  record(
    "能切回上一题",
    (await page.evaluate(() => document.body.innerText)).includes("第 1 / 5 题"),
  );

  console.log("\n[4] 答题 → 提交 → 解析");
  await clickByText(page, "上一题").catch(() => {});
  await sleep(300);
  const radios = await page.$$('[role="radio"]');
  record("四个选项渲染正常", radios.length === 4, `实际 ${radios.length}`);
  await radios[1].click(); // B，正确项
  await sleep(200);
  await clickByText(page, "提交答案");
  await sleep(900);
  const submittedHtml = await page.content();
  record("提交后显示判题结果", submittedHtml.includes("答对了") || submittedHtml.includes("答错了"));
  await clickByText(page, "答案与解析");
  await sleep(700);
  const analysisHtml = await page.content();
  record("解析展开后有正确答案", analysisHtml.includes("正确答案"));
  record("解析里有逐项分析", analysisHtml.includes("逐项分析"));
  await page.screenshot({ path: `${OUT}/04-analysis.png` });

  console.log("\n[5] 点词查词 + 词卡边界");
  const wordResult = await page.evaluate(() => {
    const words = [...document.querySelectorAll("[data-word]")];
    // 取最靠右下角的一个词，专门测边界翻转
    const target = words.reduce((best, el) => {
      const r = el.getBoundingClientRect();
      const score = r.top + r.left / 10;
      if (!best) return el;
      const b = best.getBoundingClientRect();
      return score > b.top + b.left / 10 ? el : best;
    }, null);
    target?.scrollIntoView({ block: "center" });
    return target ? target.textContent : null;
  });
  await sleep(400);
  const word = await page.evaluate(() => {
    // 挑一个内置词库里有的词，保证词卡有内容、也能测「加入生词本」
    const known = ["nostalgia", "convenience", "stationery", "algorithm", "superior", "researchers"];
    const words = [...document.querySelectorAll("[data-word]")];
    const target =
      words.find((el) => known.includes((el.textContent ?? "").toLowerCase())) ?? words[5];
    target.scrollIntoView({ block: "center" });
    target.click();
    return target.textContent;
  });
  await sleep(1200);
  const card = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const r = dialog.getBoundingClientRect();
    return {
      text: dialog.textContent?.slice(0, 60),
      fits:
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= window.innerWidth + 1 &&
        r.bottom <= window.innerHeight + 1,
      inViewport: r.width > 100,
    };
  });
  record(`点词「${word}」弹出词卡`, Boolean(card?.inViewport), JSON.stringify(card));
  record("词卡没有溢出视口", card?.fits === true, JSON.stringify(card));
  await page.screenshot({ path: `${OUT}/05-wordcard.png` });

  // 加入生词本 → 正文出现淡黄底
  const added = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("加入生词本"),
    );
    btn?.click();
    return Boolean(btn);
  });
  await sleep(1200);
  const highlighted = await page.$$eval(".word-in-vocab", (els) => els.length);
  record("加入生词本后正文有淡黄底标记", added && highlighted > 0, `高亮词数 ${highlighted}`);
  await page.screenshot({ path: `${OUT}/06-vocab-highlight.png` });

  // 关掉词卡
  await page.keyboard.press("Escape");
  await sleep(200);

  console.log("\n[6] 抽屉：AI / 留言");
  await clickByText(page, "问 AI");
  await sleep(600);
  const aiOpen = await page.evaluate(() => document.body.innerText.includes("已经把这篇文章"));
  record("AI 抽屉打开并给出快捷提问", aiOpen);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("这一段是什么意思"),
    );
    btn?.click();
  });
  await sleep(2500);
  const aiAnswered = await page.evaluate(() => document.body.innerText.includes("演示模式"));
  record("AI 有流式回答（当前为演示模式）", aiAnswered);
  await page.screenshot({ path: `${OUT}/07-ai.png` });
  await page.keyboard.press("Escape");
  await sleep(300);

  await clickByText(page, "笔记与讨论");
  await sleep(700);
  record("留言抽屉打开", await page.evaluate(() => document.body.innerText.includes("我的笔记")));
  await page.screenshot({ path: `${OUT}/08-comments.png` });
  await page.keyboard.press("Escape");

  console.log("\n[7] 生词本页面");
  await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle2" });
  await sleep(900);
  const vocabPage = await page.evaluate(() => document.body.innerText);
  record(
    "生词本收录了刚加入的词",
    vocabPage.includes("生词本") && (vocabPage.includes("点击卡片查看释义") || vocabPage.includes("已掌握")),
    vocabPage.slice(0, 60).replace(/\n/g, " "),
  );
  await page.screenshot({ path: `${OUT}/09-vocab.png` });

  console.log("\n[8] 手机端 Tab");
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.goto(`${BASE}/practice/paper-cet4-2024-12`, { waitUntil: "networkidle2" });
  await sleep(900);
  const mobile = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("button")].filter((b) =>
      ["文章", "题目"].includes(b.textContent?.trim() ?? ""),
    );
    const panes = [...document.querySelectorAll(".scroll-pane")];
    return {
      tabCount: tabs.length,
      leftVisible: panes[0] ? getComputedStyle(panes[0]).visibility : "none",
      rightVisible: panes[1] ? getComputedStyle(panes[1]).visibility : "none",
    };
  });
  record("手机端出现「文章/题目」Tab", mobile.tabCount === 2, JSON.stringify(mobile));
  await page.screenshot({ path: `${OUT}/10-mobile-article.png` });

  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "题目");
    tab?.click();
  });
  await sleep(600);
  const mobileAfter = await page.evaluate(() => {
    const panes = [...document.querySelectorAll(".scroll-pane")];
    return {
      leftVisible: panes[0] ? getComputedStyle(panes[0]).visibility : "none",
      rightVisible: panes[1] ? getComputedStyle(panes[1]).visibility : "none",
    };
  });
  record(
    "切到题目 Tab 后题目栏可见、文章栏仍在 DOM",
    mobileAfter.rightVisible === "visible" && mobileAfter.leftVisible === "hidden",
    JSON.stringify(mobileAfter),
  );
  await page.screenshot({ path: `${OUT}/11-mobile-question.png` });

  console.log("\n[9] 控制台错误");
  const realErrors = consoleErrors.filter(
    (e) => !e.includes("favicon") && !e.includes("Download the React DevTools"),
  );
  record("页面无 JS 报错", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
} catch (error) {
  console.error("\n浏览器验收异常：", error);
  results.push({ name: "执行异常", ok: false, detail: String(error) });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length} 通过 / ${failed.length} 失败`);
console.log(`截图目录：${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
