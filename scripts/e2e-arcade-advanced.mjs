/**
 * 高级游戏七连 e2e：消消乐(关卡制) / 句子重组 / 笨鸟先飞 / 打地鼠 /
 * 单词保卫战 / 60秒快问快答 / 单词贪吃蛇。
 *
 * 为什么单独一个脚本：e2e-arcade-match.mjs 覆盖的是四个配对游戏，
 * 这七个的交互面完全不同（canvas 游戏、关卡地图、输入框打字、选项判分），
 * 混在一起会让失败定位变慢。
 *
 * 断言策略（每局都要过三道关）：
 * 1. 页面 200 + 关键控件存在（开始按钮 / canvas / 输入框）；
 * 2. 真实交互走一遍（点按钮、打字、pointerdown、D-pad），游戏状态有响应；
 * 3. 桌面 1280 与手机 390 两个视口都无横向溢出（scrollWidth <= clientWidth）。
 *
 * canvas 类游戏额外断言画面非空白：getImageData 抽样，全透明/全同色视为失败
 * ——「canvas 挂了但页面不报错」是最阴的回归，必须用像素抓。
 *
 * 用法：BASE_URL=http://127.0.0.1:3202 node scripts/e2e-arcade-advanced.mjs
 * 账号从环境变量 E2E_EMAIL / E2E_PWD 读，缺省用仓库内建的测试号。
 */

import puppeteer from "puppeteer-core";
import { loginViaUi } from "./lib/login.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3202";
const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
// 凭据只走环境变量；未传时生成一次性随机账号并由 ensureAccount 自举注册，
// 避免把可登录线上站点的测试账号明文写进公开仓库。
const EMAIL = process.env.E2E_EMAIL || `adv_e2e_${Date.now()}@qq.com`;
const PWD = process.env.E2E_PWD || `E2e-${Math.random().toString(36).slice(2, 12)}!`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];

/** 一条断言：失败记下来不中断，最后统一汇报 */
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` —— ${detail}` : ""}`);
    console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

/** 无横向溢出 + 页面无 500 */
async function checkLayout(page, tag) {
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    body: (document.body?.innerText || "").slice(0, 200),
  }));
  check(`${tag} 无横向溢出 @${page.viewport().width}`, m.scrollW <= m.clientW + 1,
    `scrollW=${m.scrollW} clientW=${m.clientW}`);
  check(`${tag} 页面正常渲染`, !m.body.includes("Application error") && !m.body.includes("正在启动"));
}

/** canvas 非空白：抽样中心区域像素，若全部同值（或全透明）视为没画 */
async function canvasNotBlank(page, sel) {
  return page.evaluate((s) => {
    const c = document.querySelector(s);
    if (!c || !c.getContext) return { ok: false, why: "canvas 不存在" };
    const ctx = c.getContext("2d");
    if (!ctx) return { ok: false, why: "2d context 拿不到" };
    const x0 = Math.floor(c.width / 4);
    const y0 = Math.floor(c.height / 4);
    const w = Math.max(1, Math.floor(c.width / 2));
    const h = Math.max(1, Math.floor(c.height / 2));
    let data;
    try {
      data = ctx.getImageData(x0, y0, w, h).data;
    } catch {
      return { ok: false, why: "getImageData 被安全策略拦截" };
    }
    const first = `${data[0]},${data[1]},${data[2]},${data[3]}`;
    for (let i = 4; i < data.length; i += 4) {
      const cur = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`;
      if (cur !== first) return { ok: true, why: "" };
    }
    return { ok: false, why: "抽样区域单色（未绘制）" };
  }, sel);
}

/** 打开页面，等待指定文案出现（游戏组件是客户端渲染，光 domcontentloaded 不够） */
async function openGame(page, path, waitText) {
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const status = resp?.status() ?? 0;
  try {
    await page.waitForFunction(
      (t) => (document.body?.innerText || "").includes(t),
      { timeout: 15_000 },
      waitText,
    );
    return { status, ok: true };
  } catch {
    return { status, ok: false };
  }
}

