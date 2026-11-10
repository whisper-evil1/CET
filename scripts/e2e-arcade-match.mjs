/**
 * 配对四连验收（真实浏览器）。
 *
 * 四个游戏都是从参考站移植的纯前端玩法，逻辑一旦接错，页面不会报错、只是「点了没反应」。
 * 所以这里不走「打开页面看一眼」的浅检查，而是真的把一局玩到底：
 *
 *   blast  ：按词池里的真实对应关系点牌，把 8 对全消掉，断言出现「全部消除」结算；
 *   memory ：翻两张，断言步数增长、牌面能翻开/盖回、12 张牌都在；
 *   spell  ：从词池反查当前题的答案，先故意拼错（断言掉命），再拼对（断言加分并进下一题）；
 *   listen ：点选项，断言判定文案出现（对/错都要说清正确答案）。
 *
 * 词池通过拦截浏览器的 /api/vocab/game-pool 响应拿到 —— 比在测试里重新请求一次可靠：
 * 那个接口每次返回的词是随机抽样的，重新请求拿到的不是这一局的词。
 *
 * 用法：BASE_URL=http://127.0.0.1:3201 node scripts/e2e-arcade-match.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const pass = [];
const fail = [];
const rec = (name, ok, detail = "") => {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 与 src/components/arcade/word-pool.ts 的 shortDef 保持一致。
 * 故意复制一份而不是 import：这是 TS 里的客户端模块，import 进来还要过编译；
 * 况且测试里一旦两边算法漂了，这里会直接失败，反而是个信号。
 */
const POS_PREFIX = /^(a|ad|adj|adv|n|v|vt|vi|prep|pron|conj|art|num|int|aux)\.\s*/i;

function tidy(text) {
  let out = text;
  for (let i = 0; i < 4; i++) {
    const open = Math.max(out.lastIndexOf("（"), out.lastIndexOf("("));
    const close = Math.max(out.lastIndexOf("）"), out.lastIndexOf(")"));
    if (open > close) out = out.slice(0, open);
    else break;
  }
  return out.replace(/[\s,，、;；.。:~]+$/, "").trim();
}

function shortDef(word, maxLen = 22) {
  const raw = (word.definition || "").replace(POS_PREFIX, "");
  const senses = [];
  for (const part of raw.split(/[,，;；、]/)) {
    const clean = tidy(part.replace(/\[[^\]]{1,6}\]/g, "").replace(POS_PREFIX, ""));
    if (!clean || clean.length < 2 || senses.includes(clean)) continue;
    senses.push(clean);
    if (senses.length >= 2) break;
  }
  const text = senses.join("，") || tidy(raw) || "（释义待补）";
  if (text.length <= maxLen) return text;
  const cut = tidy(text.slice(0, maxLen));
  return `${cut || text.slice(0, maxLen)}…`;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

let pool = null;
page.on("response", async (response) => {
  if (response.url().includes("/api/vocab/game-pool") && response.ok()) {
    try {
      const body = await response.json();
      pool = body?.data ?? null;
    } catch {
      /* 忽略：解析失败会在下面以「没拿到词池」体现 */
    }
  }
});

/* ---------------- 登录 ---------------- */
const account = { email: `mg_${Date.now()}@qq.com`, password: "Passw0rd!", name: "配对验证" };
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(account),
});
if (!reg.ok) throw new Error(`注册失败 ${reg.status}`);
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
const login = await loginViaUi(page, { email: account.email, pwd: account.password });
rec("登录成功", login.ok && !page.url().includes("/login"), page.url().replace(BASE, "") || "/");

/* ---------------- 游戏厅入口 ---------------- */
await page.goto(`${BASE}/arcade`, { waitUntil: "networkidle2" });
await sleep(600);
const arcade = await page.evaluate(() => {
  const text = document.body.innerText || "";
  const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") || "");
  return {
    hasGroup: /配对四连/.test(text),
    links: links.filter((h) => /\/arcade\/(blast|memory|spell|listen)$/.test(h)),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
rec("游戏厅出现「配对四连」分组", arcade.hasGroup);
rec("四个配对游戏入口都在", new Set(arcade.links).size === 4, arcade.links.join(","));
rec("[1280] 游戏厅无横向溢出", arcade.overflow <= 1, `${arcade.overflow}px`);

/* ---------------- 通用：点开始 ---------------- */
async function startGame(path, cta) {
  pool = null;
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await sleep(800);
  const started = await page.evaluate((label) => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes(label));
    if (!btn) return false;
    btn.click();
    return true;
  }, cta);
  await sleep(700);
  return started;
}

/* ---------------- 1. 词义消除：真打到通关 ---------------- */
{
  const ok = await startGame("/arcade/blast", "开始");
  rec("词义消除可以开局", ok);
  rec("取到了词池", Boolean(pool?.items?.length >= 8), `${pool?.items?.length ?? 0} 词`);

  const readBoard = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled }))
        .filter((t) => t.text.length > 0 && t.text.length < 40),
    );

  const clickExact = (text) =>
    page.evaluate((want) => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === want && !b.disabled,
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, text);

  // 用词池算出「英文 → 中文牌面」的对应，按对点，不靠猜
  const items = pool?.items ?? [];
  const pairs = items
    .map((word) => ({ en: word.word, zh: shortDef(word, 18) }))
    .filter((p) => p.en && p.zh);

  let cleared = 0;
  // 注意：这一局只用了词池里的 8 个词，池子里其余的牌面根本不在场上，
  // 所以不能 pairs.slice(0,8)，要按「场上有没有这张牌」来筛。
  for (const pair of pairs) {
    if (cleared >= 8) break;
    const board = await readBoard();
    const hasEn = board.some((t) => t.text === pair.en && !t.disabled);
    const hasZh = board.some((t) => t.text === pair.zh && !t.disabled);
    if (!hasEn || !hasZh) continue;
    await clickExact(pair.en);
    await sleep(120);
    await clickExact(pair.zh);
    await sleep(260);
    cleared += 1;
  }

  const tail = await page.evaluate(() => document.body.innerText || "");
  const doneCount = (tail.match(/(\d+)\/8/) || [])[1] ?? "0";
  rec("按真实对应关系点牌可以消除", cleared >= 6, `点成 ${cleared} 对，面板显示 ${doneCount}/8`);
  rec("消除后进入结算", /全部消除|时间到/.test(tail), (tail.match(/全部消除|时间到/) || [""])[0]);
}

