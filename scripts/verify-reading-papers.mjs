/**
 * 多套卷的阅读板块结构巡检：确认三种题型的模板在各种数据形态下都成立。
 * 不交卷，只看渲染结构 + 控制台。
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
const EXECUTABLE =
  process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAPERS = (process.env.PAPERS ?? "cet4-2026-06-s1,cet6-2026-06-s1,cet4-2025-12-s1,paper-cet4-2024-12").split(",");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
let failures = 0;

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.type('input[type="email"]', "demo@cet.local");
await page.type('input[type="password"]', "demo1234");
await Promise.all([
  page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await sleep(500);

for (const paper of PAPERS) {
  const errors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto(`${BASE}/practice/${paper}`, { waitUntil: "networkidle2" });
  await sleep(1000);

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll("nav button")].map((el) => el.textContent?.trim() ?? ""),
  );
  const passageTabs = tabs.filter((t) => /选词填空|长篇阅读匹配|仔细阅读|阅读 \d/.test(t));
  const boards = passageTabs.length ? passageTabs : ["(单篇)"];

  for (const board of boards) {
    if (passageTabs.length) {
      const handle = await page.evaluateHandle(
        (t) => [...document.querySelectorAll("nav button")].find((el) => el.textContent?.trim() === t) ?? null,
        board,
      );
      const el = handle.asElement();
      if (el) {
        await el.click();
        await sleep(450);
      }
    }

    const stats = await page.evaluate(() => ({
      blanks: document.querySelectorAll("p button[aria-label^='第']").length,
      bank: [...document.querySelectorAll("ul.grid button")].filter((el) => /^[A-O]/.test(el.textContent ?? ""))
        .length,
      rows: document.querySelectorAll("li[id^='q-']").length,
      letters: document.querySelectorAll("li[id^='q-'] div[aria-label='匹配段落']").length,
      letterCount: document.querySelector("li[id^='q-'] div[aria-label='匹配段落']")?.querySelectorAll("button")
        .length ?? 0,
      optionGroups: document.querySelectorAll("li[id^='q-'] ul[aria-label='选项']").length,
      optionCount:
        document.querySelector("li[id^='q-'] ul[aria-label='选项']")?.querySelectorAll("button").length ?? 0,
      board: document.querySelector("section span.font-serif")?.textContent ?? "",
      instr: [...document.querySelectorAll("p")].find((n) => /每题匹配|从词库|完成 \d+/.test(n.textContent ?? ""))
        ?.textContent ?? "",
    }));

    const isBanked = stats.bank > 0 || stats.blanks > 0;
    const kind = stats.letters > 0 ? "matching" : isBanked ? "banked" : stats.optionGroups > 0 ? "choice" : "unknown";
    const ok =
      (kind === "banked" && stats.blanks === 10 && stats.bank >= 10 && stats.rows === 10) ||
      (kind === "matching" && stats.letters === 10 && stats.letterCount >= 4 && stats.rows === 10) ||
      (kind === "choice" && stats.optionGroups === stats.rows && stats.optionCount === 4 && stats.rows > 0);

    if (!ok) failures += 1;
    console.log(
      `${ok ? "  ✓" : "  ✗"} ${paper} · ${board} → ${kind}  空号${stats.blanks} 词库${stats.bank} 行${stats.rows} 字母行${stats.letters}×${stats.letterCount} 选项组${stats.optionGroups}×${stats.optionCount}`,
    );
  }

  if (errors.length) {
    failures += 1;
    console.log(`  ✗ ${paper} 页面异常：${errors[0]}`);
  }
}

await browser.close();
console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项异常`);
process.exitCode = failures === 0 ? 0 : 1;