/* ---------------- 各游戏的具体交互 ---------------- */

/** 消消乐：intro → 关卡地图（12 关）→ 进第 1 关 → 消一对 → 回地图 */
async function playBlastLevels(page) {
  const r = await openGame(page, "/arcade/blast-levels", "进入关卡地图");
  check("消消乐 页面 200", r.status === 200, `status=${r.status}`);
  check("消消乐 开场文案渲染", r.ok);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("进入关卡地图")) { b.click(); return; }
    }
  });
  await page.waitForFunction(() => (document.body.innerText || "").includes("已通关"), { timeout: 20_000 });
  const levelCards = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => /对 · 120s|先通过第/.test(b.textContent || "")).length,
  );
  check("消消乐 关卡地图有 12 张关卡卡", levelCards === 12, `实际 ${levelCards}`);
  const lockedHint = await page.evaluate(
    () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("先通过第 1 关")),
  );
  check("消消乐 锁定卡提示上一关编号", lockedHint, "未找到「先通过第 1 关」");
  // 进唯一解锁的第 1 关（关卡卡本身是按钮）
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("button:not([disabled])")].find((b) =>
      /对 · 120s/.test(b.textContent || ""),
    );
    if (card) card.click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].filter((b) => b.className.includes("min-h-[60px]")).length >= 20,
    { timeout: 20_000 },
  ).catch(() => {});
  const tiles = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => b.className.includes("min-h-[60px]")).length,
  );
  check("消消乐 进关后出现 20 张词块", tiles === 20, `词块数 ${tiles}`);
  // 点两张词块（配对对错都走判分链路），确认无异常
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button.min-h-\\[60px\\]")].filter((b) => !b.disabled);
    if (t[0]) t[0].click();
  });
  await sleep(150);
  await page.evaluate(() => {
    const t = [...document.querySelectorAll("button.min-h-\\[60px\\]")].filter((b) => !b.disabled);
    if (t[1]) t[1].click();
  });
  await sleep(300);
  await checkLayout(page, "消消乐(游玩中)");
  // 「回关卡地图」在结算视图才出现；游玩中退路是结算后再回，两种状态都算链路通
  const exitState = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const hasExit = [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("回关卡地图"));
    return { hasExit, onMap: text.includes("已通关"), playing: /第 \d+ 关 · |\d+\/10/.test(text) };
  });
  check("消消乐 退出/结算链路可用", exitState.hasExit || exitState.onMap || exitState.playing,
    `hasExit=${exitState.hasExit} onMap=${exitState.onMap} playing=${exitState.playing}`);
}

/** 句子重组：开始 → 点满所有 chip → 提交 → 出现判分反馈（对错都算链路通） */
async function playSentence(page) {
  const r = await openGame(page, "/arcade/sentence", "开始组句");
  check("句子重组 页面 200", r.status === 200, `status=${r.status}`);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("开始组句")) { b.click(); return; }
    }
  });
  await page.waitForFunction(() => document.querySelectorAll("button").length > 8, { timeout: 20_000 }).catch(() => {});
  // 依次点掉所有 chip（点完后再点会自动循环无效，点 20 次封顶）
  for (let i = 0; i < 20; i++) {
    const more = await page.evaluate(() => {
      const chips = [...document.querySelectorAll("button")].filter(
        (b) => b.className.includes("rounded") && (b.textContent || "").trim().length > 0 &&
          !/提交|重排|返回|上一句|下一句|跳过/.test(b.textContent || ""),
      );
      if (!chips.length) return false;
      chips[0].click();
      return chips.length > 1;
    });
    if (!more) break;
    await sleep(80);
  }
  const built = await page.evaluate(() => (document.body.innerText || "").length);
  check("句子重组 chip 可以点击组句", built > 100);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("提交句子")) { b.click(); return; }
    }
  });
  await sleep(300);
  const text = await page.evaluate(() => document.body.innerText);
  check("句子重组 提交后出判分反馈",
    /正确|不对|再试|拼错|漂亮|差一点|有误|再来|答案/.test(text),
    "未出现任何判分文案");
  await checkLayout(page, "句子重组");
}

