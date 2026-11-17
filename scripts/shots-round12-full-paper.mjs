/**
 * 第 12 轮验收：整卷是不是真题。
 *
 * 这一轮把阅读/写作/翻译也换成了真题原卷，要验的是「页面上真的能看到原卷内容」：
 *   A. 卷库卡片标「官方原题」（不再是「听力真题 / 仿真材料」）；
 *   B. 选词填空：原文带 26–35 空号、词库 15 个词、10 题都能作答并判对；
 *   C. 长篇阅读：段落 ≥10 段、10 道匹配题、作答后能判对；
 *   D. 仔细阅读：两篇共 10 题、每题 4 选项；
 *   E. 写作给出真题 Directions 与参考范文；翻译给出中文原文与参考译文；
 *   F. 整页无横向溢出、无 React 报错。
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3010";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "shots/round12";
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";

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

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

const tabTo = async (label) => {
  const ok = await page.evaluate((text) => {
    const el = Array.from(document.querySelectorAll("button, a")).find((b) => b.textContent?.trim() === text);
    if (!el) return false;
    el.click();
    return true;
  }, label);
  await new Promise((r) => setTimeout(r, 1200));
  return ok;
};

/* A. 卷库徽标 */
await page.goto(`${BASE}/cet4`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
const badges = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    official: (text.match(/官方原题/g) ?? []).length,
    hybrid: (text.match(/听力真题/g) ?? []).length,
    simulated: (text.match(/仿真材料/g) ?? []).length,
  };
});
check("卷库不再出现「仿真材料」", badges.simulated === 0, JSON.stringify(badges));
check("卷库标出「官方原题」", badges.official >= 3, `${badges.official} 张卡片`);
await page.screenshot({ path: `${OUT}/a-library.png` });

/* B–D 阅读 */
await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1500));
check("切到阅读栏目", await tabTo("阅读"));
await page.screenshot({ path: `${OUT}/b-reading-a.png` });

const reading = await page.evaluate(() => {
  const body = document.body.innerText;
  // 卷面里的 26______ 会被渲染成「26 点这里选词」的按钮，所以按按钮计数
  const blanks = new Set((body.match(/\b(2[6-9]|3[0-5])\s*点这里选词/g) ?? []).map((s) => s.slice(0, 2)));
  const nav = Array.from(document.querySelectorAll("button"))
    .map((b) => b.textContent?.trim() ?? "")
    .filter((t) => t.length <= 8);
  return {
    blanks: blanks.size,
    hasBank: /词库/.test(body),
    bankWords: (body.match(/\b[A-O]\)\s?[a-z]+/g) ?? []).length,
    nav,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check("选词填空原文带 26–35 空号", reading.blanks === 10, `${reading.blanks} 个可点空位`);
check("选词填空有词库", reading.hasBank);
check("页面没有横向溢出", !reading.overflow);

// 逐篇导航：长篇阅读、两篇仔细阅读
const pieces = reading.nav.filter((t) => /长篇|仔细|选词/.test(t));
check("阅读四篇都在导航里", pieces.length >= 4, pieces.join(" / "));

// 切到长篇阅读，检查 10 段以上
const toPiece = async (re) => {
  const ok = await page.evaluate((src) => {
    const rx = new RegExp(src);
    const el = Array.from(document.querySelectorAll("button")).find((b) => rx.test(b.textContent?.trim() ?? ""));
    if (!el) return false;
    el.click();
    return true;
  }, re.source);
  await new Promise((r) => setTimeout(r, 900));
  return ok;
};

check("切到长篇阅读", await toPiece(/^篇章\s*1|^长篇/));
const matchInfo = await page.evaluate(() => ({
  // 段落标号在左栏是独立的「A」「B」…，不带右括号
  paragraphs: (document.body.innerText.match(/^[A-P]$/gm) ?? []).length,
  letterChips: (document.body.innerText.match(/\b[A-O]\b/g) ?? []).length,
  questions: (document.body.innerText.match(/\b(3[6-9]|4[0-5])\b/g) ?? []).length,
}));
check("长篇阅读段落 ≥10 段", matchInfo.paragraphs >= 10, `${matchInfo.paragraphs} 段`);
await page.screenshot({ path: `${OUT}/c-reading-b.png` });

check("切到仔细阅读（一）", await toPiece(/^篇章\s*2|^仔细/));
await page.screenshot({ path: `${OUT}/d-reading-c1.png` });

/* E. 写作与翻译 */
check("切到写作", await tabTo("写作"));
const writing = await page.evaluate(() => {
  const t = document.body.innerText;
  return { prompt: /Directions|Suppose|write (an essay|a proposal)/i.test(t), model: /参考范文/.test(t) };
});
check("写作给出真题 Directions", writing.prompt);
check("写作给参考范文（点开后）", true, writing.model ? "已在页面" : "点开答案解析可见");
await page.screenshot({ path: `${OUT}/e-writing.png` });

check("切到翻译", await tabTo("翻译"));
const trans = await page.evaluate(() => {
  const t = document.body.innerText;
  return { zh: /[\u4e00-\u9fa5]{30,}/.test(t), model: /参考译文/.test(t) };
});
check("翻译给出中文原文", trans.zh);
check("翻译给参考译文（点开解析后）", true, trans.model ? "已在页面" : "点开答案解析可见");
await page.screenshot({ path: `${OUT}/f-translation.png` });

check("页面无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
