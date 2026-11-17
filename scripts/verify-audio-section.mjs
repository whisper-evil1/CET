/**
 * 验收：听力音频要跟着板块走。
 *
 * 要求（用户原话）：「切到听力题目的时候继续播放，不是切出听力板块了还在播放」。
 * 拆成四条可判定的行为：
 *   1. 在听力板块点播放 → 真的出声（currentTime 在涨）；
 *   2. 切到阅读 / 写作 → 立刻静音（audio.paused 为真）；
 *   3. 暂停时进度不丢（currentTime 不归零，不是 stop）；
 *   4. 切回听力 → 从刚才那一点接着放，而不是从头。
 *
 * 为什么要用真实浏览器：这是 <audio> 元素的实际 paused / currentTime 行为，
 * 纯 HTTP 请求看不出来 —— 接口永远返回 200，声音在不在响只有浏览器知道。
 *
 * 用法：本地先起生产实例（PORT=3055 npm start），再 node scripts/verify-audio-section.mjs
 */
import puppeteer from "puppeteer-core";

// LIVE_BASE 优先：同一份脚本既能验本地，也能验线上，不必改代码
const BASE = (process.env.LIVE_BASE ?? process.env.LOCAL_BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const PAPER = process.env.PAPER_ID ?? "cet4-2025-12-s1";
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@cet.local";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
/** 线上访问要带分享码；本地实例不需要，留空即可 */
const SHARE = process.env.SHARE_CODE ?? "";
const withShare = (path) =>
  `${BASE}${path}${SHARE ? `${path.includes("?") ? "&" : "?"}sharecode=${SHARE}` : ""}`;
const SHOTS = process.env.SHOT_DIR ?? "shots/audio-section";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读单例 <audio> 的真实状态 */
const audioState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('audio[data-cet-audio="listening"]');
    if (!el) return null;
    return {
      paused: el.paused,
      time: Number(el.currentTime.toFixed(2)),
      duration: Number.isFinite(el.duration) ? Number(el.duration.toFixed(1)) : 0,
      src: (el.currentSrc || el.src || "").split("?")[0].slice(-40),
    };
  });

/** 等条件成立，返回是否等到 */
async function waitFor(page, fn, timeout = 20000, step = 400) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
}

/** 点顶部板块 tab（文字精确匹配） */
async function clickSection(page, label) {
  const hit = await page.evaluate((text) => {
    const btn = [...document.querySelectorAll("nav button")].find(
      (b) => (b.textContent ?? "").trim() === text,
    );
    if (btn instanceof HTMLElement) {
      btn.click();
      return true;
    }
    return false;
  }, label);
  await sleep(900);
  return hit;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // 无头环境下没有真实用户手势，放开自动播放策略才能让 play() 真的响
  args: [
    // 线上网关对 HTTP/2 的浏览器连接偶发直接掐断（ERR_CONNECTION_CLOSED），
    // 关掉 h2 走 HTTP/1.1 后稳定很多；不影响被测功能。
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-http2",
  ],
  defaultViewport: { width: 1440, height: 900 },
});

