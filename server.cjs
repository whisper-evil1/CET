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
 * 构建指纹与产物目录：与 `npm run build` 共用同一份实现。
 * 各写一套算法迟早会漂移，一漂移就变成「每次都重建」或「发旧包」。
 */
const { sourceHash, writeStamp, readStamp, distDir, dropCache } = require(
  "./scripts/build-stamp.cjs"
);

const DIST = distDir();
const BUILD_ID_FILE = path.join(DIST, "BUILD_ID");

/**
 * 是否还需要构建。
 *
 * 判据是「产物在 + 指纹对得上」，两个条件缺一不可：
 *   只判存在 —— 沙箱会保留上一次的产物，新代码上传后照样跑旧包，
 *              表象就是「发布成功但线上还是旧版」（本工程踩过两次）。
 *   只判指纹 —— 产物可能被清掉，指纹文件也随之消失，得靠存在性兜住。
 *
 * 产物随源码一起发布时，指纹由 `npm run build` 写入，容器里读到就一致，
 * 于是冷启动直接 `next start`，访客不必等那 30 秒编译。
 */
function needsBuild(stamp) {
  if (!fs.existsSync(BUILD_ID_FILE)) return true;
  const saved = readStamp();
  return !saved || saved !== stamp;
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
    writeStamp(stamp);
  } catch (e) {
    log("写入构建指纹失败（不影响运行）:", e.message);
  }
  // 容器里不需要增量缓存，留着只占磁盘
  try {
    dropCache();
  } catch {}
  log("构建完成");
}

/**
 * 随包产物：构建结果打成的单个压缩包。
 *
 * 为什么是压缩包而不是直接带目录：
 *   部署只上传 git 跟踪的普通文件，且会主动跳过"构建产物"形态的目录
 *   （实测 prod-artifacts 491 个文件已入库、未被 gitignore，容器里仍然拿不到）。
 *   换成单个文件之后就不再受目录级排除影响，3MB 一次传完，
 *   容器解压 1～2 秒即可 `next start`，省掉 30～55 秒现场编译。
 */
const BUNDLE = "app-bundle.tar.gz";

/**
 * 从随包产物恢复。返回 true 表示产物可用。
 * 解压失败不抛错——退回现场构建，功能不受影响，只是慢一点。
 */
async function restoreBundle(env) {
  if (fs.existsSync(BUILD_ID_FILE)) return true;
  if (!fs.existsSync(BUNDLE)) return false;

  phase = "installing";
  log(`产物缺失，从 ${BUNDLE} 解压`);
  try {
    await run("tar", ["-xzf", BUNDLE, "-C", "."], "解压产物", {
      env,
      timeoutMs: 180000,
      capture: true,
    });
  } catch (e) {
    log("解压失败，改为现场构建:", e.message);
    return false;
  }
  const ok = fs.existsSync(BUILD_ID_FILE);
  log(ok ? "产物已恢复" : "解压后仍无产物，改为现场构建");
  return ok;
}

