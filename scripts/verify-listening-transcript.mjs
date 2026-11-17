/**
 * 听力原文（可折叠）验收。
 *
 * 验的是四件事，缺一件这功能就不成立：
 *   1. **默认收起、首屏没有原文** —— 打开页面时浏览器里不该有这段文字，
 *      否则「收起来别让做题的人看见」只是视觉上的遮罩。
 *   2. **点开展开** —— 收起的默认值不能变成能力缺失。
 *   3. **点句子能回到音频那句** —— 核对答案时要找的是「哪句话给了他这个答案」，
 *      静态文本做不到这件事。
 *   4. **提示随交卷状态切换** —— 没交时说「先选完」，交了说「可以逐句核对」。
 *
 * 用独立测试账号跑，不动 demo 演示数据。
 */
import puppeteer from "puppeteer-core";

const BASE = (process.env.BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const PAPER = process.env.PAPER ?? "cet4-2025-12-s1";
/*
 * 注册接口只收白名单域名（lib/email-rules.ts 的 ALLOWED_EMAIL_DOMAINS），
 * 用 .local 会被 4000「只支持主流邮箱」挡掉 —— 上一版就是这么红的第一项。
 *
 * 每次跑用一个新邮箱：这个账号要走到「交本段」，固定邮箱第二次跑时本段已是
 * 已交状态，「未交本段提示」那一条就会假红。跑完在末尾把它清掉，不留垃圾。
 */
const TEST_EMAIL =
  process.env.TEST_EMAIL ?? `uitest.${Date.now().toString(36)}@163.com`;
const TEST_PWD = process.env.TEST_PWD ?? "test1234";
const SHOTS = process.env.SHOT_DIR ?? "shots/listening-transcript";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-http2"],
  defaultViewport: { width: 1440, height: 960 },
});

/* ---------- 1. 未登录：接口必须拒绝 ---------- */
const anon = await fetch(
  `${BASE}/api/papers/${PAPER}/transcript?passage=cet4-2025-12-s1-p-2-1`,
  { headers: { accept: "application/json" } },
).catch(() => null);
const anonBody = anon ? await anon.json().catch(() => null) : null;
check(
  "未登录拉原文被拒（401）",
  anon?.status === 401 && anonBody?.code === 4001,
  anon ? `HTTP ${anon.status} / code ${anonBody?.code ?? "?"}` : "请求失败",
);

/* ---------- 2. 准备测试账号（固定邮箱，已存在就复用） ---------- */
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PWD, name: "原文验收" }),
}).catch(() => null);
const regBody = reg ? await reg.json().catch(() => null) : null;
check(
  "测试账号就绪（新建或已存在）",
  Boolean(regBody) && (regBody.code === 0 || regBody.code === 4009),
  reg ? `HTTP ${reg.status} / code ${regBody?.code ?? "?"}` : "请求失败",
);

/* ---------- 3. 登录 ---------- */
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) =>
  errors.push(`${page.url().replace(BASE, "") || "/"} :: ${String(e.message).slice(0, 120)}`),
);

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("button[type=submit]:not([disabled])", { timeout: 60000 });
await sleep(600); // 登录页会用 localStorage 回填上次邮箱，等回填落地再改输入框
await page.$eval(
  "#login-email",
  (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  TEST_EMAIL,
);
await page.$eval(
  "#login-password",
  (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  },
  TEST_PWD,
);
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
  page.click("button[type=submit]"),
]);
for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await sleep(500);
check("测试账号登录成功", !page.url().includes("/login"), page.url().replace(BASE, "") || "/");

/* ---------- 4. 接口契约 ---------- */
const api = await page.evaluate(async (paper) => {
  const get = async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const okOne = await get(`/api/papers/${paper}/transcript?passage=${paper}-p-2-1`);
  const noParam = await get(`/api/papers/${paper}/transcript`);
  const crossPaper = await get(
    `/api/papers/${paper}/transcript?passage=cet4-2021-06-s1-p-2-1`,
  );
  const missing = await get(`/api/papers/${paper}/transcript?passage=no-such-passage`);
  return { okOne, noParam, crossPaper, missing };
}, PAPER);

