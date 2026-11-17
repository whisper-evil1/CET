/**
 * 验收：登录页「忘记密码 → 验证码 → 重置 → 自动登录」整条页面流程。
 *
 * 接口脚本（verify-reset-password.mjs）证明后端把关是对的；这份脚本证明
 * 人在浏览器里真的能走完，而且走的过程中没有把已有的东西弄坏：
 *   1. 「忘记密码？」在登录页上，位置紧跟密码框；
 *   2. 点进去是独立的「重置密码」视图 —— 页签和演示卡都让位，不混在一起；
 *   3. 登录表单里填过的邮箱会被带过去（少输一次）；
 *   4. 发码后，未配邮件服务的环境下页面直接显示验证码，点一下能填入；
 *   5. 弱密码提交被拦下后，**验证码仍然有效** —— 再提交一次就成功（页面级复验）；
 *   6. 重置成功会自动登录进站，不是停在登录页让人再输一遍；
 *   7. 全程没有 JS 报错。
 *
 * 用法：本地起实例后
 *   BASE=http://127.0.0.1:3100 node scripts/verify-reset-password-ui.mjs
 * 线上（首屏水合慢，脚本会把等待放宽到 90 秒）：
 *   LIVE_BASE=https://… SHARE_CODE=XXXX node scripts/verify-reset-password-ui.mjs
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { mkdirSync } from "node:fs";

const BASE = (
  process.env.LIVE_BASE ??
  process.env.BASE ??
  process.env.LOCAL_BASE ??
  "http://127.0.0.1:3100"
).replace(/\/$/, "");
const SHARE = process.env.SHARE_CODE ?? "";
const SHOTS = process.env.SHOT_DIR ?? "shots/reset-password";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now().toString(36);
const EMAIL = `resetui-${stamp}@qq.com`;
const OLD_PASSWORD = "oldpass123";
const NEW_PASSWORD = "newpass456";

console.log(`目标：${BASE}`);
console.log(`测试账号：${EMAIL}\n`);

// 先用接口把账号建好（UI 注册页是另一条链路，不在这份脚本的验收范围里）
const reg = await fetch(withShare("/api/auth/register"), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: OLD_PASSWORD, name: "重置 UI 测试" }),
}).then((r) => r.json());
if (reg?.code !== 0) {
  console.error(`前置注册失败：${reg?.message ?? "未知"}，脚本无法继续`);
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    // 线上网关对 HTTP/2 的浏览器连接偶发直接掐断，关掉后稳定；不影响被测功能
    "--no-sandbox",
    "--disable-http2",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const page = await browser.newPage();
  const jsErrors = [];
  // 带上出错的路径：首页和登录页的水合问题要分开看，混在一起没法定位
  page.on("pageerror", (e) =>
    jsErrors.push(`${page.url().replace(BASE, "") || "/"} :: ${String(e.message).slice(0, 120)}`),
  );


/**
 * 往输入框里填值。
 *
 * 必须「先清空再输入」：登录页会把上次用过的邮箱从 localStorage 回填进 #login-email，
 * 直接 type 会变成把新邮箱追加在旧值后面（出现过 …@qq.com@qq.comm 这种值），
 * 于是登录必然失败，看上去却像「新密码不对」。
 */