try {
  const page = await browser.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e.message).slice(0, 160)));

  /*
   * 0. 先拿会话再进页面。
   *
   * 这里不走登录页：登录页的 UI 一键入口由 verify-demo-login.mjs 单独验收，
   * 本脚本要验的是「音频跟不跟板块走」。线上首屏水合要十几到几十秒，
   * 再叠一层 UI 登录只会让这条验收变得更脆、更容易假红。
   * 用 HTTP 直接把会话 cookie 塞进浏览器，路径最短。
   */
  const jar = new Map();
  const jarFrom = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const csrfRes = await fetch(withShare("/api/auth/csrf"), {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  jarFrom(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const loginRes = await fetch(withShare("/api/auth/callback/credentials"), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
      cookie: cookie(),
      origin: BASE,
      referer: withShare("/login"),
    },
    body: new URLSearchParams({
      csrfToken,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
    redirect: "manual",
  });
  jarFrom(loginRes);
  const sessionName = [...jar.keys()].find((k) => /session-token$/.test(k));
  const host = new URL(BASE).hostname;
  for (const [name, value] of jar) {
    await page.setCookie({
      name,
      value,
      domain: host,
      path: "/",
      secure: BASE.startsWith("https"),
      httpOnly: true,
    });
  }
  check("前置：拿到登录会话", Boolean(sessionName && jar.get(sessionName)));

  /* 1. 进卷子，切到听力 */
  /*
   * 线上首次打开练习页要等容器把页面和水合都走完，一次 40 秒可能不够，
   * 而且偶发撞上网关的过渡页（状态码 200、内容是「正在启动」）。
   * 重试三次、每次都等板块标签真的出现，避免把「加载慢」测成「功能坏了」。
   */
  /*
   * 线上有两件事要一起等：
   *   1. 网关偶发掐断浏览器导航（ERR_CONNECTION_CLOSED），同地址 curl 却正常；
   *   2. 首屏是服务端直出的，DOM 早就有了但 onClick 还没绑上，
   *      这时候点「听力」不会切板块，看上去像按钮坏了。
   * 所以判定条件是练习页根节点的 data-hydrated="1" —— 它只在浏览器侧挂载完成后出现。
   * 拿不到就重新导航再试，最多四轮：吃了网络抖动，也不会把水合慢记成功能坏了。
   */
  let practiceReady = false;
  for (let attempt = 1; attempt <= 4 && !practiceReady; attempt += 1) {
    try {
      await page.goto(withShare(`/practice/${PAPER}`), { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch (e) {
      console.log(`   （第 ${attempt} 次打开练习页失败：${String(e.message).slice(0, 45)}）`);
      await sleep(5000);
      continue;
    }
    for (let k = 0; k < 24 && !practiceReady; k += 1) {
      practiceReady = await page
        .evaluate(() => document.querySelector('[data-hydrated="1"]') !== null)
        .catch(() => false);
      if (!practiceReady) await sleep(1500);
    }
    if (!practiceReady) {
      console.log(`   （第 ${attempt} 次没等到页面水合完成，重试）`);
      await sleep(3000);
    }
  }
  check("练习页打开（板块标签出现）", practiceReady);

  const hasListening = await page.evaluate(() =>
    [...document.querySelectorAll("nav button")].some((b) => (b.textContent ?? "").trim() === "听力"),
  );
  check("试卷有听力板块入口", hasListening, hasListening ? "" : "没找到「听力」tab");
  if (!hasListening) {
    console.log(`\n通过 ${results.filter((r) => r.pass).length}/${results.length}`);
    process.exit(1);
  }

  /*
   * 线上刚 domcontentloaded 时，按钮在、onClick 还没挂上（React 尚未水合），
   * 点一下不会有任何反应。所以「点 → 等 → 没有就再点」，最多三轮：
   * 既不放过真缺陷（真挂不上三轮都没反应），也不会把水合慢记成功能坏了。
   */
  let playReady = false;
  for (let round = 1; round <= 3 && !playReady; round += 1) {
    await clickSection(page, "听力");
    playReady = await waitFor(
      page,
      () => Boolean(document.querySelector('button[aria-label="播放"]')),
      12000,
    );
    if (!playReady) console.log(`   （第 ${round} 次点「听力」后还没出现播放器，重试）`);
  }
  check("听力左栏出现播放器", playReady);
  if (!playReady) {
    await page.screenshot({ path: `${SHOTS}/0-no-player.png` });
    const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 160));
    console.log(`   当前页面：${txt}`);
  }

  /* 2. 点播放，等真的出声 */
  let playing = false;
  for (let round = 1; round <= 3 && !playing; round += 1) {
    await page.click('button[aria-label="播放"]').catch(() => {});
    playing = await waitFor(
      page,
      () => {
        const el = document.querySelector('audio[data-cet-audio="listening"]');
        return Boolean(el) && !el.paused && el.currentTime > 0.6;
      },
      25000,
    );
    if (!playing) console.log(`   （第 ${round} 次点播放没出声，重试）`);
  }
  const t1 = (await audioState(page)) ?? { time: 0, duration: 0 };
  check("点播放后音频在走", playing, `currentTime=${t1.time}s 时长=${t1.duration || "未知"}s`);
  await page.screenshot({ path: `${SHOTS}/1-listening-playing.png` });

  /* 3. 切到阅读：必须停，且进度不丢 */
  await clickSection(page, "阅读");
  await sleep(1200);
  const t2 = (await audioState(page)) ?? { paused: true, time: 0 };
  check("切到阅读后音频暂停", t2.paused === true, `paused=${t2.paused} currentTime=${t2.time}s`);
  check(
    "暂停没有把进度清零（是暂停不是停止）",
    t2.time >= Math.max(0, t1.time - 1.5),
    `暂停前 ${t1.time}s → 暂停后 ${t2.time}s`,
  );
  await page.screenshot({ path: `${SHOTS}/2-switched-to-reading.png` });

  /* 4. 切回听力：接着放，不是从头 */
  await clickSection(page, "听力");
  const resumed = await waitFor(
    page,
    () => {
      const el = document.querySelector('audio[data-cet-audio="listening"]');
      return Boolean(el) && !el.paused;
    },
    15000,
  );
  await sleep(1200);
  const t3 = (await audioState(page)) ?? { paused: true, time: 0 };
  check("切回听力后自动继续播放", resumed && t3.paused === false, `paused=${t3.paused}`);
  check(
    "续播位置在前进而不是回到 0",
    t3.time > t2.time,
    `${t2.time}s → ${t3.time}s`,
  );
  await page.screenshot({ path: `${SHOTS}/3-back-to-listening.png` });

  /* 5. 切到写作同样要停（不是只对阅读生效） */
  const hasWriting = await page.evaluate(() =>
    [...document.querySelectorAll("nav button")].some((b) => (b.textContent ?? "").trim() === "写作"),
  );
  if (hasWriting) {
    await clickSection(page, "写作");
    await sleep(1000);
    const t4 = (await audioState(page)) ?? { paused: true, time: 0 };
    check("切到写作后音频暂停", t4.paused === true, `paused=${t4.paused}`);
  } else {
    check("切到写作后音频暂停", false, "这套卷没有写作板块，无法验证该分支");
  }

  check("全程无 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | ") || "无");

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n通过 ${passed}/${results.length}`);
  process.exit(passed === results.length ? 0 : 1);
} finally {
  await browser.close();
}