const lines = api.okOne.body?.data?.lines ?? [];
check(
  "登录后能取到原文（逐句有时间轴）",
  api.okOne.body?.code === 0 && lines.length > 0 && typeof lines[0]?.start === "number",
  `${lines.length} 句 / 首句 ${JSON.stringify(lines[0]?.text ?? "").slice(0, 42)}…`,
);
check("缺 passage 参数 → 400", api.noParam.status === 400, `HTTP ${api.noParam.status}`);
check(
  "用别套卷的 passageId → 404（不会串卷）",
  api.crossPaper.status === 404,
  `HTTP ${api.crossPaper.status}`,
);
check("不存在的 passage → 404", api.missing.status === 404, `HTTP ${api.missing.status}`);

/* ---------- 5. 进练习页，切到听力 ---------- */
await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "domcontentloaded" });
/*
 * 没进到练习页（没登录 / 被重定向回登录页）时，别干等 60 秒再抛 TimeoutError ——
 * 那种「脚本崩了、前面的结论也没了」的输出，看起来像功能坏了，实际是脚本自己没走通。
 */
let paneReady = true;
try {
  await page.waitForSelector("nav button", { timeout: 60000 });
} catch {
  paneReady = false;
}
if (!paneReady) {
  const where = page.url().replace(BASE, "");
  check("能打开练习页", false, `停在 ${where || "/"}（多半是账号没登录成功）`);
  await page.screenshot({ path: `${SHOTS}/00-blocked.png` }).catch(() => {});
  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== 听力原文验收 ${pass}/${results.length}（流程中断） ====`);
  process.exit(1);
}

const clickByText = async (text) =>
  page.evaluate((t) => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === t,
    );
    if (btn instanceof HTMLElement) {
      btn.click();
      return true;
    }
    return false;
  }, text);

let listening = false;
for (let attempt = 0; attempt < 4 && !listening; attempt += 1) {
  await clickByText("听力");
  for (let k = 0; k < 25 && !listening; k += 1) {
    await sleep(600);
    listening = await page.evaluate(
      () => document.querySelectorAll('[role="radiogroup"]').length > 0,
    );
  }
}
check("切到听力板块", listening, listening ? "已切到" : "没切过去");

let firstText = "";
if (listening) {
  /* 6. 默认收起：DOM 里没有原文，也没有句子节点 */
  const collapsed = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="listening-transcript"]');
    return {
      exists: Boolean(box),
      open: box?.getAttribute("data-open"),
      lines: box?.getAttribute("data-lines"),
      label: (box?.querySelector("button")?.textContent ?? "").trim(),
      sentences: document.querySelectorAll("[data-sentence]").length,
    };
  });
  check(
    "播放器下方有「原文」折叠条，默认收起",
    collapsed.exists && collapsed.open === "0",
    `data-open=${collapsed.open} · ${collapsed.label.replace(/\s+/g, " ").slice(0, 40)}`,
  );
  check("收起时页面上没有句子节点", collapsed.sentences === 0, `${collapsed.sentences} 个`);
  check(
    "收起时还没发起原文请求（data-lines 仍为 0）",
    collapsed.lines === "0",
    `data-lines=${collapsed.lines}`,
  );

  /* 首屏 HTML 里确实没有原文：请求前的整页文本不该含接口给的首句 */
  firstText = String(lines[0]?.text ?? "").slice(0, 34);
  const htmlHasTranscript = await page.evaluate(
    (needle) => (needle.length > 20 ? document.documentElement.innerHTML.includes(needle) : false),
    firstText,
  );
  check("首屏 HTML 中没有原文正文", !htmlHasTranscript, htmlHasTranscript ? "疑似泄露" : "未发现");

  /* 7. 展开 */
  await page.click('[data-testid="listening-transcript"] button[aria-expanded]');
  let expanded = { open: "0", lines: "0", sentences: 0 };
  for (let k = 0; k < 40; k += 1) {
    await sleep(400);
    expanded = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="listening-transcript"]');
      return {
        open: box?.getAttribute("data-open") ?? "0",
        lines: box?.getAttribute("data-lines") ?? "0",
        sentences: document.querySelectorAll("[data-sentence]").length,
      };
    });
    if (expanded.sentences > 0) break;
  }
  check(
    "点一下展开，句子逐条出现",
    expanded.open === "1" && expanded.sentences > 0,
    `data-open=${expanded.open} · ${expanded.sentences} 句`,
  );
  check(
    "展开句数与接口一致",
    expanded.sentences === lines.length,
    `页面 ${expanded.sentences} / 接口 ${lines.length}`,
  );

  const tipBefore = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="listening-transcript"]');
    return (box?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160);
  });
  check(
    "未交本段时提示「先选完再展开」",
    /还没交/.test(tipBefore),
    tipBefore.slice(0, 48),
  );

  /* 中译开关：有逐句翻译的段落才有这颗按钮，开关要真的增减中文行 */
  const zhHas = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="listening-transcript"]');
    return [...(box?.querySelectorAll("button") ?? [])].some(
      (b) => (b.textContent ?? "").trim() === "中译",
    );
  });
  if (zhHas) {
    const toggleZh = async () => {
      await page.evaluate(() => {
        const box = document.querySelector('[data-testid="listening-transcript"]');
        const btn = [...(box?.querySelectorAll("button") ?? [])].find(
          (b) => (b.textContent ?? "").trim() === "中译",
        );
        if (btn instanceof HTMLElement) btn.click();
      });
      await sleep(400);
      return page.evaluate(
        () => document.querySelectorAll("[data-zh]").length,
      );
    };
    const zhOn = await toggleZh();
    await page.screenshot({ path: `${SHOTS}/02b-zh.png` });
    const zhOff = await toggleZh();
    check("「中译」开关能展开逐句中译", zhOn > 0, `${zhOn} 行中译`);
    check("再点一次能收起中译", zhOff === 0, `${zhOff} 行`);
  } else {
    check("「中译」开关（本段无逐句中译，跳过）", true, "该段没有 zh 数据");
  }

  await page.screenshot({ path: `${SHOTS}/02-expanded.png` });

  /* 8. 点句子 → 音频跳到那句 */
  const target = lines[Math.min(2, lines.length - 1)];
  const clicked = await page.evaluate((idx) => {
    const row = document.querySelector(`[data-sentence="${idx}"]`);
    if (row instanceof HTMLElement) {
      row.click();
      return true;
    }
    return false;
  }, target.id);

  let audioState = { time: -1, paused: true, ready: false };
  for (let k = 0; k < 30; k += 1) {
    await sleep(500);
    audioState = await page.evaluate(() => {
      const el = document.querySelector('audio[data-cet-audio="listening"]');
      return el
        ? { time: el.currentTime, paused: el.paused, ready: el.readyState >= 1 }
        : { time: -1, paused: true, ready: false };
    });
    if (clicked && !audioState.paused && Math.abs(audioState.time - target.start) < 1.6) break;
  }
  check(
    `点第 ${target.id} 句（${target.start.toFixed(1)}s）后音频跳到这里并播放`,
    clicked &&
      !audioState.paused &&
      Math.abs(audioState.time - target.start) < 1.6,
    `currentTime=${audioState.time.toFixed(2)}s · paused=${audioState.paused}`,
  );

  const highlight = await page.evaluate((idx) => {
    const row = document.querySelector(`[data-sentence="${idx}"]`);
    return row ? row.className.includes("accent-soft") : false;
  }, target.id);
  check("正在播的那一句高亮", highlight, highlight ? "已高亮" : "没高亮");

  await page.screenshot({ path: `${SHOTS}/03-jump.png` });

  /* 9. 收起 */
  await page.click('[data-testid="listening-transcript"] button[aria-expanded]');
  let afterClose = { open: "1", sentences: -1 };
  for (let k = 0; k < 20; k += 1) {
    await sleep(250);
    afterClose = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="listening-transcript"]');
      return {
        open: box?.getAttribute("data-open") ?? "1",
        sentences: document.querySelectorAll("[data-sentence]").length,
      };
    });
    if (afterClose.open === "0") break;
  }
  check(
    "能收回（句子节点消失，音频不受影响）",
    afterClose.open === "0" && afterClose.sentences === 0,
    `data-open=${afterClose.open} · ${afterClose.sentences} 个句子`,
  );
  const stillPlaying = await page.evaluate(() => {
    const el = document.querySelector('audio[data-cet-audio="listening"]');
    return el ? !el.paused : false;
  });
  check("收起原文不影响正在播的音频", stillPlaying, stillPlaying ? "仍在播" : "断了");

  /* 10. 交本段 → 提示文案切换 */
  const picked = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[role="radiogroup"]')];
    let n = 0;
    for (const g of groups) {
      const radio = g.querySelector('[role="radio"]:not([aria-disabled="true"])');
      if (radio instanceof HTMLElement) {
        radio.click();
        n += 1;
      }
    }
    return n;
  });
  await sleep(600);
  const submitted = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /交本段/.test(b.textContent ?? ""),
    );
    if (btn instanceof HTMLElement && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  });
  for (let k = 0; k < 30; k += 1) {
    await sleep(600);
    const graded = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => /重新交本段/.test(b.textContent ?? "")),
    );
    if (graded) break;
  }
  check("本段能交卷（用于切换提示）", picked > 0 && submitted, `选了 ${picked} 题`);

  await page.click('[data-testid="listening-transcript"] button[aria-expanded]');
  let tipAfter = "";
  let openAfter = "0";
  for (let k = 0; k < 30; k += 1) {
    await sleep(400);
    const s = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="listening-transcript"]');
      return {
        open: box?.getAttribute("data-open") ?? "0",
        text: (box?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160),
      };
    });
    openAfter = s.open;
    tipAfter = s.text;
    if (s.open === "1" && /已交/.test(s.text)) break;
  }
  check(
    "交完本段后提示改为「可以逐句核对」",
    openAfter === "1" && /本段已交/.test(tipAfter),
    tipAfter.replace(/\s+/g, " ").slice(0, 46),
  );

  await page.screenshot({ path: `${SHOTS}/04-graded.png` });

  /* 10.5 长段落：9 句的对话，展开后列表内部滚，别把播放器顶出屏幕 */
  await clickByText("对话 2");
  await sleep(2000); // 等段落切换后新折叠条挂上（换段会重置成收起、未请求）
  await page.evaluate(() => {
    const box = document.querySelector('[data-testid="listening-transcript"]');
    const btn = box?.querySelector("button[aria-expanded]");
    if (btn instanceof HTMLElement && btn.getAttribute("aria-expanded") === "false") btn.click();
  });

  let longList = { sentences: 0, lines: 0, scrollable: false, playerTop: -1 };
  for (let k = 0; k < 40; k += 1) {
    await sleep(400);
    longList = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="listening-transcript"]');
      const ol = box?.querySelector("ol");
      const player = document.querySelector('button[aria-label="播放"], button[aria-label="暂停"]');
      return {
        sentences: document.querySelectorAll("[data-sentence]").length,
        lines: Number(box?.getAttribute("data-lines") ?? "0"),
        scrollable: ol ? ol.scrollHeight > ol.clientHeight + 4 : false,
        playerTop: player ? Math.round(player.getBoundingClientRect().top) : -1,
      };
    });
    if (longList.sentences > 6) break;
  }
  /*
   * 期望值从展开后的 data-lines 取，不是展开前 —— 展开前还没请求，
   * 那个值恒为 0，拿它做等值判断必然不等（上一版就这么红了一次）。
   */
  check(
    "长段落展开后句数完整（9 句的对话）",
    longList.sentences >= 7 && longList.sentences === longList.lines,
    `${longList.sentences} 句 / data-lines=${longList.lines}`,
  );
  check(
    "长段落在列表内部滚动，播放器仍在首屏",
    longList.scrollable && longList.playerTop >= 0 && longList.playerTop < 400,
    `可滚动=${longList.scrollable} 播放键 top=${longList.playerTop}px`,
  );
  await page.screenshot({ path: `${SHOTS}/06-long.png` });

  /* 11. 手机端：左栏是「听力」tab，不是「文章」 */
  /*
   * setViewport 改 isMobile 时 Chrome 会**重载页面**（Puppeteer 的既定行为）。
   * 重载后练习页回到默认的阅读板块，tab 条第一颗就又变回「文章」——
   * 上一版就是在这里红的：看着像「标签没改」，其实读的是阅读板块的状态。
   * 真手机是「先用手机打开页面」，所以这里重设视口后重新进一次页面。
   */
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.goto(`${BASE}/practice/${PAPER}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("nav button", { timeout: 60000 });
  let mListening = false;
  for (let a = 0; a < 2 && !mListening; a += 1) {
    await clickByText("听力");
    for (let k = 0; k < 20 && !mListening; k += 1) {
      await sleep(500);
      mListening = await page.evaluate(
        () => document.querySelectorAll('[role="radiogroup"]').length > 0,
      );
    }
  }
  check("手机端能切到听力", mListening, mListening ? "已切到" : "没切过去");
  await sleep(600);
  /*
   * 只认顶栏那两个 tab 的文案，不去扫描全页有没有「文章」两字。
   *
   * 上一版断言写的是「全页不存在文本为『文章』的按钮」，红过一次：
   * 页面上任何一处（板块导航、说明里的按钮）出现同样的字都会把这条判死，
   * 而当时顶栏那两个 tab 其实已经是「听力 / 题目」了 —— 断言口径错，
   * 报出来的红就不是产品的问题。要验的是「左栏那颗 tab 叫什么」。
   */
  const mobile = await page.evaluate(() => {
    const bar = document.querySelector("header .md\\:hidden");
    const tabs = bar
      ? [...bar.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim())
      : [];
    const strays = [...document.querySelectorAll("button")]
      .filter((b) => (b.textContent ?? "").trim() === "文章")
      .map((b) => (b.parentElement?.className ?? "").slice(0, 50));
    return { tabs, strays };
  });
  check(
    "手机端左栏标签叫「听力」而不是「文章」",
    mobile.tabs[0] === "听力" && mobile.tabs[1] === "题目",
    `tab 条：${mobile.tabs.join("/") || "没找到"}${
      mobile.strays.length ? ` · 别处还有「文章」按钮：${mobile.strays[0]}` : ""
    }`,
  );

  const mobileOpened = await page.evaluate(() => {
    const bar = document.querySelector("header .md\\:hidden");
    const tab = bar
      ? [...bar.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "听力")
      : null;
    if (tab instanceof HTMLElement) tab.click();
    return true;
  });
  await sleep(900);
  const mobileBox = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="listening-transcript"]');
    if (!box) return { visible: false, x: 0 };
    const rect = box.getBoundingClientRect();
    return { visible: rect.width > 0 && rect.height > 0, x: Math.round(rect.x) };
  });
  check(
    "手机端切到「听力」后能看到原文折叠条",
    mobileOpened && mobileBox.visible && mobileBox.x >= 0,
    `visible=${mobileBox.visible} x=${mobileBox.x}`,
  );

  await page.screenshot({ path: `${SHOTS}/05-mobile.png` });
}

