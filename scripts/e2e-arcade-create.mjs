/**
 * v2.3 学习台 / 闯关 / 创作平台 端到端验收。
 *
 * 覆盖：
 *   首页学习台（今日任务环、三步卡、创作卡、试卷区仍在）
 *   /arcade/vocab 背单词闯关（出题 → 选答 → 反馈 → 进度推进）
 *   /arcade/reading 阅读闯关（原文 → 选答 → 判题 → 下一题）
 *   /arcade/writing 写作批改（输入 → 批改流 → 参考范本）
 *   /create/novel 小说英译（示例 → 生成 → 对照 → 保存）
 *   /create/video 短视频出海（示例 → 生成 → 分镜/标签 → 校验项）
 *   /create 作品库（保存后可见）
 *   全站旧入口（/vocab、/mistakes、/practice）不回归
 *   390 / 768 / 1280 三档无横向溢出、无 JS 报错、无失败请求
 *
 * 用法：BASE_URL=http://127.0.0.1:3100 node scripts/e2e-arcade-create.mjs
 */
import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// 线上网关（workbuddy.host）要求每个同源请求都带 sharecode，漏带会返回 200 + 3KB 的 HTML 错误页，
// 于是接口断言会把「错误页」当成功。本地跑时空串，行为不变。
const SHARE = (process.env.SHARECODE || "").trim();
const u = (path) => `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

const pass = [];
const fail = [];
const rec = (name, ok, detail = "") => {
  (ok ? pass : fail).push(name);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const account = { email: `ar_${Date.now()}@qq.com`, pwd: "Passw0rd!" };
const DEMO = { email: "demo@cet.local", pwd: "demo1234" };
let usedDemo = false;

async function register() {
  const res = await fetch(u("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.pwd, name: "闯关测试" }),
  });
  if (res.ok) return true;
  /**
   * 429 = 注册接口按 IP 限流。同一台机器连跑 Chrome / Edge 两遍就会撞上，
   * 这跟应用功能无关（换个人注册就是好的），但会让整套功能验收在第一行就崩。
   * 所以撞限流就改用演示账号继续跑 —— 后面的断言验的是功能，不是「能不能注册」。
   */
  if (res.status === 429) {
    account.email = DEMO.email;
    account.pwd = DEMO.pwd;
    usedDemo = true;
    return true;
  }
  return false;
}

const jsErrors = [];
const badRequests = [];

async function newPage(browser, width, height, mobile) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  // 记上出错时所在的 URL —— 只记视口宽度的话，复现了也不知道是哪一页
  page.on("pageerror", (e) =>
    jsErrors.push(`[${width}] ${page.url().replace(BASE, "") || "/"} :: ${String(e).slice(0, 160)}`),
  );
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|React DevTools|Failed to load resource/i.test(t)) return;
    jsErrors.push(`[${width}] ${page.url().replace(BASE, "") || "/"} :: console: ${t.slice(0, 160)}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/favicon|_rsc=|ERR_ABORTED/i.test(u)) return;
    badRequests.push(`[${width}] ${u.replace(BASE, "")} ${r.failure()?.errorText ?? ""}`);
  });
  return page;
}

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** 点击文案精确或包含的按钮，再等条件成立 */
async function clickAndWait(page, label, predicate, timeout = 20_000) {
  const clicked = await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim());
    const exact = buttons.find((b) => (b.textContent || "").trim() === text);
    const fuzzy = exact
      ? null
      : buttons
          .filter((b) => (b.textContent || "").trim().includes(text))
          .sort((a, b) => a.textContent.trim().length - b.textContent.trim().length)[0];
    const target = exact || fuzzy;
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) return false;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ok = await page.evaluate(predicate).catch(() => false);
    if (ok) return true;
    await SLEEP(300);
  }
  return false;
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText || "");
}

/**
 * 点第一个选项。
 * 不能用「按文案找按钮」：选项按钮的 textContent 是「A</span><span>正文」拼起来的
 * "AThe decline…" 或 "Dadv. 也许, 大概"，字母后面不带分隔符，正则匹配字母会漏。
 * 直接取题目列表里第一个 li 的按钮，行为最确定。
 */