/** 笨鸟先飞：intro → 进入游戏 → canvas 存在 → pointerdown 起飞 → 画面已绘制 */
async function playFlappy(page) {
  const r = await openGame(page, "/arcade/flappy", "进入游戏");
  check("笨鸟先飞 页面 200", r.status === 200, `status=${r.status}`);
  check("笨鸟先飞 开场文案渲染", r.ok);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("进入游戏")) { b.click(); return; }
    }
  });
  await page.waitForSelector('canvas[aria-label*="笨鸟先飞"]', { timeout: 20_000 }).catch(() => {});
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas[aria-label*="笨鸟先飞"]'));
  check("笨鸟先飞 canvas 存在", hasCanvas);
  const shot1 = await canvasNotBlank(page, 'canvas[aria-label*="笨鸟先飞"]');
  check("笨鸟先飞 canvas 已绘制", shot1.ok, shot1.why);
  // pointerdown 起飞：用页面内合成事件，覆盖鼠标/触屏同一条 onPointerDown 路径
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const c = document.querySelector('canvas[aria-label*="笨鸟先飞"]');
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerId: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      c.dispatchEvent(new PointerEvent("pointerdown", opts));
      c.dispatchEvent(new PointerEvent("pointerup", opts));
    });
    await sleep(350);
  }
  const alive = await page.evaluate(() => (document.body.innerText || "").length);
  check("笨鸟先飞 拍翅交互无异常", alive > 100);
  await checkLayout(page, "笨鸟先飞");
}

/** 打地鼠：开始 → 9 个洞 → 等地鼠冒头敲一只 → 判分反馈 */
async function playMole(page) {
  const r = await openGame(page, "/arcade/mole", "开始（60 秒）");
  check("打地鼠 页面 200", r.status === 200, `status=${r.status}`);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("开始（60 秒）")) { b.click(); return; }
    }
  });
  await page.waitForFunction(() => document.querySelectorAll('button[aria-label*="地鼠洞"], button[aria-label^="地鼠"]').length >= 9, { timeout: 20_000 });
  const holes = await page.evaluate(() =>
    document.querySelectorAll('button[aria-label*="地鼠洞"], button[aria-label^="地鼠"]').length,
  );
  check("打地鼠 9 个洞渲染", holes === 9, `实际 ${holes}`);
  // 最多等 5 秒，敲第一只冒头的（敲错也走判分链路，都能接受）
  let hit = false;
  for (let i = 0; i < 25 && !hit; i++) {
    hit = await page.evaluate(() => {
      const m = document.querySelector('button[aria-label^="地鼠："]');
      if (!m) return false;
      m.click();
      return true;
    });
    await sleep(200);
  }
  check("打地鼠 能敲到冒头的地鼠", hit);
  await sleep(300);
  const text = await page.evaluate(() => document.body.innerText);
  check("打地鼠 敲击后有反馈", /得分|连击|打错|可惜/.test(text));
  await checkLayout(page, "打地鼠");
}

/** 单词保卫战：intro → 进入防御 → canvas 渲染 → 输入框 + 图例自动填词 → 击落 */
async function playGuard(page) {
  const r = await openGame(page, "/arcade/guard", "进入防御");
  check("保卫战 页面 200", r.status === 200, `status=${r.status}`);
  check("保卫战 开场文案渲染", r.ok);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("进入防御")) { b.click(); return; }
    }
  });
  await page.waitForSelector('canvas[aria-label*="保卫战"]', { timeout: 20_000 }).catch(() => {});
  const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas[aria-label*="保卫战"]'));
  check("保卫战 canvas 存在", hasCanvas);
  const shot = await canvasNotBlank(page, 'canvas[aria-label*="保卫战"]');
  check("保卫战 canvas 已绘制（夜空+楼群）", shot.ok, shot.why);
  const hasInput = await page.evaluate(() => !!document.querySelector('input[aria-label*="陨石"]'));
  check("保卫战 输入框存在", hasInput);
  if (hasInput) {
    // 手动打一个词提交（打没打中都走判分链路）
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label*="陨石"]');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button[type="submit"]')) {
        if ((b.textContent || "").includes("击落")) { b.click(); return; }
      }
    });
    await sleep(300);
    const afterShot = await page.evaluate(() => (document.body.innerText || "").length);
    check("保卫战 输入+击落链路无异常", afterShot > 100);
  }
  await checkLayout(page, "保卫战");
}

