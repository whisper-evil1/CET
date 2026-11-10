#!/usr/bin/env node
/**
 * 词书 / 导入 / 优先级队列的浏览器端验收（真 Chrome，手机 + 桌面两种视口）。
 *
 * 接口层已由 e2e-vocab-import.mjs 覆盖；这一层只证明「用户真的点得动」：
 *   1. /vocab 三个入口可切换，词书卡片能看到取词规则
 *   2. 一键导入 50 词，生词本立刻出现这些词
 *   3. 列表显示优先级与到期文案；切换「优先级」排序后顺序确实递减
 *   4. 粘贴文本导入能给出解析结果
 *   5. 刷词模式答对后提示「下次复习：N 天后」
 *   6. 手机（390px）与桌面（1280px）都没有横向溢出，按钮可点
 *   7. 全程无 JS 报错
 *
 * 用法：
 *   BASE_URL=http://127.0.0.1:3100 node scripts/e2e-vocab-ui2.mjs
 */
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";
import { loginViaUi } from "./lib/login.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const rec = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "  OK  " : " FAIL "} ${name}${detail ? `  ⟶  ${detail}` : ""}`);
};

const email = `vb_${Date.now()}@qq.com`;
const pwd = "Passw0rd!";
let userId = null;
const jsErrors = [];

async function register() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pwd, name: "词书测试" }),
    });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && ct.includes("json")) {
      const payload = JSON.parse(await res.text());
      if (payload?.code === 0) return true;
      console.log(`  注册业务错误：${payload?.message ?? "未知"}`);
    } else if (res.status === 429) {
      console.log("  注册限流，等 25 秒");
      await sleep(25_000);
      continue;
    } else if (res.ok) {
      console.log("  拿到占位页（应用冷启动中），等 15 秒");
      await sleep(15_000);
      continue;
    } else {
      console.log(`  注册失败 HTTP ${res.status}`);
    }
  }
  return false;
}