async function clickOption(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll("ul li button")];
    if (buttons.length === 0) return "";
    buttons[0].click();
    return (buttons[0].textContent || "").trim().slice(0, 30);
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
});

try {
  rec("本地服务可达", await register(), `${account.email}${usedDemo ? "（注册限流，改用演示账号）" : ""}`);

  /* ---------- 桌面：登录 + 首页学习台 ---------- */
  const page = await newPage(browser, 1280, 900, false);
  await page.goto(u("/login"), { waitUntil: "networkidle2" });
  await loginViaUi(page, account, { sleep: SLEEP });
  rec("登录成功", !page.url().includes("/login"), page.url().replace(BASE, "") || "/");

  await page.goto(u("/"), { waitUntil: "networkidle2" });
  const homeText = await bodyText(page);
  rec("首页 Hero 主张在", homeText.includes("用英语，讲好中国故事"));
  rec("今日任务卡片在", homeText.includes("今日任务"));
  rec("学习三步三个入口在", homeText.includes("趣味背单词") && homeText.includes("趣味阅读闯关") && homeText.includes("趣味写作 / 翻译"));
  rec("创作平台两个入口在", homeText.includes("小说英译改编") && homeText.includes("短视频出海"));
  rec("试卷区仍在（未砍旧功能）", homeText.includes("试卷库"));
  rec("首页有单词数据面板入口", homeText.includes("单词数据面板") || homeText.includes("数据面板"));
  const homeOverflow = await overflow(page);
  rec("[1280] 首页无横向溢出", homeOverflow <= 1, `${homeOverflow}px`);

  /* ---------- 闯关总览（v2.5 改版：白卡 + 插画 + 进度可视化） ---------- */
  await page.goto(u("/arcade"), { waitUntil: "networkidle2" });
  const arcadeText = await bodyText(page);
  rec(
    "闯关总览三关入口都在",
    ["趣味背单词", "趣味阅读闯关", "趣味写作 / 翻译"].every((t) => arcadeText.includes(t)),
  );
  rec(
    "闯关总览有数据可视化块（环 + 3 个 KPI）",
    arcadeText.includes("我的词汇量") &&
      ["词库总量", "连续打卡", "今日待复习"].every((t) => arcadeText.includes(t)),
  );
  rec("闯关总览有今日进度", arcadeText.includes("今日进度"));

  /**
   * 里程碑必须真的画出 5 个关卡点。
   * 只断言「页面上有『掌握度里程碑』五个字」是不够的 —— 图没画出来时标题照样在。
   * SVG 版靠 aria-label 定位，再从里面数标签文字；小屏的 HTML 版同理数 <li>。
   */
  const milestone = await page.evaluate(() => {
    const svg = [...document.querySelectorAll("main svg")].find((s) =>
      (s.getAttribute("aria-label") || "").includes("里程碑"),
    );
    if (svg) {
      const labels = [...svg.querySelectorAll("text")].filter((t) =>
        /^(起步|入门|上手|熟练|通关)$/.test((t.textContent || "").trim()),
      ).length;
      return { mode: "svg", labels, a11y: svg.getAttribute("aria-label") || "" };
    }
    const ol = document.querySelector("main ol[aria-label*='里程碑']");
    if (ol) {
      return { mode: "html", labels: ol.querySelectorAll("li").length, a11y: ol.getAttribute("aria-label") || "" };
    }
    return null;
  });
  rec(
    "里程碑画出了 5 个关卡点",
    Boolean(milestone && milestone.labels === 5),
    milestone ? `${milestone.mode} · ${milestone.labels} 点 · ${milestone.a11y}` : "未找到",
  );
  const arcadeOverflow = await overflow(page);
  rec("[1280] 闯关总览无横向溢出", arcadeOverflow <= 1, `${arcadeOverflow}px`);

  /* ---------- 备料：导入 40 个四六级词 ---------- */
  const importResult = await page.evaluate(async () => {
    const res = await fetch("/api/vocab/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordbookId: "cet4-core", count: 40 }),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, data: json?.data ?? null };
  });
  rec(
    "词书导入 40 词（闯关备料）",
    importResult.status === 200,
    `added=${importResult.data?.added ?? "?"}`,
  );

  /* ---------- 背单词闯关 ---------- */
  await page.goto(u("/arcade/vocab"), { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => (document.body.innerText || "").includes("选出正确释义"),
    { timeout: 25_000 },
  );
  const vocabText = await bodyText(page);
  rec("闯关出了题（有单词与四个选项）", vocabText.includes("选出正确释义"));
  const optionCount = await page.evaluate(() => document.querySelectorAll("ul li button").length);
  rec("四个选项齐全", optionCount >= 4, `${optionCount} 个`);

  /**
   * 反馈文案只认带间隔点的三态：`对了 ·` / `错了 ·` / `超时 ·`。
   * 不能用裸的「对了|错了|超时」——页头常驻一句「答错或超时 → 10 分钟后再来一遍」，
   * 那样连答题之前都能判成「已反馈」，是假通过。
   */
  const FEEDBACK = /对了 ·|错了 ·|超时 ·/;
  await clickOption(page);
  let graded = false;
  for (let i = 0; i < 40; i++) {
    await SLEEP(300);
    if (FEEDBACK.test(await bodyText(page))) {
      graded = true;
      break;
    }
  }
  rec("选答后立刻给反馈（写回调度）", graded);
  rec("答题前页面上没有反馈文案", !FEEDBACK.test(vocabText));
  const afterFirst = await bodyText(page);
  rec("反馈文案具体（对/错/超时三态之一）", FEEDBACK.test(afterFirst));

  /* 取出当前题干那个大字单词：HUD 改版后不再有「1 / 10」文字，只能认内容 */
  const headword = () =>
    page.evaluate(() => {
      const all = [...document.querySelectorAll("p")];
      const i = all.findIndex((p) => (p.textContent || "").trim() === "选出正确释义");
      return i < 0 ? "" : (all[i + 1]?.textContent || "").trim();
    });
  const enabledOptions = () =>
    page.evaluate(
      () => [...document.querySelectorAll("ul li button")].filter((b) => !b.disabled).length,
    );
  const firstWord = await headword();
  rec("当前题面能取到单词", Boolean(firstWord), firstWord);
  /**
   * 题面与干扰项必须是真词。
   * 之前演示账号混进过 `zzzzipitrddjka`（释义「测试词一」），整屏题面和干扰项都是测试词 ——
   * 只看「有没有出题」是抓不到的，必须校验词形与释义文案。
   */
  const junkOptions = await page.evaluate(() =>
    [...document.querySelectorAll("ul li button")]
      .map((b) => (b.textContent || "").trim())
      .filter((t) => /测试词|占位|待补|TODO/i.test(t)),
  );
  rec("干扰项里没有测试词", junkOptions.length === 0, junkOptions.join(" / ") || "无");
  rec(
    "题面是真词（不是乱码/测试词）",
    /^[a-z][a-z'’\- ]*$/i.test(firstWord) &&
      !/([a-z])\1{2,}/i.test(firstWord) &&
      !/测试词|占位|待补/i.test(afterFirst),
    firstWord,
  );

  // 自动推进的判据：换了词 + 上一题反馈消失 + 选项重新可点（三件事同时成立才算推进）
  let advanced = false;
  let lastSeen = firstWord;
  for (let i = 0; i < 40; i++) {
    await SLEEP(300);
    const word = await headword();
    if (word) lastSeen = word;
    const fresh = word && word !== firstWord;
    const noFeedback = !FEEDBACK.test(await bodyText(page));
    const enabled = await enabledOptions();
    if (fresh && noFeedback && enabled >= 4) {
      advanced = true;
      break;
    }
  }
  rec("答完自动推进到第 2 题", advanced, advanced ? `下一词 ${lastSeen}` : `仍停在 ${lastSeen}`);

  const vocabOverflow = await overflow(page);
  rec("[1280] 闯关页无横向溢出", vocabOverflow <= 1, `${vocabOverflow}px`);

  /* ---------- 阅读闯关 ---------- */
  await page.goto(u("/arcade/reading"), { waitUntil: "networkidle2" });
  await page.waitForFunction(() => /第 \d+ 题/.test(document.body.innerText || ""), {
    timeout: 30_000,
  });
  const readingText = await bodyText(page);
  rec("阅读闯关出了题（题号 + 选项）", /第 \d+ 题/.test(readingText));

  /**
   * 阅读题必须能看到原文才能作答。
   * 之前只按「有没有选项」抽题，把 Section II 听力（短篇新闻）的题也抽了进来 ——
   * 听力题没有书面原文，于是出现「问 news report 主旨、页面上一个字都没有」的死题。
   */
  const passageLen = () =>
    page.evaluate(() => {
      const el = document.querySelector("main .scroll-pane");
      return el ? (el.innerText || "").trim().length : 0;
    });
  const pasLen1 = await passageLen();
  rec("阅读题带原文（文章区有内容）", pasLen1 > 100, `${pasLen1} 字`);

  await clickOption(page);
  let answered = false;
  for (let i = 0; i < 60; i++) {
    await SLEEP(300);
    if (/答对了|答错了/.test(await bodyText(page))) {
      answered = true;
      break;
    }
  }
  rec("阅读选答后判题并给解析", answered);
  /* 下一题的判据：题干换了 + 上一题的判题反馈消失（点完还停在原地不算过） */
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((el) =>
      /^第 \d+ 题/.test((el.textContent || "").trim()),
    );
    window.__stemBefore = p ? (p.textContent || "").trim() : "";
  });
  const nextOk = await clickAndWait(
    page,
    "下一题",
    () => {
      const p = [...document.querySelectorAll("p")].find((el) =>
        /^第 \d+ 题/.test((el.textContent || "").trim()),
      );
      const now = p ? (p.textContent || "").trim() : "";
      const before = window.__stemBefore || "";
      return Boolean(now) && now !== before && !/答对了|答错了/.test(document.body.innerText || "");
    },
    15_000,
  );
  const stemNow = await page.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((el) =>
      /^第 \d+ 题/.test((el.textContent || "").trim()),
    );
    return p ? (p.textContent || "").trim().slice(0, 24) : "";
  });
  rec("阅读可进入下一题", nextOk, stemNow);
  const pasLen2 = await passageLen();
  rec("下一题仍然带原文", pasLen2 > 100, `${pasLen2} 字`);

  /* ---------- 写作批改 ---------- */
  await page.goto(u("/arcade/writing"), { waitUntil: "networkidle2" });
  await page.waitForFunction(
    () => document.querySelector("textarea") !== null,
    { timeout: 30_000 },
  );
  await page.focus("textarea");
  await page.type(
    "textarea",
    "With the rapid development of technology, more and more people choose to study online. On the one hand, it saves time; on the other hand, it requires self-discipline.",
    { delay: 2 },
  );
  const gradedWriting = await clickAndWait(
    page,
    "让 AI 批改",
    () => {
      const el = [...document.querySelectorAll("div")].find((d) =>
        (d.className || "").toString().includes("prose-tight"),
      );
      return Boolean(el && (el.textContent || "").trim().length > 40);
    },
    120_000,
  );
  rec("写作提交后有批改正文", gradedWriting);

  const refShown = await clickAndWait(
    page,
    "先看参考",
    () => (document.body.innerText || "").includes("参考译本") || (document.body.innerText || "").includes("参考"),
    8_000,
  );
  rec("参考范本可展开", refShown);

  /* ---------- 小说英译 ---------- */
  await page.goto(u("/create/novel"), { waitUntil: "networkidle2" });
  const sampleFilled = await clickAndWait(
    page,
    "填入示例",
    () => {
      const el = document.querySelector("textarea");
      return Boolean(el && el.value.length > 50);
    },
    8_000,
  );
  rec("示例文本可一键填入", sampleFilled);

  const novelDone = await clickAndWait(
    page,
    "生成英文改编",
    // 「English」这个标签带 text-transform: uppercase，innerText 会变成 ENGLISH，
    // 所以必须大小写不敏感，否则明明出结果了却判失败。
    () => /english/i.test(document.body.innerText || ""),
    180_000,
  );
  rec("小说改编生成完成（出段级对照）", novelDone);
  const novelText = await bodyText(page);
  // 记下实际走的是哪条通道：线上有云凭证时应为「云模型」，本地无 Key 时是「离线骨架」。
  // 只断言「有标注」而不记录标注内容，等于没验证降级链路。
  const modeLabel = (novelText.match(/云模型|服务端模型|离线骨架/) || ["(无标注)"])[0];
  rec("改编稿标注了生成通道", modeLabel !== "(无标注)", modeLabel);
  rec("改编稿带专名表或改编说明", novelText.includes("专名表") || novelText.includes("改编说明"));

  const savedNovel = await clickAndWait(
    page,
    "保存",
    () => (document.body.innerText || "").includes("已保存到作品库"),
    20_000,
  );
  rec("小说作品可保存", savedNovel);

  const novelOverflow = await overflow(page);
  rec("[1280] 小说工作台无横向溢出", novelOverflow <= 1, `${novelOverflow}px`);

  /* ---------- 短视频出海 ---------- */
  await page.goto(u("/create/video"), { waitUntil: "networkidle2" });
  await clickAndWait(
    page,
    "填入示例",
    () => {
      const el = document.querySelector("textarea");
      return Boolean(el && el.value.length > 50);
    },
    8_000,
  );
  const videoDone = await clickAndWait(
    page,
    "生成",
    // 页面导语里也有「秒级分镜」，用它会立刻判真、后面的断言全部提前跑。
    // 只等结果区独有的「开场钩子」。
    () => (document.body.innerText || "").includes("开场钩子"),
    180_000,
  );
  rec("短视频发布包生成完成（有分镜）", videoDone);
  const videoText = await bodyText(page);
  rec("发布包含标题字符数与钩子", /标题 \d+\/60/.test(videoText) && videoText.includes("开场钩子"));
  rec("发布包含话题标签与封面文案", videoText.includes("话题标签") && videoText.includes("封面文案"));

  const savedVideo = await clickAndWait(
    page,
    "保存",
    () => (document.body.innerText || "").includes("已保存到作品库"),
    20_000,
  );
  rec("短视频作品可保存", savedVideo);

  /* ---------- 作品库 ---------- */
  await page.goto(u("/create"), { waitUntil: "networkidle2" });
  const openCount = await page.evaluate(
    () => [...document.querySelectorAll("a")].filter((a) => (a.textContent || "").trim() === "打开").length,
  );
  // 不能只看页面上的「小说英译改编 / 短视频出海」两个入口卡——那两个一直在。
  // 要看作品列表里真的多了两条带「打开」的记录。
  rec("作品库列出刚保存的两件作品", openCount >= 2, `${openCount} 条`);

  /* ---------- 单词数据面板 ---------- */
  await page.goto(u("/vocab"), { waitUntil: "networkidle2" });
  const vocabPageText = await bodyText(page);
  rec("生词本顶部有学习数据入口", vocabPageText.includes("学习数据"));

  await page.goto(u("/vocab/stats"), { waitUntil: "networkidle2" });
  await SLEEP(600);
  const statsText = await bodyText(page);
  rec("数据面板能打开", statsText.includes("单词学习数据"), page.url().replace(BASE, ""));
  rec("掌握度分布卡在", statsText.includes("掌握度分布"));
  rec("复习趋势卡在", statsText.includes("近 14 天复习量"));
  rec("记忆保持曲线卡在", statsText.includes("记忆保持曲线"));
  rec("到期预测卡在", statsText.includes("未来 7 天到期预测"));
  rec("词频覆盖卡在", statsText.includes("词频与考纲覆盖"));
  /**
   * 图形是否真的画出来 —— 不能靠「数 <svg> 有几个」：
   * 这一版只有掌握度环是 SVG，四张柱图都是 div（不引图表库，见 analytics-charts.tsx）。
   * 所以分两种图形各自验：环看有没有 dasharray 扇段 + 中心百分比，
   * 柱看有没有真的像素高度（上一版就是 height:100% 在 auto 父级里塌成 0，图在柱没了）。
   */
  const charts = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const svg = main.querySelector("svg");
    const arcs = svg ? svg.querySelectorAll("circle[stroke-dasharray]").length : 0;
    const pct =
      [...main.querySelectorAll("span")]
        .map((s) => (s.textContent || "").trim())
        .find((t) => /^\d+%$/.test(t)) || "";
    const heights = [...main.querySelectorAll("div[style*='height']")]
      .map((d) => parseInt(d.style.height, 10))
      .filter((n) => Number.isFinite(n));
    return {
      arcs,
      pct,
      bars: heights.length,
      tallBars: heights.filter((n) => n > 2).length,
      retentionRows: [...main.querySelectorAll("ul li")].filter((li) =>
        /\d+%|—/.test((li.textContent || "").trim()),
      ).length,
    };
  });
  rec(
    "掌握度环形画出了扇段（dasharray）",
    Boolean(charts && charts.arcs >= 1),
    `${charts?.arcs ?? 0} 段`,
  );
  rec("环形中心有百分比文字", Boolean(charts && charts.pct), charts?.pct ?? "无");
  rec(
    "柱状图有真实像素高度（没塌成 0）",
    Boolean(charts && charts.tallBars >= 3),
    `${charts?.tallBars ?? 0}/${charts?.bars ?? 0} 根有高度`,
  );
  rec("记忆保持五档都渲染了", Boolean(charts && charts.retentionRows >= 5), `${charts?.retentionRows ?? 0} 行`);
  const statsOver = await overflow(page);
  rec("[1280] 数据面板无横向溢出", statsOver <= 1, `${statsOver}px`);

  /* ---------- 旧功能不回归 ---------- */
  for (const [path, expect] of [
    ["/vocab", "生词本"],
    ["/mistakes", "错题"],
    ["/favorites", "收藏"],
    ["/leaderboard", "排行"],
    ["/profile", "我的"],
  ]) {
    await page.goto(u(path), { waitUntil: "networkidle2" });
    const text = await bodyText(page);
    const over = await overflow(page);
    rec(`${path} 仍可用且不溢出`, text.includes(expect) && over <= 1, `${over}px`);
  }

  await page.close();

  /* ---------- 手机 / 平板 ---------- */
  for (const vp of [
    { w: 390, h: 844, mobile: true, name: "手机 390" },
    { w: 768, h: 1024, mobile: false, name: "平板 768" },
  ]) {
    const p = await newPage(browser, vp.w, vp.h, vp.mobile);
    await p.goto(u("/login"), { waitUntil: "networkidle2" });
    await loginViaUi(p, account, { sleep: SLEEP });
    for (const path of ["/", "/arcade", "/arcade/vocab", "/arcade/reading", "/arcade/writing", "/vocab/stats", "/create", "/create/novel", "/create/video"]) {
      await p.goto(u(path), { waitUntil: "networkidle2" });
      await SLEEP(400);
      const over = await overflow(p);
      rec(`[${vp.name}] ${path} 无横向溢出`, over <= 1, `${over}px`);
    }
    await p.close();
  }

  const meaningful = jsErrors.filter((e) => !/ResizeObserver|Script error/i.test(e));
  rec("全程无 JS 运行时错误", meaningful.length === 0, meaningful.slice(0, 3).join(" | "));
  rec("全程无失败请求", badRequests.length === 0, badRequests.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(`\n结果：${pass.length} 通过 / ${fail.length} 失败`);
if (fail.length > 0) console.log(`失败项：\n${fail.map((n) => `  - ${n}`).join("\n")}`);
process.exit(fail.length === 0 ? 0 : 1);
