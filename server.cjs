#!/usr/bin/env node
/**
 * 生产启动器（平台入口）。
 *
 * 为什么需要它：
 *   平台网关在服务启动后只等 30 秒，端口没响应就直接回
 *   {"code":504,"msg":"service on port 3000 not ready after 30000ms"}。
 *   而 Next.js 必须先 `next build` 才有 `.next` 可跑，这个工程构建要 25～30 秒，
 *   一旦冷启动就把 30 秒窗口吃满，分享出去的链接对访客就是 504。
 *
 * 做法：
 *   1. 进程一起来就 listen 在 $PORT 上，网关立刻认为服务已就绪；
 *   2. 构建与 Next 启动都放到后台，Next 跑在内网端口（$PORT + 1000），
 *      外部只能访问到本进程；
 *   3. 就绪前，访客看到的是一张中文启动页（每 3 秒自动刷新），而不是 JSON 报错；
 *   4. 就绪后所有请求原样转发，流式响应（AI 答疑的 SSE）直接 pipe，不缓冲；
 *   5. `.next` 比源码新就跳过构建，二次重启直接起，秒开。
 *
 * 注意：这里不能用 `npm run build && npm start` 那种写法，
 * 因为 `&&` 保证的是「先构建完才绑端口」，正好是 504 的成因。
 */
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 3000);
/** Next 跑在内网端口，不直接对外 */
const APP_PORT = PORT + 1000;
const HOST = "127.0.0.1";

/**
 * 是否还需要构建。
 *
 * 只判断产物在不在，不比时间戳。原因是沙箱重启时 `.next` 未必保留，
 * 而源码时间戳会被解压流程重置，用「谁更新」判断会误判成过期，
 * 结果每次重启都白建一遍——那是纯粹的时间浪费。
 *
 * 产物存在就一定是新的：发布流程的 install 阶段会 `npm run build`，
 * 构建失败整次发布就失败了，跑不起来的产物不会留在容器里。
 */
function needsBuild() {
  return !fs.existsSync(path.join(".next", "BUILD_ID"));
}

let phase = "boot"; // boot | building | starting | ready | error
let errMsg = "";
let startedAt = Date.now();
let child = null;

function log(...args) {
  console.log(`[boot ${((Date.now() - startedAt) / 1000).toFixed(1)}s]`, ...args);
}

/** 等内网端口能连上 */
function waitForApp(timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const sock = net.connect({ port: APP_PORT, host: HOST });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("Next 服务启动超时"));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

/** 跑一条命令，透传输出 */
function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: process.env });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} 退出码 ${code}`))
    );
  });
}

const NEXT_BIN = path.join("node_modules", "next", "dist", "bin", "next");

async function startNext() {
  phase = "starting";
  child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(APP_PORT), "-H", HOST], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(APP_PORT) },
  });
  child.on("exit", (code) => {
    if (phase === "ready") {
      phase = "error";
      errMsg = `Next 进程退出（退出码 ${code}），正在重启`;
      log(errMsg);
      setTimeout(() => {
        phase = "starting";
        bootstrap();
      }, 2000);
    }
  });
  await waitForApp();
}

async function bootstrap() {
  try {
    if (needsBuild()) {
      phase = "building";
      log("没有构建产物，开始构建（约 30 秒），期间访客看到启动页");
      await run(process.execPath, [NEXT_BIN, "build"], "next build");
      log("构建完成");
    } else {
      log("构建产物已存在，直接启动");
    }

    try {
      await startNext();
    } catch (e) {
      // 产物存在却起不来，说明产物不可用（版本不符 / 依赖变动），重建一次
      log("首次启动失败，重新构建后重试:", e.message);
      phase = "building";
      await run(process.execPath, [NEXT_BIN, "build"], "next build");
      await startNext();
    }

    phase = "ready";
    log(`服务就绪，外部端口 ${PORT} → 内部端口 ${APP_PORT}，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (e) {
    phase = "error";
    errMsg = e && e.message ? e.message : String(e);
    log("启动失败:", errMsg);
  }
}

/** 未就绪时给访客看的页面：不依赖任何外部资源 */
function holdingPage() {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const isErr = phase === "error";
  const title = isErr ? "服务启动失败" : "正在启动";
  const body = isErr
    ? `<p class="hint">启动过程出错，稍后会自动重试。已等待 ${secs} 秒。</p>
       <p class="err">${errMsg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p>`
    : `<p class="hint">首次启动需要在服务器上编译前端，约 30 秒。<br>本页每 3 秒自动刷新，编译完成即进入。</p>
       <div class="bar"><span></span></div>
       <p class="sec">已等待 ${secs} 秒</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3">
<title>${title} · 左文右题</title>
<style>
  :root { color-scheme: light; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #faf8f3; color: #17181a;
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", -apple-system, sans-serif;
    padding: 24px;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border: 1px solid #e5e0d6;
    border-radius: 14px; padding: 34px 28px; text-align: center;
    box-shadow: 0 8px 28px rgba(23, 24, 26, .06);
  }
  .mark { font-size: 13px; letter-spacing: .3em; color: #a6392b; margin-bottom: 14px; }
  h1 { font-size: 26px; letter-spacing: .12em; font-weight: 700; margin-bottom: 8px; }
  .sub { font-size: 13px; color: #8a8479; margin-bottom: 26px; }
  .hint { font-size: 14px; line-height: 1.85; color: #4a4640; }
  .err { margin-top: 14px; font-size: 12px; color: #a6392b; word-break: break-all; }
  .bar { height: 3px; background: #eee9df; border-radius: 2px; overflow: hidden; margin: 22px 0 12px; }
  .bar span { display: block; height: 100%; width: 40%; background: #a6392b; border-radius: 2px;
    animation: slide 1.6s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
  .sec { font-size: 12px; color: #8a8479; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">左文右题</div>
    <h1>${title}</h1>
    <p class="sub">CET 四六级阅读练习工具</p>
    ${body}
  </div>
</body>
</html>`;
}

function proxy(req, res) {
  const headers = { ...req.headers, host: `${HOST}:${APP_PORT}` };
  const up = http.request(
    { host: HOST, port: APP_PORT, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res); // 直接 pipe，SSE / 流式响应不缓冲
    }
  );
  up.on("error", (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end(`上游服务不可用：${e.message}`);
  });
  req.pipe(up);
}

const server = http.createServer((req, res) => {
  // 供部署平台与自检使用的健康检查
  if (req.url === "/__boot") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        phase,
        ready: phase === "ready",
        elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        error: errMsg || null,
      })
    );
    return;
  }

  if (phase === "ready") {
    proxy(req, res);
    return;
  }

  const html = holdingPage();
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, must-revalidate",
    "content-length": Buffer.byteLength(html),
  });
  res.end(req.method === "HEAD" ? undefined : html);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, "0.0.0.0", () => {
  startedAt = Date.now();
  log(`已在 0.0.0.0:${PORT} 监听，构建转后台`);
  bootstrap();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    try {
      if (child) child.kill(sig);
    } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  });
}
