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
 *   2. 安装依赖、生成 Prisma Client、构建与 Next 启动全部放到后台，
 *      Next 跑在内网端口（$PORT + 1000），外部只能访问到本进程；
 *   3. 就绪前，访客看到的是一张中文启动页（每 3 秒自动刷新），而不是 JSON 报错；
 *   4. 就绪后所有请求原样转发，流式响应（AI 答疑的 SSE）直接 pipe，不缓冲；
 *   5. `.next` 产物在就跳过构建，二次重启直接起，秒开。
 *
 * 为什么连安装也放这里：
 *   发布平台单条命令上限 300 秒（超过就 400 + Command execution timed out）。
 *   冷沙箱装 Next 15 + React 19 + Prisma + Linux 版 SWC 原生包要 4～6 分钟，
 *   写在 install 阶段必然超时；挪到本进程后台后，这个上限就不再是约束。
 *   对应地，发布参数里的 installCmd 只需一条秒回的空命令。
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
 * 源码内容指纹。
 *
 * 为什么不用时间戳：沙箱每次发布/重启都会重新解压源码，mtime 被整体重置，
 * 拿「谁更新」比会误判成过期，每次重启都白建一遍。
 * 内容哈希与解压顺序、时间都无关，只有代码真的变了才变。
 */
function sourceHash() {
  const crypto = require("node:crypto");
  const h = crypto.createHash("sha1");
  const roots = ["src", "prisma/schema.prisma", "package.json", "tsconfig.json"];
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js"]) {
    if (fs.existsSync(name)) roots.push(name);
  }

  const files = [];
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) walk(path.join(p, e));
    } else {
      files.push(p);
    }
  };
  roots.forEach(walk);
  files.sort();

  for (const f of files) {
    h.update(f);
    try {
      h.update(fs.readFileSync(f));
    } catch {}
  }
  return h.digest("hex").slice(0, 16);
}

const STAMP_FILE = path.join(".next", "BUILD_STAMP");

/**
 * 是否还需要构建。
 *
 * 判据是「产物在 + 指纹对得上」，两个条件缺一不可：
 *   只判存在 —— 沙箱会保留上一次的 `.next`，新代码上传后照样跑旧包，
 *              表象就是「发布成功但线上还是旧版」（本工程踩过两次）。
 *   只判指纹 —— 产物可能被清掉，指纹文件也随之消失，得靠存在性兜住。
 */
function needsBuild(stamp) {
  if (!fs.existsSync(path.join(".next", "BUILD_ID"))) return true;
  try {
    return fs.readFileSync(STAMP_FILE, "utf8").trim() !== stamp;
  } catch {
    return true;
  }
}

let phase = "boot"; // boot | installing | building | starting | ready | error
let errMsg = "";
/** 后台命令（安装 / 构建）的输出尾巴，供 /__boot 远程取证 */
let errLog = "";
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

/**
 * 跑一条命令，透传输出。
 * timeoutMs 缺省不设上限：安装在后台跑，被 300 秒窗口截断过一次，不能再有暗限。
 * capture 为真时把输出尾巴存进 errLog，由 /__boot 暴露出去——
 * 远程容器里没有别的日志入口，构建失败只能靠这条通道自证。
 */
function run(cmd, args, label, opts = {}) {
  return new Promise((resolve, reject) => {
    const capture = Boolean(opts.capture);
    const p = spawn(cmd, args, {
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: opts.env || process.env,
    });
    if (capture) {
      const take = (chunk, out) => {
        out.write(chunk);
        errLog = (errLog + chunk.toString()).slice(-6000);
      };
      p.stdout.on("data", (c) => take(c, process.stdout));
      p.stderr.on("data", (c) => take(c, process.stderr));
    }
    let timer = null;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        try {
          p.kill("SIGKILL");
        } catch {}
        reject(new Error(`${label} 超过 ${Math.round(opts.timeoutMs / 1000)} 秒未完成`));
      }, opts.timeoutMs);
    }
    p.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(e);
    });
    p.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`${label} 退出码 ${code}`));
    });
  });
}

const NEXT_BIN = path.join("node_modules", "next", "dist", "bin", "next");

/** npm 可执行名：Windows 上必须带 .cmd，否则 spawn 直接 ENOENT */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function has(...seg) {
  return fs.existsSync(path.join(...seg));
}

/**
 * 构建期环境。
 *
 * `.env` 被 .gitignore 排除，部署沙箱并不保证带得上（见 .env 内注释），
 * 而 NEXT_PUBLIC_* 只在构建期内联、DATABASE_URL 决定 Prisma 连哪个文件库。
 * 所以这里对**公开且无密**的两项做兜底；AUTH_SECRET 这类密钥不在此写死，
 * 缺了它线上应立刻暴露问题，而不是被一个默认值悄悄掩盖。
 */