/* 首页那条既有的 #418 单列，别把旧账混进本次结论 */
const pageErrors = errors.filter((e) => !e.startsWith("/ ::"));
const homeErrors = errors.filter((e) => e.startsWith("/ ::"));
check("本次流程无 JS 报错", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "无");
if (homeErrors.length) console.log(`  （已知遗留：首页 #418 ×${homeErrors.length}，单独计）`);

await browser.close();

/*
 * 清理本次的测试账号（含历史遗留的固定测试邮箱）。
 * 只是打扫，不作为验收项：删不掉也不影响功能结论，只是库里多一条记录。
 */
try {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const emails = [TEST_EMAIL, "uitest.transcript@163.com", "uitest-transcript@cet.local"];
  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) continue;
    await prisma.answer.deleteMany({ where: { userId: user.id } });
    await prisma.favorite.deleteMany({ where: { userId: user.id } });
    await prisma.vocabWord.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } });
    console.log(`  （已清理测试账号 ${email}）`);
  }
  await prisma.$disconnect();
} catch (e) {
  console.log(`  （测试账号清理失败，不影响结论：${e instanceof Error ? e.message : e}）`);
}

const pass = results.filter((r) => r.pass).length;
console.log(`\n==== 听力原文验收 ${pass}/${results.length} ====`);
process.exit(pass === results.length ? 0 : 1);
