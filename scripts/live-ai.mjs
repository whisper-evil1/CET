/**
 * 线上云端 AI 验收：确认 AI 答疑走的是云端 LLM（live），而不是演示模式（mock）。
 * 用法：node scripts/live-ai.mjs
 */
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = "https://cet-reading-02555.app.workbuddy.host";
const SHARE = "2AI33QQETY";
const PAPER = "paper-cet4-2024-12";
const EXECUTABLE = process.env.BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const sessionName = "__Secure-authjs.session-token";
const sessionValue = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "小明", email: "demo@cet.local" },
  secret,
  salt: sessionName,
  maxAge: 3600,
});

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

let chatReqHeaders = null;
let chatReqBody = null;
page.on("request", (req) => {
  const u = req.url();
  if (/completions/.test(u)) {
    chatReqHeaders = req.headers();
    chatReqBody = (req.postData() ?? "").slice(0, 800);
  }
});

const apiCalls = [];
let modelList = null;
let chatBodyHead = null;
page.on("response", async (res) => {
  const u = res.url();
  if (/\/\.cloud\/|cloud|llm|completions/i.test(u)) {
    apiCalls.push(`${res.status()} ${u.slice(0, 140)}`);
    try {
      if (/models/.test(u)) modelList = await res.text();
      if (/completions/.test(u)) chatBodyHead = (await res.text()).slice(0, 600);
    } catch {
      /* body 不可读时忽略 */
    }
  }
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 先带 sharecode 访问，让平台下发分享凭证 cookie
await page.goto(`${BASE}/?sharecode=${SHARE}`, { waitUntil: "networkidle2" });
await page.setCookie({
  name: sessionName,
  value: sessionValue,
  domain: new URL(BASE).hostname,
  path: "/",
  httpOnly: true,
  secure: true,
});

await page.goto(`${BASE}/practice/${PAPER}?sharecode=${SHARE}`, { waitUntil: "networkidle2" });
await sleep(2500);
console.log("练习页 URL:", page.url());

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => b.textContent?.trim().slice(0, 20)).filter(Boolean).slice(0, 40),
);
console.log("按钮清单:", JSON.stringify(buttons));

// 打开 AI 答疑抽屉
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /AI|答疑|问老师/.test(b.textContent ?? ""));
  if (!btn) return "not-found";
  btn.click();
  return "clicked:" + btn.textContent?.trim().slice(0, 16);
});
console.log("打开 AI:", opened);
await sleep(2500);

const drawer = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"], aside, [data-drawer]');
  return d ? d.innerText.slice(0, 400) : "(未找到抽屉)";
});
console.log("抽屉内容:", JSON.stringify(drawer));

// 输入并发送
const sent = await page.evaluate(() => {
  const area = document.querySelector("textarea, input[type=text]");
  if (!area) return "no-input";
  const setter = Object.getOwnPropertyDescriptor(
    area instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(area, "这道题为什么不选 B？");
  area.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed";
});
console.log("输入:", sent);
await sleep(500);

const submit = await page.evaluate(() => {
  const scope = document.querySelector('[role="dialog"], aside, [data-drawer]') ?? document;
  const btn = [...scope.querySelectorAll("button")].find((b) => /发送|提问|提交/.test(b.textContent ?? ""));
  if (!btn) return "no-send";
  btn.click();
  return "sent";
});
console.log("发送:", submit);

// 轮询等回答：云端首个 chunk 超时 15s 会自动回退演示流，这里给到 45s 看清最终状态
let answer = "";
let settled = "";
for (let i = 0; i < 45; i++) {
  await sleep(1000);
  answer = await page.evaluate(() => document.body.innerText);
  const stillThinking = /思考中/.test(answer);
  if (!stillThinking) {
    settled = `第 ${i + 1}s 开始出字`;
    break;
  }
}
if (!settled) settled = "45s 内一直停留在「思考中」";
// 出字后再等一段，取完整回答（避免只抓到第一个 token）
if (settled.includes("开始出字")) {
  await sleep(12000);
  answer = await page.evaluate(() => document.body.innerText);
}

const isMock = /演示模式|还没有配置 AI Key/.test(answer);
const tail = answer.slice(Math.max(0, answer.length - 900));
console.log("=== 状态 ===", settled);
console.log("=== 回答末尾 ===");
console.log(tail);
console.log("=== 判定 ===");
console.log(isMock ? "❌ 仍是演示模式（云端 LLM 未生效）" : "✅ 不是演示模式（走真实模型）");
console.log("=== 云/LLM 相关请求 ===");
console.log(apiCalls.slice(0, 8).join("\n") || "(无)");
console.log("=== 模型列表 ===");
try {
  const models = JSON.parse(modelList ?? "[]");
  models.forEach((m) => {
    console.log(
      `  ${m.id.padEnd(22)} onlyReasoning=${String(m.onlyReasoning).padEnd(5)} supportsReasoning=${String(
        m.supportsReasoning,
      ).padEnd(5)} disabled=${String(m.disabled).padEnd(5)} default=${String(m.isDefault).padEnd(5)} ${m.name}`,
    );
  });
} catch {
  console.log(modelList ?? "(未捕获)");
}
console.log("=== 流式响应开头 ===");
console.log(chatBodyHead ?? "(未捕获)");
console.log("=== 请求头（去 cookie）===");
if (chatReqHeaders) {
  const clean = { ...chatReqHeaders };
  delete clean.cookie;
  console.log(JSON.stringify(clean).slice(0, 600));
}
console.log("=== 请求体 ===");
console.log(chatReqBody ?? "(未捕获)");
console.log("=== 页面错误 ===");
console.log(errors.slice(0, 5).join("\n") || "(无)");

await browser.close();
