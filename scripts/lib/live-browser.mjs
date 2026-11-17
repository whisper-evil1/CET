/**
 * 浏览器验证脚本的共用部分：拉起 headless Chrome + 拿到线上会话。
 *
 * 为什么登录走 Node 再灌 cookie：
 *   线上有平台网关，浏览器里直接 fetch /api/auth/csrf 会被拦（回 HTML），
 *   Node 侧带 UA 请求更稳定；NextAuth 在 https 下用 __Secure- 前缀的 cookie，
 *   靠「注入自签 token」是对不上的，必须真实登录一次。
 *
 * 为什么关掉后台节流：
 *   headless 默认把不可见标签页的定时器节流到分钟级，应用里的超时兜底不会按时触发，
 *   看起来像「卡住」，其实是测试环境的假象。
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("找不到 Chrome，可用 BROWSER_PATH 指定");
  return hit;
}

/** 默认桌面 Chrome；传 CHECK_UA 可换成手机 / 微信等 UA 复现特定场景 */
export const UA =
  process.env.CHECK_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * 登录线上站点并把 cookie 灌进浏览器。
 * @returns {Promise<{browser: import("puppeteer-core").Browser, page: import("puppeteer-core").Page, loggedIn: boolean}>}
 */
export async function launchAndLogin({
  base,
  share = "",
  email = "demo@cet.local",
  password = "demo1234",
}) {
  const withShare = (p) => (share ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${share}` : "");

  const jar = new Map();
  const absorb = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  // 网关对非浏览器 UA 会偶发回「链接不完整」HTML，重试几次
  let csrfToken = "";
  for (let i = 0; i < 4 && !csrfToken; i += 1) {
    const res = await fetch(base + withShare("/api/auth/csrf"), { headers: { "user-agent": UA } });
    absorb(res);
    try {
      csrfToken = JSON.parse(await res.text()).csrfToken ?? "";
    } catch {
      if (i === 3) break;
      await sleep(2500);
    }
  }
  if (!csrfToken) throw new Error("拿不到 csrfToken（网关持续拦截），稍后重试");

  const res = await fetch(base + withShare("/api/auth/callback/credentials"), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(),
      "user-agent": UA,
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      callbackUrl: withShare("/"),
      json: "true",
    }),
  });
  absorb(res);
  const loggedIn = [...jar.keys()].some((k) => /session-token/.test(k));

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
    ],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  const host = new URL(base).hostname;
  const isHttps = base.startsWith("https:");
  for (const [name, value] of jar) {
    await page.setCookie({
      name,
      value,
      domain: host,
      path: "/",
      secure: isHttps,
      httpOnly: /session-token/.test(name),
    });
  }

  return { browser, page, loggedIn, withShare, sleep };
}

export { sleep };