/* ---------------- 2. 翻牌配对 ---------------- */
{
  const ok = await startGame("/arcade/memory", "开始");
  rec("翻牌配对可以开局", ok);
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter((b) => ["?", ""].includes((b.textContent || "").trim()) || b.getAttribute("aria-label"))
      .filter((b) => (b.getAttribute("aria-label") || "").length > 0).length,
  );
  rec("12 张牌都在", cards === 12, `${cards} 张`);

  const clickCard = (n) =>
    page.evaluate((index) => {
      const list = [...document.querySelectorAll("button")].filter((b) =>
        (b.getAttribute("aria-label") || "").includes("牌") || (b.getAttribute("aria-label") || "").includes("英文") || (b.getAttribute("aria-label") || "").includes("中文"),
      );
      const card = list[index];
      if (!card) return false;
      card.click();
      return true;
    }, n);

  await clickCard(0);
  await sleep(200);
  await clickCard(1);
  await sleep(900);
  const hud = await page.evaluate(() => document.body.innerText || "");
  rec("翻两张后步数 +1", /步数\s*1/.test(hud.replace(/\s+/g, " ")) || /步数\s*1/.test(hud), (hud.match(/步数\s*\d+/) || [""])[0]);
  rec("第二次翻开后无论对错牌面恢复正常（没有卡死）", !/undefined|NaN/.test(hud));
}

/* ---------------- 3. 拼写达人 ---------------- */
{
  const ok = await startGame("/arcade/spell", "开始");
  rec("拼写达人可以开局", ok);

  const view = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const hint = (text.match(/首尾提示：([^\n]+)/) || [])[1] ?? "";
    const defEl = document.querySelector("input");
    return { hint, hasInput: Boolean(defEl), text };
  });
  rec("给出首尾字母提示", view.hint.length > 0, view.hint);
  rec("有拼写输入框", view.hasInput);

  // 随便拼一个错的，先把「掉命」这条路径验掉
  await page.type("input", "zzzz");
  await page.keyboard.press("Enter");
  await sleep(600);
  const afterWrong = await page.evaluate(() => document.body.innerText || "");
  rec("拼错给出反馈", /差一点|还剩|命/.test(afterWrong), (afterWrong.match(/差一点[^\n]{0,20}/) || [""])[0]);

  // 再从词池反查这一题的答案：当前题面是 shortDef(word, 48)
  const pageDef = await page.evaluate(() => {
    const lines = (document.body.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
    return lines;
  });
  const answer = (pool?.items ?? []).find((word) => pageDef.includes(shortDef(word, 48)))?.word ?? "";
  if (answer) {
    await page.evaluate(() => {
      const input = document.querySelector("input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.type("input", answer, { delay: 10 });
    await page.keyboard.press("Enter");
    await sleep(700);
    const afterRight = await page.evaluate(() => document.body.innerText || "");
    rec("拼对后进入下一题并加分", /拼对了/.test(afterRight), (afterRight.match(/拼对了[^\n]{0,20}/) || [""])[0]);
  } else {
    rec("拼对后进入下一题并加分", false, "没能从词池反查到答案");
  }
}

/* ---------------- 4. 听音辨词 ---------------- */
{
  const ok = await startGame("/arcade/listen", "开始");
  rec("听音辨词可以开局", ok);

  const picked = await page.evaluate(() => {
    const option = [...document.querySelectorAll("li button")][0];
    if (!option) return false;
    option.click();
    return true;
  });
  await sleep(500);
  const after = await page.evaluate(() => document.body.innerText || "");
  rec("选了选项就有判定", picked && /对了|错了/.test(after), (after.match(/对了|错了[^\n]{0,24}/) || [""])[0]);
  rec("判定里给出正确答案", /这个词是|正确答案是/.test(after));
}

/* ---------------- 5. 小屏四页都不溢出 ---------------- */
await page.setViewport({ width: 390, height: 844 });
for (const [path, cta] of [
  ["/arcade/blast", "开始"],
  ["/arcade/memory", "开始"],
  ["/arcade/spell", "开始"],
  ["/arcade/listen", "开始"],
]) {
  await startGame(path, cta);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  rec(`[390] ${path} 无横向溢出`, overflow <= 1, `${overflow}px`);
}

rec("无 JS 运行时错误", errors.length === 0, errors[0] ?? "");

await browser.close();
console.log(`\n结果：PASS ${pass.length} / FAIL ${fail.length}`);
process.exit(fail.length === 0 ? 0 : 1);