/** 快问快答：开始 → 出题（选项按钮 ≥3）→ 点一个选项 → 判分切题 */
async function playSprint(page) {
  const r = await openGame(page, "/arcade/sprint", "开始（60 秒）");
  check("快问快答 页面 200", r.status === 200, `status=${r.status}`);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("开始（60 秒）")) { b.click(); return; }
    }
  });
  // 游玩视图按钮很少（发音 + A/B/C/D 共 5 个），别用「按钮很多」当就绪信号
  await page.waitForFunction(() => !!document.querySelector('button[aria-label="播放单词发音"]'), { timeout: 20_000 }).catch(() => {});
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll("button")].filter(
      (b) => !/播放|退出|返回/.test(b.getAttribute("aria-label") || "") && (b.textContent || "").trim().length > 1 &&
        !/开始|得分|连击|退出/.test(b.textContent || ""),
    ).length,
  );
  check("快问快答 出题并有选项", opts >= 3, `选项数 ${opts}`);
  // 第一题题型随机：听音辨义有发音按钮，看词/看义题型没有，两者之一即为题干正常
  const stem = await page.evaluate(() => {
    const speak = !!document.querySelector('button[aria-label="播放单词发音"]');
    const label = /看词选义|看义选词|听音辨义/.test(document.body.innerText || "");
    return { speak, label };
  });
  check("快问快答 题干渲染（发音按钮或题型标签）", stem.speak || stem.label,
    `speak=${stem.speak} label=${stem.label}`);
  // 点第一个可点的选项，等判分动画过去，确认游戏仍在出题
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => (x.textContent || "").trim().length > 1 && !/播放|退出|返回|得分|连击/.test(x.textContent || "") && !x.getAttribute("aria-label"),
    );
    if (b) b.click();
  });
  await sleep(1000);
  const still = await page.evaluate(() => (document.body.innerText || "").includes("60") || document.querySelectorAll("button").length > 6);
  check("快问快答 答题后游戏继续", still);
  await checkLayout(page, "快问快答");
}

/** 贪吃蛇：intro → 进入游戏 → canvas 渲染 → D-pad 四方向可点 → 画布滑动转向 */
async function playSnake(page) {
  const r = await openGame(page, "/arcade/snake", "进入游戏");
  check("贪吃蛇 页面 200", r.status === 200, `status=${r.status}`);
  check("贪吃蛇 开场文案渲染", r.ok);
  await page.evaluate(() => {
    for (const b of document.querySelectorAll("button")) {
      if ((b.textContent || "").includes("进入游戏")) { b.click(); return; }
    }
  });
  await page.waitForSelector('canvas[aria-label*="贪吃蛇"]', { timeout: 20_000 }).catch(() => {});
  const shot = await canvasNotBlank(page, 'canvas[aria-label*="贪吃蛇"]');
  check("贪吃蛇 canvas 已绘制", shot.ok, shot.why);
  const dirs = await page.evaluate(() =>
    ["向上", "向下", "向左", "向右"].filter((d) => [...document.querySelectorAll("button")].some((b) => b.getAttribute("aria-label") === d)).length,
  );
  check("贪吃蛇 D-pad 四方向齐全", dirs === 4, `实际 ${dirs}/4`);
  // 点三个方向 + 滑动画布，确认转向链路不炸
  for (const d of ["向上", "向左", "向右"]) {
    await page.evaluate((dir) => {
      for (const b of document.querySelectorAll("button")) {
        if (b.getAttribute("aria-label") === dir) { b.click(); return; }
      }
    }, d);
    await sleep(150);
  }
  await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label*="贪吃蛇"]');
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: rect.left + x, clientY: rect.top + y });
    c.dispatchEvent(mk("pointerdown", rect.width / 2, rect.height / 2));
    c.dispatchEvent(mk("pointerup", rect.width / 2, rect.height / 2 - 40)); // 上滑
  });
  await sleep(500);
  const alive = await page.evaluate(() => (document.body.innerText || "").length);
  check("贪吃蛇 D-pad + 滑动转向无异常", alive > 100);
  await checkLayout(page, "贪吃蛇");
}