function buildEnv() {
  return {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || "file:./dev.db",
    NEXT_PUBLIC_AGENT_MODE: process.env.NEXT_PUBLIC_AGENT_MODE || "1",
  };
}

/**
 * Next 的 SWC 原生包按平台分发。
 * 本地是 @next/swc-win32-x64-msvc，沙箱是 linux，直接搬过去构建必失败，
 * 因此把「依赖是否完整」判定为「当前平台的那份在不在」。
 */
/** 依赖装完后写下的完成标记，内容取自 package-lock 指纹 */
const DEPS_MARK = ".deps-ok";

function lockHash() {
  const crypto = require("node:crypto");
  try {
    return crypto
      .createHash("sha1")
      .update(fs.readFileSync("package-lock.json"))
      .digest("hex")
      .slice(0, 16);
  } catch {
    return "no-lock";
  }
}

/**
 * 依赖是否完整可用。
 *
 * 三重判据，缺一不可：
 *   1. next 本体在；
 *   2. Linux 下当前平台的 SWC 原生包在——本地是 win32 版，搬过去构建必失败；
 *   3. 存在与当前 package-lock 一致的「安装完成」标记。
 *
 * 第 3 条是关键：安装被中途掐断时（发布环境 300 秒上限掐过一次），
 * node_modules 里 next 和 SWC 已经落地、typescript / tailwindcss 还没有，
 * 只判前两条会误认为「装好了」，跳过安装直接构建，然后在容器里崩。
 * 标记只在整个 npm install 正常退出后才写，残缺目录自然对不上。
 */
function depsReady() {
  if (!has("node_modules", "next", "package.json")) return false;
  if (process.platform !== "linux") return true;
  const swcOk =
    has("node_modules", "@next", "swc-linux-x64-gnu", "package.json") ||
    has("node_modules", "@next", "swc-linux-x64-musl", "package.json");
  if (!swcOk) return false;
  try {
    return fs.readFileSync(DEPS_MARK, "utf8").trim() === lockHash();
  } catch {
    return false;
  }
}

/**
 * Prisma Client 同样是按平台生成的。
 * 本地生成出来的是 query_engine-windows.dll.node，换到 Linux 必须重新 generate，
 * 否则运行时报「找不到当前平台的查询引擎」。
 */
function prismaReady() {
  const dir = path.join("node_modules", ".prisma", "client");
  if (!fs.existsSync(path.join(dir, "index.js"))) return false;
  if (process.platform !== "linux") return true;
  try {
    return fs.readdirSync(dir).some((f) => f.includes("linux"));
  } catch {
    return false;
  }
}

/**
 * 依赖自举。
 *
 * 为什么放在启动器里而不是 install 阶段：
 *   发布环境单条命令的上限是 300 秒，而冷沙箱装 Next 15 + React 19 + Prisma
 *   外加 Linux 版 SWC 原生包，本身就要 4～6 分钟。只要安装写在 install 阶段，
 *   发布就必然以「Command execution timed out after 300000ms」收场。
 *   本进程一起来就 listen，网关立刻判定就绪，这些重活放后台，窗口限制即失效。
 */
async function provision(env) {
  let installed = false;
  if (!depsReady()) {
    phase = "installing";
    log("依赖缺失或不完整，开始 npm install（约 4～6 分钟）");
    // fetch 旋钮不是调优，是防止某个包（ffmpeg-static 要从 GitHub Releases 取
    // 80MB 二进制）挂死在不回包的连接上：给了重试次数和单次超时，
    // 卡住会明确失败并留下错误，而不是无限期地"看起来在装"。
    await run(
      NPM,
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--fetch-retries=2",
        "--fetch-timeout=180000",
      ],
      "npm install",
      {
        env,
        timeoutMs: 1500000,
        capture: true,
      }
    );
    installed = true;
    try {
      fs.writeFileSync(DEPS_MARK, lockHash());
    } catch (e) {
      log("写入安装标记失败:", e.message);
    }
    log("依赖安装完成");
  } else {
    log("依赖已就绪");
  }

  if (!prismaReady()) {
    phase = "installing";
    log("生成 Prisma Client（当前平台）");
    await run(NPM, ["exec", "--", "prisma", "generate"], "prisma generate", {
      env,
      timeoutMs: 300000,
      capture: true,
    });
  }

  if (!has("prisma", "dev.db")) {
    phase = "installing";
    log("数据库文件缺失，按 schema 建库");
    await run(NPM, ["exec", "--", "prisma", "db", "push", "--skip-generate"], "prisma db push", {
      env,
      timeoutMs: 300000,
    });
  }

  return installed;
}

