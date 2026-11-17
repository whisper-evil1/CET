/**
 * 验证练习页的 AI 答疑抽屉：能打开、真模型出字、不回退到演示模式。
 *
 * 为什么单独验：用户截图里有一处「服务器开小差了」就出现在抽屉的题目上下文加载，
 * 另一处是「当前是演示模式」。前者是 /api/questions/[id]/ai-context 500，
 * 后者是通道没接上真模型。两件事都得对着线上真实域名用真实点击验，
 * 光看接口返回 200 说明不了抽屉里的链路通。
 *
 * 用法：
 *   CHECK_BASE=https://xxx.app.workbuddy.host CHECK_SHARE=XXXX node scripts/verify-ai-drawer.mjs
 *   CHECK_BASE=http://127.0.0.1:3000 node scripts/verify-ai-drawer.mjs   # 本地（不要求真模型）
 */
import { launchAndLogin } from "./lib/live-browser.mjs";

const BASE = (process.env.CHECK_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const SHARE = process.env.CHECK_SHARE ?? "";
const PAPER = process.env.CHECK_PAPER ?? "paper-cet4-2024-12";
const REQUIRE_LIVE = process.env.CHECK_REQUIRE_LIVE === "1" || BASE.startsWith("https:");
const { browser, page, loggedIn, withShare, sleep } = await launchAndLogin({ base: BASE, share: SHARE });

let pass = 0;
let fail = 0;
const record = (ok, name, detail) => {
  if (ok) {
    pass += 1;
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const contextCalls = [];
const cloudCalls = [];
page.on("response", (res) => {
  const u = res.url();
  if (/ai-context/.test(u)) contextCalls.push(res.status());
  if (/llm|chat\/completions/i.test(u)) cloudCalls.push(res.status());
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

record(loggedIn, "账号登录", loggedIn ? "已拿到会话 cookie" : "未拿到会话 cookie");

await page.goto(BASE + withShare(`/practice/${PAPER}`), { waitUntil: "networkidle2", timeout: 90000 });
await sleep(1200);

// 打开抽屉
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /问\s*AI/.test(b.textContent));
  if (!btn) return "no-button";
  btn.click();
  return "ok";
});
record(opened === "ok", "点击「问 AI」打开抽屉", opened);
await sleep(2500);

const drawerText = await page.evaluate(() => document.body.innerText);
record(/AI/.test(drawerText), "抽屉已渲染");
record(contextCalls.every((s) => s === 200) && contextCalls.length > 0, "题目上下文 ai-context 返回 200", contextCalls.join(",") || "未发起");

const beforeText = await page.evaluate(() => document.body.innerText);

// 点抽屉里的快捷提问（四选一，精确匹配文案；模糊匹配会点到解析面板里的按钮）
const QUICK = ["这题为什么选 B？", "错误选项都错在哪？", "这一段是什么意思？", "帮我分析这篇文章结构"];
const asked = await page.evaluate((list) => {
  const btns = [...document.querySelectorAll("button")];
  const target = btns.find((b) => list.includes(b.textContent.trim()));
  if (!target) return "no-quick-prompt";
  const text = target.textContent.trim();
  target.click();
  return text;
}, QUICK);
record(asked !== "no-quick-prompt", "抽屉内快捷提问可点击", asked);
await sleep(1200);

// 判定「真的出字了」：正文长度相对提问前明显增长，且用户提问已作为气泡出现在列表里
let answer = "";
let elapsed = "";
const t0 = Date.now();
for (let i = 0; i < 100; i += 1) {
  await sleep(500);
  const body = await page.evaluate(() => document.body.innerText);
  const grew = body.length - beforeText.length;
  // 空状态引导语「先挑一个问题试试」消失，说明对话已经开始
  const started = !/先挑一个问题试试/.test(body);
  if (started && grew > 120) {
    const at = asked !== "no-quick-prompt" ? body.indexOf(asked) : -1;
    const tail = at >= 0 ? body.slice(at + asked.length) : body.slice(-1200);
    answer = tail.replace(/\s+/g, " ").trim();
    elapsed = `第 ${((Date.now() - t0) / 1000).toFixed(1)} 秒出字（正文增长 ${grew} 字）`;
    break;
  }
}
await sleep(4000);
const finalText = await page.evaluate(() => document.body.innerText);
const isMock = /当前是演示模式|还没有配置 AI Key/.test(finalText);

record(Boolean(answer), "提问后流式出字", elapsed || "50 秒内未出字");
record(!isMock, "不是演示模式（走真模型）", isMock ? "出现演示模式文案" : "无演示文案");
record(cloudCalls.some((s) => s === 200), "云服务 LLM 请求 200", cloudCalls.join(",") || "未发起（可能走了服务端回退）");
record(!/服务器开小差/.test(finalText), "页面无「服务器开小差」提示");

console.log("\n回答片段:", (answer || finalText.slice(-300)).slice(0, 300));

await browser.close();

const ok = pass > 0 && fail === 0 && (!REQUIRE_LIVE || (!isMock && Boolean(answer)));
console.log(`\n结果：通过 ${pass} / 失败 ${fail} → ${ok ? "判定通过" : "判定未通过"}`);
process.exit(ok ? 0 : 1);