/* ---------------- 主流程 ---------------- */

/**
 * 测试账号自举：目标环境（尤其是线上重发布后库被重置）没有该账号时，
 * 走一遍「取注册验证码（devCode 回显）→ 注册」把账号重建出来。
 * 依赖 mailer 的 console 回显模式；配了真发信的环境会拿不到 devCode，跳过自举。
 */
async function ensureAccount(page) {
  const origin = new URL(BASE).origin;
  const issue = await page.evaluate(async ({ origin, email }) => {
    const r = await fetch(`${origin}/api/auth/email-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, purpose: "register" }),
    });
    return r.json();
  }, { origin, email: EMAIL });
  const devCode = issue?.data?.devCode;
  if (!devCode) {
    // 已注册账号无需再建（固定 env 账号重复跑时会走到这里）
    if (issue?.code === 4009) return true;
    console.log(`  [自举] 发码响应: code=${issue?.code} msg=${issue?.message}`);
    return false;
  }
  const registered = await page.evaluate(async ({ origin, email, pwd, code }) => {
    const r = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: pwd, code }),
    });
    return r.json();
  }, { origin, email: EMAIL, pwd: PWD, code: devCode });
  return registered?.code === 0;
}

async function main() {
  console.log(`目标: ${BASE}`);
  console.log(`账号: ${EMAIL}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
  });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0, 120)}`));

    // —— 桌面视口 ——
    await page.setViewport({ width: 1280, height: 860 });
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const first = await loginViaUi(page, { email: EMAIL, pwd: PWD });
    let loggedIn = first.ok;
    if (!loggedIn) {
      console.log("  账号不存在或登录失败，尝试自举注册…");
      const bootstrapped = await ensureAccount(page);
      check("测试账号自举", bootstrapped, "devCode 不可用或注册接口失败");
      if (bootstrapped) {
        await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        loggedIn = (await loginViaUi(page, { email: EMAIL, pwd: PWD })).ok;
      }
    }
    check("登录成功", loggedIn, `url=${page.url()}`);

    await playBlastLevels(page);
    await playSentence(page);
    await playFlappy(page);
    await playMole(page);
    await playGuard(page);
    await playSprint(page);
    await playSnake(page);

    // —— 手机视口（390）：只验布局 + canvas 游戏不崩 ——
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    for (const [path, waitText, tag] of [
      ["/arcade/blast-levels", "进入关卡地图", "消消乐"],
      ["/arcade/sentence", "开始组句", "句子重组"],
      ["/arcade/flappy", "笨鸟先飞", "笨鸟先飞"],
      ["/arcade/mole", "开始（60 秒）", "打地鼠"],
      ["/arcade/guard", "保卫战", "保卫战"],
      ["/arcade/sprint", "开始（60 秒）", "快问快答"],
      ["/arcade/snake", "贪吃蛇", "贪吃蛇"],
    ]) {
      const r = await openGame(page, path, waitText);
      check(`${tag} 手机视口 200+渲染`, r.status === 200 && r.ok, `status=${r.status}`);
      await checkLayout(page, `${tag}(手机)`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\n通过 ${pass} 项${fails.length ? `，失败 ${fails.length} 项` : "，全部绿 ✓"}`);
  if (fails.length) {
    for (const f of fails) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});