async function bootstrap() {
  const env = buildEnv();
  const stamp = sourceHash();
  try {
    const freshDeps = await provision(env);

    if (freshDeps) {
      // 刚重装过依赖，旧产物一定来自别的平台，留着只会让构建读到
      // Windows 的编译缓存，直接删干净重来。
      try {
        fs.rmSync(DIST, { recursive: true, force: true });
      } catch {}
    }

    // 先用随包产物顶上，能解出来就不编译
    await restoreBundle(env);

    if (needsBuild(stamp)) {
      await buildOnce(
        env,
        stamp,
        freshDeps
          ? `依赖刚重装，丢弃旧产物并重新构建（指纹 ${stamp}）`
          : `源码与产物不一致，重新构建（指纹 ${stamp}）`
      );
    } else {
      log(`产物与源码一致（指纹 ${stamp}），跳过构建直接启动`);
    }

    try {
      await startNext(env);
    } catch (e) {
      // 产物在、指纹也对，却起不来：多半是别的平台编译的产物在本机跑不动，
      // 先删掉再重建，不能让坏的产物一直挡路。
      log("首次启动失败，丢弃产物并重建:", e.message);
      try {
        fs.rmSync(DIST, { recursive: true, force: true });
      } catch {}
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
    if (fs.existsSync(BUILD_ID_FILE)) {
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

/**
 * 未就绪时给访客看的页面：不依赖任何外部资源。
 *
 * 早先这里用 `<meta http-equiv="refresh" content="3">` 整页刷新，问题有三：
 *   1. 每次刷新整页重绘，白屏闪一下，等待感被放大；
 *   2. 进度条动画从头开始，看着像卡死；
 *   3. 「已等待 N 秒」跟着页面重载归零，越看越慌。
 * 改成页面内轮询 `/__boot`：不刷新、不清零、进度按阶段单调推进，
 * 就绪后自动跳回原地址，全程只有一个页面。
 */
function holdingPage() {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const esc = (s) =>
    String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>正在启动 · 左文右题</title>
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
  .hint { font-size: 14px; line-height: 1.85; color: #4a4640; min-height: 44px; }
  .steps { list-style: none; text-align: left; max-width: 240px; margin: 20px auto 0; }
  .steps li {
    position: relative; padding-left: 22px; font-size: 13.5px; line-height: 2.15;
    color: #b3aca1; transition: color .3s;
  }
  .steps li::before {
    content: ""; position: absolute; left: 4px; top: 13px;
    width: 7px; height: 7px; border-radius: 50%; background: #e0dad0; transition: background .3s;
  }
  .steps li.on { color: #17181a; font-weight: 600; }
  .steps li.on::before { background: #a6392b; box-shadow: 0 0 0 3px rgba(166, 57, 43, .14); }
  .steps li.done { color: #8a8479; }
  .steps li.done::before { background: #a6392b; opacity: .45; }
  .steps li.done::after { content: "✓"; position: absolute; left: 1px; top: 5px; font-size: 11px; color: #fff; }
  .bar { height: 3px; background: #eee9df; border-radius: 2px; overflow: hidden; margin: 22px 0 12px; }
  .bar span { display: block; height: 100%; width: 6%; background: #a6392b; border-radius: 2px;
    transition: width .6s linear; }
  .sec { font-size: 12px; color: #8a8479; }
  .sec b { font-weight: 600; color: #4a4640; font-variant-numeric: tabular-nums; }
  .err { margin-top: 12px; font-size: 12px; color: #a6392b; word-break: break-all; }
</style>
</head>
<body>
  <div class="card">
    <div class="mark">左文右题</div>
    <h1 id="title">正在启动</h1>
    <p class="sub">CET 四六级阅读练习工具</p>
    <p class="hint" id="hint">正在初始化服务…</p>
    <ol class="steps" id="steps">
      <li data-k="installing">准备运行环境</li>
      <li data-k="building">编译前端</li>
      <li data-k="starting">启动服务</li>
    </ol>
    <div class="bar"><span id="bar"></span></div>
    <p class="sec">已等待 <b id="secs">${secs}</b> 秒</p>
    <p class="err" id="err" hidden>${esc(errMsg)}</p>
  </div>
<script>
(function () {
  var q = location.search || "";
  var title = document.getElementById("title");
  var hint = document.getElementById("hint");
  var bar = document.getElementById("bar");
  var secs = document.getElementById("secs");
  var errBox = document.getElementById("err");
  var items = [].slice.call(document.querySelectorAll("#steps li"));
  var ORDER = ["installing", "building", "starting"];
  var TITLE = {
    boot: "正在启动",
    installing: "正在准备运行环境",
    building: "正在编译前端",
    starting: "正在启动服务",
    error: "正在重试"
  };
  var HINT = {
    boot: "正在初始化服务…",
    installing: "首次部署需要在服务器上安装依赖，通常 3～5 分钟；装好之后的重启只要几秒。",
    building: "正在编译前端，约 30 秒。",
    starting: "正在启动服务，马上就好。"
  };
  var last = "boot";

  function progress(phase, t) {
    if (phase === "installing") return Math.min(58, 8 + 50 * (1 - Math.exp(-t / 240)));
    if (phase === "building") return Math.min(93, 62 + 31 * (1 - Math.exp(-t / 50)));
    if (phase === "starting") return Math.min(99, 94 + 5 * (1 - Math.exp(-t / 12)));
    return 8;
  }

  function paint(j) {
    var shown = j.phase === "error" ? last : j.phase;
    var idx = ORDER.indexOf(shown);
    title.textContent = TITLE[j.phase] || TITLE.boot;
    hint.textContent = HINT[shown] || HINT.boot;
    for (var i = 0; i < items.length; i++) {
      items[i].className = i < idx ? "done" : i === idx ? "on" : "";
    }
    bar.style.width = progress(shown, j.elapsedSec || 0).toFixed(1) + "%";
    secs.textContent = Math.round(j.elapsedSec || 0);
    if (j.error) {
      errBox.hidden = false;
      errBox.textContent = j.error;
    }
    if (idx >= 0) last = shown;
  }

  function enter() {
    bar.style.width = "100%";
    hint.textContent = "已就绪，正在进入…";
    setTimeout(function () { location.replace(location.pathname + q); }, 260);
  }

  function tick() {
    fetch("/__boot" + q, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ready) { enter(); return; }
        paint(j);
        setTimeout(tick, 1200);
      })
      .catch(function () { setTimeout(tick, 2500); });
  }

  tick();
})();
</script>
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
        // 产物来源：distReady=false 说明产物没随包上来，本进程正在现场编译；
        // stamp 是当前源码的指纹，与 dist 里保存的对比即可判断是不是旧包。
        dist: DIST,
        distReady: fs.existsSync(BUILD_ID_FILE),
        stamp: readStamp(),
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
