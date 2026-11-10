/**
 * 跨浏览器 / 手机布局审计（puppeteer-core + 本机 Chrome）。
 *
 * 检查：
 *  A. 现代渲染：多断点下是否出现横向溢出（scrollWidth > innerWidth）。
 *  B. 老内核兜底：给 <html> 打 data-css-fallback="1"（模拟不支持 @layer 的内核），
 *     校验导航文字颜色不再是浏览器默认蓝、主色按钮/正确-错误色块仍然上色、且不横向溢出。
 *
 * 用法：BASE_URL=http://127.0.0.1:3000 USER_ID=<id> node scripts/audit-ui.mjs
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const CHROME =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const PUBLIC = ["/", "/login", "/cet4"];
const AUTHED = ["/mistakes", "/profile", "/vocab", "/favorites", "/leaderboard"];

const VIEWPORTS = [
  { name: "手机 390×844", width: 390, height: 844, mobile: true },
  { name: "桌面 1440×900", width: 1440, height: 900, mobile: false },
];

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function overflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return {
      scrollW: de.scrollWidth,
      innerW: window.innerWidth,
      bodyScrollW: document.body ? document.body.scrollWidth : 0,
    };
  });
}

async function setSessionCookie(browser, token) {
  const cookie = {
    name: "authjs.session-token",
    value: token,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
  };
  try {
    if (typeof browser.setCookie === "function") {
      await browser.setCookie(cookie);
      return;
    }
  } catch {
    /* 继续尝试其它 API */
  }
  const page = await browser.newPage();
  try {
    await page.setCookie(cookie);
  } catch {
    const client = await page.createCDPSession();
    await client.send("Network.setCookie", cookie);
  } finally {
    await page.close();
  }
}

async function main() {
  const userId = (process.env.USER_ID || "").trim();
  let token = "";
  if (userId) {
    token = execFileSync("node", ["scripts/dev-session.mjs", userId], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });

  try {
    if (token) await setSessionCookie(browser, token);

    // A. 现代渲染 + 溢出
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.mobile, deviceScaleFactor: 1 });
      const routes = [...PUBLIC, ...(token ? AUTHED : [])];
      for (const route of routes) {
        let status = 0;
        try {
          const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
          status = resp ? resp.status() : 0;
        } catch (e) {
          rec(`[${vp.name}] ${route} 加载`, false, `导航失败：${e.message}`);
          continue;
        }
        await new Promise((r) => setTimeout(r, 500));
        const o = await overflow(page);
        const ok = status === 200 && o.scrollW <= o.innerW + 2;
        rec(
          `[${vp.name}] ${route} 无横向溢出`,
          ok,
          `HTTP ${status} scrollW=${o.scrollW} innerW=${o.innerW}`,
        );
      }
      await page.close();
    }

    // B. 老内核兜底
    for (const route of ["/", "/mistakes"]) {
      if (route === "/mistakes" && !token) continue;
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => document.documentElement.setAttribute("data-css-fallback", "1"));
      await new Promise((r) => setTimeout(r, 200));

      const probe = await page.evaluate(() => {
        const navA = document.querySelector("nav a");
        const navColor = navA ? getComputedStyle(navA).color : "";
        // 主色按钮/徽标
        const accentEl = document.querySelector('[class*="bg-accent"]');
        const accentBg = accentEl ? getComputedStyle(accentEl).backgroundColor : "";
        // 正确/错误色块（错题页有 option 行）
        const correctEl = document.querySelector('[class*="bg-correct"]');
        const correctBg = correctEl ? getComputedStyle(correctEl).backgroundColor : "";
        const wrongEl = document.querySelector('[class*="bg-wrong"]');
        const wrongBg = wrongEl ? getComputedStyle(wrongEl).backgroundColor : "";
        return {
          navColor,
          accentBg,
          correctBg,
          wrongBg,
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        };
      });

      const notDefaultBlue =
        !/rgb\(0,\s*0,\s*238\)|rgb\(0,\s*0,\s*255\)/.test(probe.navColor) && probe.navColor !== "";
      rec(`[老内核] ${route} 导航非默认蓝`, notDefaultBlue, `navColor=${probe.navColor}`);
      rec(
        `[老内核] ${route} 主色块上色`,
        /rgb\(166,\s*57,\s*43\)/.test(probe.accentBg),
        `accentBg=${probe.accentBg || "无 bg-accent 元素"}`,
      );
      if (route === "/mistakes") {
        rec(
          `[老内核] ${route} 正确色块`,
          /rgb\(46,\s*107,\s*79\)/.test(probe.correctBg) || /rgb\(232,\s*242,\s*236\)/.test(probe.correctBg),
          `correctBg=${probe.correctBg || "无"}`,
        );
        rec(
          `[老内核] ${route} 错误色块`,
          /rgb\(166,\s*57,\s*43\)/.test(probe.wrongBg) || /rgb\(248,\s*233,\s*230\)/.test(probe.wrongBg),
          `wrongBg=${probe.wrongBg || "无"}`,
        );
      }
      rec(
        `[老内核] ${route} 无横向溢出`,
        probe.scrollW <= probe.innerW + 2,
        `scrollW=${probe.scrollW} innerW=${probe.innerW}`,
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} 通过 ===`);
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error("审计脚本异常：", e);
  process.exit(1);
});