const fillInto = async (selector, text) => {
  /*
   * 走真实键盘：点进输入框 → Ctrl+A 全选 → 删掉 → 逐字输入。
   *
   * 试过两种「程序化填值」，都会让 React 状态与 DOM 脱节：
   *   1. 三击全选再打字：旧值没被清掉，新值插进中间（…@qq.c + 新值 + m）；
   *   2. 原生 value setter + input 事件：DOM 上是新值，但提交出去的是旧值 ——
   *      抓包看到「页面显示 10 位、请求体里却是 12 位」，登录被判密码错。
   * 真实用户按的是键盘，验收就该按键盘。这样测出来的才不是模拟器的怪癖。
   */
  await page.click(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(selector, text, { delay: 12 });
};

  /** 打开登录页并等到真正可交互（水合完成，按钮不再是禁用态） */
  const openLogin = async () => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await page.goto(withShare("/login"), { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector('section[aria-label="演示账号"] button:not([disabled])', {
          timeout: 90000,
        });
        // localStorage 里的上次邮箱是在 effect 里回填的，等它落地再动输入框
        await sleep(500);
        return;
      } catch (e) {
        console.log(`   （第 ${attempt} 次打开登录页没等到可交互：${String(e.message).slice(0, 60)}）`);
        await sleep(3000);
      }
    }
    throw new Error("登录页 90 秒内没有变成可交互");
  };

  await openLogin();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/01-login.png` });

  /* 1. 入口在这儿，而且贴着密码框 */
  const entry = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "忘记密码？",
    );
    const pwd = document.querySelector("#login-password");
    if (!(btn instanceof HTMLElement)) return { found: false };
    if (!(pwd instanceof HTMLElement)) return { found: true, nearPwd: false };
    const b = btn.getBoundingClientRect();
    const p = pwd.getBoundingClientRect();
    // 位于密码框正下方 120px 内即算「贴着」
    return { found: true, nearPwd: b.top > p.top && b.top - p.bottom < 120, dy: Math.round(b.top - p.bottom) };
  });
  check("登录页有「忘记密码？」入口", entry.found, entry.found ? "已找到" : "没找到");
  check("入口紧挨密码框（不是藏在页脚）", Boolean(entry.nearPwd), `距密码框 ${entry.dy ?? "?"}px`);

  /* 2. 先在登录表单填邮箱，再点忘记密码，看有没有带过去 */
  await fillInto("#login-email", EMAIL);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "忘记密码？",
    );
    if (btn instanceof HTMLElement) btn.click();
  });
  await page.waitForSelector('[data-view="reset"] input[name="email"]', { timeout: 10000 });
  await sleep(300);

  const resetView = await page.evaluate(() => {
    const h2 = document.querySelector("h2")?.textContent?.trim() ?? "";
    const tabsGone = ![...document.querySelectorAll("button")].some(
      (b) => (b.textContent ?? "").trim() === "注册",
    );
    const demoGone = !document.querySelector('section[aria-label="演示账号"]');
    const emailValue = document.querySelector('[data-view="reset"] input[name="email"]')?.value ?? "";
    return { h2, tabsGone, demoGone, emailValue };
  });
  check("切到独立的「重置密码」视图", resetView.h2 === "重置密码", `h2=${resetView.h2}`);
  check("重置视图里页签收起（不混进登录方式里）", resetView.tabsGone, resetView.tabsGone ? "已收起" : "仍在");
  check("重置视图里演示卡让位", resetView.demoGone, resetView.demoGone ? "已收起" : "仍显示");
  check("登录表单填过的邮箱被带过来了", resetView.emailValue === EMAIL, resetView.emailValue || "空");
  await page.screenshot({ path: `${SHOTS}/02-reset-view.png` });

  /* 3. 发码，读页面上的验证码 */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "发送验证码",
    );
    if (btn instanceof HTMLElement) btn.click();
  });

  const devCode = await page
    .waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")].find((b) =>
          /验证码直接显示/.test(b.textContent ?? ""),
        );
        const m = (btn?.textContent ?? "").match(/(\d{6})/);
        return m ? m[1] : null;
      },
      { timeout: 30000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => null);

  check(
    "未配邮件服务时，验证码直接显示在页面上",
    Boolean(devCode),
    devCode ? `码=${devCode}` : "没等到（可能已配置真实邮件服务）",
  );
  if (!devCode) {
    console.log("\n没有 devCode，后续步骤无法自动执行。");
  } else {
    await page.screenshot({ path: `${SHOTS}/03-code-shown.png` });

    /* 4. 点提示块应把码填进输入框 */
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) =>
        /验证码直接显示/.test(b.textContent ?? ""),
      );
      if (btn instanceof HTMLElement) btn.click();
    });
    await sleep(300);
    const codeValue = await page.$eval('[data-view="reset"] input[name="code"]', (el) => el.value);
    check("点提示块可一键填入验证码", codeValue === devCode, `输入框=${codeValue}`);

    /* 5. 弱密码先被拦，且不消耗验证码 */
    await fillInto('[data-view="reset"] input[name="newPassword"]', "ab1");
    await fillInto('[data-view="reset"] input[name="confirmPassword"]', "ab1");
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "重置密码并登录",
      );
      if (btn instanceof HTMLElement) btn.click();
    });
    await sleep(1200);
    const weakError = await page.evaluate(() => {
      const p = [...document.querySelectorAll("p")].find((el) => /至少 8 位/.test(el.textContent ?? ""));
      return p?.textContent?.trim() ?? "";
    });
    check("弱密码在页面上被拦下并给出原因", /至少 8 位/.test(weakError), weakError.slice(0, 40));
    check("被拦下后仍停在重置页（没有误跳走）", page.url().includes("/login"), page.url().replace(BASE, ""));
    await page.screenshot({ path: `${SHOTS}/04-weak-password.png` });

    /* 6. 换成合规密码，同一个验证码再提交一次 */
    /*
     * 这里必须用 fillInto 而不是「三击 + Backspace」。
     * 踩过：三击只删掉 1 个字符，弱密码那一步留下的 "ab" 还挂在里面，
     * 于是重置出来的密码是 abnewpass456（12 位），自动登录用这 12 位成功，
     * 后面手动输入 10 位当然登不上 —— 看起来像「新密码不生效」，其实是脚本自己造的假象。
     */
    await fillInto('[data-view="reset"] input[name="newPassword"]', NEW_PASSWORD);
    await fillInto('[data-view="reset"] input[name="confirmPassword"]', NEW_PASSWORD);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (b) => (b.textContent ?? "").trim() === "重置密码并登录",
        );
        if (btn instanceof HTMLElement) btn.click();
      }),
    ]);

    for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await sleep(500);
    check(
      "同一个码换合规密码后成功（弱密码没白费掉码）",
      !page.url().includes("/login"),
      page.url().replace(BASE, "") || "/",
    );

    const landed = await page.evaluate(() =>
      [...document.querySelectorAll("header a, nav a")].map((a) => (a.textContent ?? "").trim()),
    );
    check(
      "重置成功后自动登录进站（不用再输一次）",
      landed.some((t) => /背单词|生词本|闯关/.test(t)),
      landed.slice(0, 6).join(" / "),
    );
    await page.screenshot({ path: `${SHOTS}/05-after-reset.png` });

    /* 7. 新密码真的生效：清掉会话后，用新密码再登录一次 */
    // 不用 /api/auth/signout：v5 那个地址是 POST，GET 打开的是确认页，还得再点一次。
    // 直接清 cookie 等价于「换一台设备打开登录页」，也正是要验的场景。
    const cdp = await page.createCDPSession();
    await cdp.send("Network.clearBrowserCookies");
    await openLogin();
    await fillInto("#login-email", EMAIL);
    await fillInto("#login-password", NEW_PASSWORD);
    await sleep(300);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {}),
      page.evaluate(() => {
        const btn = [...document.querySelectorAll('button[type="submit"]')][0];
        if (btn instanceof HTMLElement) btn.click();
      }),
    ]);
    for (let i = 0; i < 40 && page.url().includes("/login"); i += 1) await sleep(500);

    /* 失败时先把页面自己说的话打出来，别让结论停在「没进去」这种没法排查的层面 */
    const manual = await page.evaluate(() => ({
      url: location.pathname,
      h2: document.querySelector("h2")?.textContent?.trim() ?? "",
      errors: [...document.querySelectorAll("p")]
        .map((p) => (p.textContent ?? "").trim())
        .filter((t) => /不对|失败|没成功|稍后|请先|错误/.test(t))
        .slice(0, 3),
      email: document.querySelector("#login-email")?.value ?? "",
      submitLabel:
        [...document.querySelectorAll('button[type="submit"]')]
          .map((b) => (b.textContent ?? "").trim())
          .join("|") || "(无 submit 按钮)",
    }));
    await page.screenshot({ path: `${SHOTS}/06-manual-login.png`, fullPage: false });
    check(
      "新密码可用邮箱密码登录",
      !page.url().includes("/login"),
      `url=${manual.url} 邮箱框=${manual.email || "空"} 按钮=${manual.submitLabel} 提示=${
        manual.errors.join(" / ") || "无"
      }`,
    );
  }

  /*
   * 报错按页面分开统计，不合并成一句「全程无报错」。
   *
   * 原因：首页（/）有一条**既有**的 React #418（服务端与客户端首帧文本不一致），
   * 上一轮就记录过、与本次改动无关（本次没动 /、站点头部、筛选条）。
   * 合并统计会让「重置流程很干净」这个结论被一条无关的旧账拖成红叉，
   * 反过来掩盖真问题；拆开之后，哪一侧出问题一眼能看见。
   */
  const flowErrors = jsErrors.filter((e) => !e.startsWith("/ ::"));
  const homeErrors = jsErrors.filter((e) => e.startsWith("/ ::"));

  check(
    "重置流程内无 JS 报错（登录页 / 重置页）",
    flowErrors.length === 0,
    flowErrors.slice(0, 2).join(" | ") || "无",
  );
  check(
    "落地首页无 JS 报错（已知遗留 #418，单独计）",
    homeErrors.length === 0,
    homeErrors.length ? homeErrors[0].slice(0, 120) : "无",
  );

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n结果：${passed}/${results.length} 通过`);
  if (passed !== results.length) {
    console.log("未通过：");
    for (const item of results.filter((r) => !r.pass)) console.log(`  - ${item.name}`);
  }
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await browser.close();
  try {
    const prisma = new PrismaClient();
    await prisma.user.delete({ where: { email: EMAIL } });
    await prisma.$disconnect();
    console.log(`已清理测试账号 ${EMAIL}`);
  } catch (error) {
    console.log(`清理测试账号失败（不影响结论）：${String(error).slice(0, 120)}`);
  }
}