/** 手机视口下检查是否横向溢出，并把超宽元素报出来 */
async function overflowReport(page) {
  return page.evaluate(() => {
    const inner = window.innerWidth;
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - inner;
    const offenders = [];
    if (overflow > 1) {
      const all = document.querySelectorAll("body *");
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > inner + 1 || rect.left < -1) {
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)}`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { overflow, offenders, inner };
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"],
});

const page = await browser.newPage();
// 手机视口放在导航前设置：导航后再改 isMobile 会触发整页重载
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
page.on("pageerror", (err) => jsErrors.push(String(err).slice(0, 200)));
page.on("console", (msg) => {
  if (msg.type() === "error") jsErrors.push(msg.text().slice(0, 200));
});

try {
  const registered = await register();
  rec("测试账号注册成功", registered, email);
  if (!registered) throw new Error("注册失败，无法继续");

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const login = await loginViaUi(page, { email, pwd }, { attempts: 3, waitMs: 900, sleep });
  rec("登录成功", login.ok, login.url);

  await page.goto(`${BASE}/vocab`, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(1200);

  const hasTitle = await page.evaluate(() => (document.body.innerText || "").includes("生词本"));
  rec("生词本页面渲染", hasTitle);

  /* ---------- 词书 ---------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "词书");
    btn?.click();
  });
  await sleep(1500);

  const bookText = await page.evaluate(() => document.body.innerText || "");
  rec("词书页出现四级高频", bookText.includes("四级高频"), "");
  rec("词书页出现六级高频", bookText.includes("六级高频"));
  rec("词书页出现必备核心", bookText.includes("必备核心"));
  rec("取词规则对用户可见", bookText.includes("COCA") || bookText.includes("词频"));

  /* ---------- 一键导入 ---------- */
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入 50");
    if (!btn) return false;
    btn.click();
    return true;
  });
  rec("找到「导入 50」按钮", clicked);

  let notice = "";
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    notice = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => (p.textContent || "").includes("新增"));
      return el ? el.textContent.trim() : "";
    });
    if (notice.includes("新增")) break;
  }
  rec("导入结果有明确反馈", /新增\s*\d+/.test(notice), notice);

  const importedCount = await page.evaluate(() => {
    const m = (document.body.innerText || "").match(/已导入\s*(\d+)\s*\/\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  });
  rec("卡片上的已导入数同步更新", importedCount > 0, String(importedCount));

  /* ---------- 生词本列表 ---------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "生词本");
    btn?.click();
  });
  await sleep(1500);

  const listInfo = await page.evaluate(() => {
    const items = [...document.querySelectorAll("ul li")];
    const words = items.length;
    const text = document.body.innerText || "";
    const hasPriority = /\b\d{1,3}\b/.test(text);
    const hasDue = /新词|天后|今天该复习|逾期/.test(text);
    const hasReason = /考纲词|词频第|真题语境/.test(text);
    return { words, hasPriority, hasDue, hasReason };
  });
  rec("生词本列表里有导入的词", listInfo.words > 10, `${listInfo.words} 条`);
  rec("列表显示到期状态", listInfo.hasDue);
  rec("列表显示优先级理由", listInfo.hasReason);

  /* ---------- 优先级排序 ---------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "优先级");
    btn?.click();
  });
  await sleep(1200);

  const order = await page.evaluate(() => {
    const list = document.querySelector("ul");
    if (!list) return [];
    return [...list.querySelectorAll("li")]
      .map((li) => {
        const badge = [...li.querySelectorAll("span")].find((s) => /^\d{1,3}$/.test(s.textContent.trim()));
        return badge ? Number(badge.textContent.trim()) : null;
      })
      .filter((n) => n != null);
  });
  const monotonic = order.every((n, i) => i === 0 || order[i - 1] >= n);
  rec("按优先级排序后分数确实递减", order.length > 3 && monotonic, order.slice(0, 6).join(" ≥ "));

  /* ---------- 粘贴导入 ---------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "导入");
    btn?.click();
  });
  await sleep(900);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "填入示例");
    btn?.click();
  });
  await sleep(400);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("导入到生词本"));
    btn?.click();
  });

  let importResult = "";
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    importResult = await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) => (p.textContent || "").includes("解析"));
      return el ? el.textContent.trim() : "";
    });
    if (importResult.includes("解析")) break;
  }
  rec("粘贴导入返回解析统计", /解析\s*\d+\s*个词/.test(importResult), importResult);

  /* ---------- 刷词 ---------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "生词本");
    btn?.click();
  });
  await sleep(1200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("开始刷词"));
    btn?.click();
  });
  await sleep(1500);

  const hasCard = await page.evaluate(() => (document.body.innerText || "").includes("不认识"));
  rec("刷词卡片出现", hasCard);

  // 注意不能只用 includes("认识")：词卡按钮的文案里也有「已认识 0/3 次」，
  // 会先命中卡片（点了只会朗读），看起来像按钮失灵。
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.textContent || "").trim();
      return t.length <= 10 && t.endsWith("认识") && !t.includes("不认识");
    });
    btn?.click();
  });

  let nextHint = "";
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    nextHint = await page.evaluate(() => {
      const m = (document.body.innerText || "").match(/下次复习：\s*([^\n]+)/);
      return m ? m[1].trim() : "";
    });
    if (nextHint) break;
  }
  rec("答对后提示下次复习时间", Boolean(nextHint), nextHint);

  /* ---------- 手机溢出 ---------- */
  const mobileOverflow = await overflowReport(page);
  rec("手机视口无横向溢出", mobileOverflow.overflow <= 1, `溢出 ${mobileOverflow.overflow}px ${mobileOverflow.offenders.join(", ")}`);

  /* ---------- 桌面视口 ---------- */
  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1280, height: 900 });
  desktop.on("pageerror", (err) => jsErrors.push(String(err).slice(0, 200)));
  await desktop.goto(`${BASE}/vocab`, { waitUntil: "networkidle2", timeout: 60_000 });
  await sleep(1200);

  const desktopOverflow = await overflowReport(desktop);
  rec("桌面视口无横向溢出", desktopOverflow.overflow <= 1, `溢出 ${desktopOverflow.overflow}px`);

  const desktopBooks = await desktop.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "词书");
    btn?.click();
    return Boolean(btn);
  });
  await sleep(1200);
  const desktopBookText = await desktop.evaluate(() => document.body.innerText || "");
  rec("桌面端能切到词书并渲染", desktopBooks && desktopBookText.includes("四级高频"));

  /* ---------- JS 报错 ---------- */
  const meaningful = jsErrors.filter(
    (e) => !/favicon|Failed to load resource|401|net::ERR/i.test(e),
  );
  rec("全程无 JS 报错", meaningful.length === 0, meaningful.slice(0, 3).join(" | "));

  /* ---------- 清理测试账号 ---------- */
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  userId = user?.id ?? null;
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await prisma.$disconnect();
  console.log(`  清理测试账号：${userId ? "已删除" : "未找到"}`);
} catch (error) {
  rec("测试脚本异常", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n结果：${passed} 通过 / ${results.length - passed} 失败`);
process.exit(passed === results.length ? 0 : 1);