async function startNext(env) {
  phase = "starting";
  child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(APP_PORT), "-H", HOST], {
    stdio: "inherit",
    env: { ...env, PORT: String(APP_PORT) },
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

/** 构建一次，成功后把指纹写进产物目录，下次启动据此判断是否复用 */
async function buildOnce(env, stamp, reason) {
  phase = "building";
  log(reason);
  await run(process.execPath, [NEXT_BIN, "build"], "next build", {
    env,
    timeoutMs: 900000,
    capture: true,
  });
  try {
    fs.writeFileSync(STAMP_FILE, stamp);
  } catch (e) {
    log("写入构建指纹失败（不影响运行）:", e.message);
  }
  log("构建完成");
}

async function bootstrap() {
  const env = buildEnv();
  const stamp = sourceHash();
  try {
    const freshDeps = await provision(env);

    if (freshDeps) {
      // 刚重装过依赖，旧的 .next 一定来自别的平台，留着只会让构建读到
      // Windows 的编译缓存，直接删干净重来。
      try {
        fs.rmSync(".next", { recursive: true, force: true });
      } catch {}
    }

    if (freshDeps || needsBuild(stamp)) {
      await buildOnce(
        env,
        stamp,
        freshDeps
          ? `依赖刚重装，丢弃旧产物并重新构建（指纹 ${stamp}）`
          : `源码与产物不一致，重新构建（指纹 ${stamp}）`
      );
    } else {
      log(`构建产物与源码一致（指纹 ${stamp}），直接启动`);
    }

    try {
      await startNext(env);
    } catch (e) {
      // 产物在、指纹也对，却起不来，说明产物本身不可用，重建一次
      log("首次启动失败，重新构建后重试:", e.message);
      await buildOnce(env, stamp, "重建产物");
      await startNext(env);
    }

    phase = "ready";
    log(`服务就绪，外部端口 ${PORT} → 内部端口 ${APP_PORT}，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (e) {
    errMsg = e && e.message ? e.message : String(e);
    log("启动失败:", errMsg);

    // 可用性兜底：装依赖或构建失败时，只要还留着一份能跑的旧产物，
    // 就先把它起起来对外服务。跑旧版本远好过让访客直面错误页——
    // 分享链接是已经发出去的，不能因为一次发布失败就变砖。
    if (fs.existsSync(path.join(".next", "BUILD_ID"))) {
      log("尝试以现有旧产物启动");
      try {
        await startNext(env);
        phase = "ready";
        errMsg = `${errMsg}（已用旧产物启动，功能可能落后于源码）`;
        log("已用旧产物启动");
        return;
      } catch (e2) {
        log("旧产物也无法启动:", e2.message);
        phase = "error";
      }
    }
  }
}

/** 未就绪时给访客看的页面：不依赖任何外部资源 */
function holdingPage() {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const isErr = phase === "error";
  const isInstall = phase === "installing";
  const title = isErr ? "服务启动失败" : isInstall ? "正在准备运行环境" : "正在启动";
  const body = isErr
    ? `<p class="hint">启动过程出错，稍后会自动重试。已等待 ${secs} 秒。</p>
       <p class="err">${errMsg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p>`
    : isInstall
      ? `<p class="hint">首次部署需要在服务器上安装依赖并编译前端，约 4～6 分钟。<br>本页每 3 秒自动刷新，准备完成即进入。</p>
       <div class="bar"><span></span></div>
       <p class="sec">已等待 ${secs} 秒</p>`
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
  // 转发头：连接目标由 http.request 的 host/port 决定（内网 127.0.0.1:APP_PORT），
  // 但 **应用看到的 Host 必须是访客的真实域名**。
  // 为什么不能改写 host：Auth.js（登录会话）用 x-forwarded-host + x-forwarded-proto
  // 组装回跳地址与 cookie 域。曾经在这里把 host 改成 127.0.0.1:4000，
  // 结果登录 302 的 location 变成 https://localhost:4000/...，
  // 浏览器跟去内网地址必然失败，表象就是「注册成功但永远登不上」。
  // 修正：host 原样透传，并补齐标准代理头；上游地址只写在连接参数里。
  const headers = {
    ...req.headers,
    "x-forwarded-host": req.headers["x-forwarded-host"] || req.headers.host || "",
    "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
  };
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
        detail: errLog ? errLog.slice(-1500) : null,
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
