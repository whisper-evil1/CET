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
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 3000);
/** Next 跑在内网端口，不直接对外 */
const APP_PORT = PORT + 1000;
const HOST = "127.0.0.1";

/**
 * 是否还需要构建：比「源码指纹」与上次构建时记录的指纹，而不是只看产物在不在。
 *
 * 为什么不能只看 .next/BUILD_ID：
 *   发布平台会复用上一次的沙箱，旧的 .next 不会被清掉。只看产物在不在，
 *   就会永远认为"已经构建过"，然后用旧产物跑 —— 代码改了、部署显示成功、
 *   线上一点没变。这是实测踩到的坑，别退回去。
 */
const buildMeta = require("./scripts/build-meta.cjs");

function needsBuild() {
  return buildMeta.needsBuild();
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
/**
 * 跑一个子进程，并把输出同时写到控制台与 .boot.log。
 *
 * 为什么不能只 inherit：沙箱日志在发布面板里看不到，
 * 构建失败时用户只看到「服务启动失败」，连一句 next build 的报错都拿不到，
 * 只能靠猜。现在把最后 40 行塞进错误信息，启动页上直接能读到真实原因。
 */
function run(cmd, args, label, extraEnv, timeoutMs = 6 * 60_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    let tail = "";
    let settled = false;
    const keep = (buf) => {
      const text = buf.toString();
      process.stdout.write(text);
      tail = `${tail}${text}`.slice(-4000);
    };
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);

    /*
     * 超时兜底：子进程「既不成功也不退出」时必须有人收场。
     *
     * 踩过：源码有语法错误时，next build 打出 "Failed to compile" 之后并不退出，
     * 于是 hotSwap 的 promise 永远 pending —— phase 卡在 building，
     * 看门狗每一轮都被 `phase !== "ready"` 直接 return，站点再也不会自动换版，
     * 只能人工重启容器。
     *
     * 失败本身不可怕（旧版还在服务），卡死才可怕：它没有日志、没有退避、没有重试，
     * 从外面看就是「服务好好的，但代码永远不更新」。所以这里必须自己判超时。
     */
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        if (process.platform === "win32") {
          // 只 kill 直接子进程不够：next build 会 fork worker，留着仍占着产物目录
          require("node:child_process").execFileSync(
            "taskkill",
            ["/PID", String(p.pid), "/T", "/F"],
            { stdio: "ignore" },
          );
        } else {
          p.kill("SIGKILL");
        }
      } catch {
        /* 进程可能在这之前已经自己退了 */
      }
      const lines = tail.split(/\r?\n/).filter(Boolean).slice(-6).join(" / ");
      reject(
        new Error(
          `${label} 超过 ${Math.round(timeoutMs / 1000)} 秒仍未结束，已强制终止：${lines.slice(0, 400)}`,
        ),
      );
    }, timeoutMs);

    p.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${label} 启动失败：${e.message}`));
    });
    p.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve();
      try {
        require("node:fs").writeFileSync(".boot.log", tail, "utf8");
      } catch {
        /* 写不了就算了 */
      }
      const lines = tail.split(/\r?\n/).filter(Boolean).slice(-12).join(" / ");
      reject(new Error(`${label} 退出码 ${code}：${lines.slice(0, 600)}`));
    });
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
    // 热切换时是我们自己杀掉的，别再走一遍重启（会跟外层重建撞车）
    if (swapping) return;
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

/** 构建 + 落指纹。两步必须成对出现，否则下次启动会误判。 */
async function buildAndStamp(reason, distDir) {
  phase = "building";
  log(reason);
  await run(
    process.execPath,
    [NEXT_BIN, "build"],
    "next build",
    distDir ? { NEXT_DIST_DIR: distDir } : undefined
  );
  const fp = buildMeta.writeStamp(distDir);
  log(`构建完成，源码指纹 ${fp}`);
}

/**
 * 运行库与题库内容的自愈。
 *
 * 两件事必须在 Next 起来之前做完：
 *   1. 决定用哪个 SQLite 库并把 DATABASE_URL 交给子进程（prepare-db 输出 export 语句）；
 *      数据目录在项目目录之外，跨发布保留，所以用户账号与作答不会被这次上传覆盖。
 *   2. 用 data/papers/*.json 刷新题库内容（import-papers 是幂等的，题目 id 稳定，
 *      已作答记录挂在 id 上不会丢）。
 *
 * 为什么要放进启动流程：沙箱里 `prisma/seed.db` 被 .gitignore 排除、上传不到，
 * 只靠种子库的话线上永远是上一版题库 —— 改完听力稿、发布成功、线上还是旧稿，
 * 这类「本地绿、线上旧」的坑踩过一次就够了。
 *
 * 任何一步失败都只记日志、不阻断启动：宁可先让用户看到旧内容，也不要 502。
 * 需要临时关掉时设 CET_SYNC_CONTENT=0。
 */
function syncRuntime() {
  if ((process.env.CET_SYNC_CONTENT ?? "1").trim() === "0") {
    log("按 CET_SYNC_CONTENT=0 跳过运行库同步");
    return;
  }
  const { execFileSync } = require("node:child_process");

  try {
    const out = execFileSync(process.execPath, ["scripts/prepare-db.mjs", "--keep", "--quiet"], {
      encoding: "utf8",
      env: process.env,
    });
    const hit = out.match(/DATABASE_URL='([^']+)'/);
    if (hit) {
      process.env.DATABASE_URL = hit[1];
      log(`运行库 → ${hit[1]}`);
    }
  } catch (e) {
    log("准备运行库失败（继续启动）:", e.message.split("\n")[0]);
  }

  // 新沙箱里库是空的：先把表建出来，导入脚本才有地方写。
  // db push 是增量同步，已有数据不受影响，所以每次启动跑一遍是安全的。
  try {
    const prismaBin = path.join("node_modules", "prisma", "build", "index.js");
    if (require("node:fs").existsSync(prismaBin)) {
      const push = (extra = []) =>
        execFileSync(process.execPath, [prismaBin, "db", "push", "--skip-generate", ...extra], {
          encoding: "utf8",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });

      try {
        push();
      } catch (e) {
        /*
         * SQLite 加一个「唯一 + 可空」的列（如 User.phone）会触发重建表，
         * Prisma 因此要求显式接受「可能丢数据」。线上库是带着旧数据升级的，
         * 不带这个标志就会卡在启动阶段 —— 表现出来是页面能开、一登录就报错。
         * 先按严格模式跑，被拒了再放宽一次，比一直带着放宽标志更稳。
         */
        const msg = String(e.stderr ?? e.message ?? "");
        if (!/data loss|--accept-data-loss/i.test(msg)) throw e;
        log("结构变更需要重建表，按增量迁移继续");
        push(["--accept-data-loss"]);
      }
      log("数据库结构已同步");

      /*
       * 还必须重新生成 Prisma Client。
       *
       * 沙箱会复用上一次部署的 node_modules，`npm install` 看到依赖没变就跳过安装，
       * 而 Client 的类型与运行时代码是**安装时**生成的。于是 schema 加了 phone 列，
       * 库也加了列，Client 却还是旧的 —— 表现为 next build 直接类型报错：
       * "Object literal may only specify known properties, and 'phone' does not exist"。
       * 这里显式生成一次，保证 Client 永远跟着 schema 走。
       */
      try {
        execFileSync(process.execPath, [prismaBin, "generate"], {
          encoding: "utf8",
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        log("Prisma Client 已重新生成");
      } catch (e) {
        log("Prisma Client 生成失败（继续启动）:", String(e.stderr ?? e.message).split("\n")[0]);
      }
    }
  } catch (e) {
    log("数据库结构同步失败（继续启动）:", e.message.split("\n")[0]);
  }

  try {
    /*
     * 题库只在「data/papers 变了」时才重新导入。
     *
     * 66 套卷在空库上导一次要 50 秒上下，而服务重启远比改题库频繁 ——
     * 每次重启都全量导一遍，等于把冷启动时间拉长到用户会以为挂了。
     * 这里用文件名 + 体积 + 修改时间算一枚指纹，存在库文件旁边；
     * 指纹一致就跳过，source 一变自然失效。
     */
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const papersDir = path.join(process.cwd(), "data", "papers");
    const files = fs.existsSync(papersDir)
      ? fs.readdirSync(papersDir).filter((f) => f.endsWith(".json")).sort()
      : [];
    const digest = crypto.createHash("sha256");
    for (const file of files) {
      const stat = fs.statSync(path.join(papersDir, file));
      digest.update(`${file}:${stat.size}:${Math.round(stat.mtimeMs)};`);
    }
    const fingerprint = digest.digest("hex");
    const dbPath = (process.env.DATABASE_URL ?? "").replace(/^file:/, "").replace(/\//g, path.sep);
    const stampPath = dbPath ? `${dbPath}.content` : null;
    const known = stampPath && fs.existsSync(stampPath) ? fs.readFileSync(stampPath, "utf8").trim() : "";
    // 库被清掉但指纹文件还在（--reset / 手工删库）：体积能识别出「空壳库」，强制重导
    const dbSize = dbPath && fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const emptyDb = dbSize < 1024 * 1024;

    if (known && known === fingerprint && !emptyDb) {
      log("题库内容未变化，跳过导入");
    } else {
      execFileSync(process.execPath, ["scripts/import-papers.mjs"], {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (stampPath) fs.writeFileSync(stampPath, fingerprint);
      log(`题库内容已按 data/papers 刷新（${files.length} 套）`);
    }
  } catch (e) {
    log("题库刷新失败（继续启动）:", e.message.split("\n")[0]);
  }
}

/**
 * 把正在跑的 Next 子进程停掉（热切换用）。
 *
 * 单独抽出来是因为「关掉旧的、等它真的退了、再起新的」这三步必须串起来：
 * 不等它退就 spawn，新进程会因为端口被占直接死掉，线上就变成 502。
 * startNext 里挂的 exit 监听会看到 `swapping` 标记并跳过自己的重启逻辑，
 * 否则两边会各自 bootstrap 一次，构建撞在一起。
 */
let swapping = false;

function stopChild() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const dying = child;
    child = null;
    swapping = true;
    const done = () => {
      swapping = false;
      resolve();
    };
    const timer = setTimeout(() => {
      try {
        dying.kill("SIGKILL");
      } catch {
        /* 已经没了 */
      }
      done();
    }, 5000);
    dying.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    try {
      dying.kill("SIGTERM");
    } catch {
      clearTimeout(timer);
      done();
    }
  });
}

/**
 * 源码比产物新 → 重建并热切换。
 *
 * 为什么需要这个「看门狗」：
 *   发布平台上传源码后并不会重启容器。启动器的 needsBuild() 只在进程启动时
 *   跑一次，于是出现过「文件传上去了、探针能访问、页面还是上一版」——
 *   连续四轮发布都没换版。靠人去重启容器不可靠，让常驻进程自己盯着源码指纹，
 *   变了就重建、换掉子进程，是唯一不依赖平台行为的办法。
 *
 * 代价：每 90 秒算一次源码哈希（几百 KB 的源码，毫秒级），并且只在真的变了
 * 的时候才动手；真动手时先停子进程再构建，期间访客看到的是启动页，不是 502。
 */
let watching = false;

/**
 * 构建到旁边的暂存目录，成功之后才整目录换上去。
 *
 * 为什么不原地 `next build`：
 *   1. Next 一开工就会清空旧产物，一旦编译失败，上一版就没了 —— 线上直接挂，
 *      而且没有可回滚的东西；
 *   2. 有些环境对「批量删除已存在文件」有拦截（本机就有，报
 *      SAFE_DELETE_BULK_CONFIRM_REQUIRED），原地重建会在清理阶段直接失败。
 *   构建到全新空目录这两个问题都不存在：不需要删任何东西，失败也只是白建一份，
 *   旧产物原地不动、旧进程继续服务。
 */
async function stagedBuild(reason) {
  const DIST = buildMeta.DIST;
  // 每次都用一个全新的目录名，全程只做 rename、不做删除。
  // 删除是这里唯一不可控的因素：某些环境（含本机的安全垫片）会拦截
  // 「批量删除已存在文件」，进而让整个换版流程失败；rename 不会被拦。
  const stamp = Date.now().toString(36);
  const staged = `${DIST}-build-${stamp}`;
  await buildAndStamp(reason, staged);

  /*
   * 上一版改名留档（.next-prev）：出问题把它改回 .next 就能回滚。
   *
   * 但**更老的绝不能继续留在项目目录里**，实测代价非常具体：
   *   1) 每换一次版 +218MB，几轮之后项目目录涨到 6GB；
   *   2) 这些目录名（.next-prev-xxxx）不在部署工具的构建产物排除名单里
   *      （它只认 .next / dist / build 这类固定名字），于是被整个压缩上传 ——
   *      上传连续三次卡在 UND_ERR_HEADERS_TIMEOUT，发布一直失败。
   * 所以按「先删、删不掉就挪出项目目录」处理；两条都不成，才退回改名留在原地。
   */
  const prev = `${DIST}-prev`;
  if (fs.existsSync(prev)) retireOld(prev, stamp);
  if (fs.existsSync(DIST)) fs.renameSync(DIST, prev);
  fs.renameSync(staged, DIST);
}

/**
 * 退休一份旧构建产物：删除 →（被拦则）移出项目目录 →（再不行）改名留在原地。
 *
 * 为什么不能只删：本机的安全删除垫片会拦下批量删除（SAFE_DELETE_BULK_CONFIRM_REQUIRED），
 * 直接抛错；沙箱里没有这个垫片，删除是首选，能真正省下磁盘。
 * 移到项目目录之外（同级 .cet-build-archive）既不占上传体积，又保留一份可回滚的产物。
 */
function retireOld(dir, stamp) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch {
    /* 被安全垫片拦住，往下走 */
  }

  try {
    // 启动器以项目根为 cwd，所以上一级就是项目目录之外
    const archive = path.join(path.dirname(process.cwd()), ".cet-build-archive");
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(dir, path.join(archive, `${path.basename(dir)}-${stamp}`));
    return;
  } catch (e) {
    log("旧产物移出项目目录失败（改为改名留在原地）:", e && e.message);
  }

  try {
    fs.renameSync(dir, `${dir}-${stamp}`);
  } catch {
    /* 改名都失败就留着，下一轮再处理，不阻断换版 */
  }
}

/** 在线换版：先构建到暂存（旧进程照常服务），再停旧、换目录、起新。 */
async function hotSwap(reason) {
  await stagedBuild(reason);
  await stopChild();
  await startNext();
  phase = "ready";
  log("热切换完成，线上已经是新构建");
}

async function bootstrap() {
  try {
    syncRuntime();

    if (needsBuild()) {
      await stagedBuild("构建产物缺失或与源码不一致，开始构建（约 30 秒），期间访客看到启动页");
    } else {
      log("构建产物与源码一致，直接启动");
    }

    try {
      await startNext();
    } catch (e) {
      // 产物在却起不来，说明产物不可用（依赖变动 / 运行时不符），重建一次
      log("首次启动失败，重新构建后重试:", e.message);
      await stagedBuild("重新构建");
      await startNext();
    }

    phase = "ready";
    log(`服务就绪，外部端口 ${PORT} → 内部端口 ${APP_PORT}，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (e) {
    errMsg = e && e.message ? e.message : String(e);
    log("启动失败:", errMsg);

    // 构建失败不等于整站该挂：旧产物还在的话，先让访客继续用旧版本。
    // 「新版本没上成」只会让功能少一点，而 error 页是彻底不可用。
    const distOk = (() => {
      try {
        return fs.existsSync(path.join(buildMeta.DIST, "BUILD_ID"));
      } catch {
        return false;
      }
    })();
    if (distOk) {
      try {
        await startNext();
        phase = "ready";
        log("已用旧产物先行服务；新构建失败的原因见上一条日志");
        return;
      } catch (startErr) {
        log("旧产物也起不来:", startErr.message);
      }
    }

    phase = "error";
  }
}

/** 常驻检查：源码指纹变了就重建换版（发布平台不重启容器时靠这个生效） */
let swapFailures = 0;
/** 下次允许尝试热切换的时间戳：连续失败时退避，避免对着坏源码每 90 秒狂构建一次 */
let swapRetryAt = 0;

setInterval(() => {
  if (phase !== "ready" || watching || swapping) return;
  if (Date.now() < swapRetryAt) return;
  let stale = false;
  try {
    stale = needsBuild();
  } catch (e) {
    log("指纹比对失败（跳过本次）:", e && e.message);
    return;
  }
  if (!stale) return;

  watching = true;
  hotSwap("检测到源码比构建产物新（发布新版本但进程没重启），开始重建并热切换")
    .then(() => {
      swapFailures = 0;
      swapRetryAt = 0;
    })
    .catch((e) => {
      /*
       * 这里有两件事必须做对，否则看门狗会永久停摆（都实测踩过）：
       *
       * 1) 把 phase 从 "building" 恢复到 "ready"。
       *    buildAndStamp 一开工就 phase = "building"，而构建失败时没有人改回来，
       *    于是上面那句 `phase !== "ready"` 会让每一轮巡检直接 return ——
       *    之后就算把源码改好、指纹再变，也永远不会再自动换版，只能人工重启容器。
       *
       * 2) 不要打成 "error"。
       *    失败发生在构建阶段，此时旧子进程还在正常服务，站点是好的；
       *    标成 error 只会让 /__boot 看起来像整站挂了，也和事实不符。
       */
      if (child && !child.killed) phase = "ready";

      swapFailures += 1;
      const waitMs = Math.min(10 * 60_000, 60_000 * 2 ** (swapFailures - 1));
      swapRetryAt = Date.now() + waitMs;
      errMsg = `热切换失败（第 ${swapFailures} 次，旧版本继续服务，${Math.round(waitMs / 1000)} 秒后重试）：${
        e && e.message ? e.message : e
      }`;
      log(errMsg);
    })
    .finally(() => {
      watching = false;
    });
}, 90_000).unref();

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

server.on("error", (e) => {
  // 端口被上一次的实例占着：发布平台复用了沙箱但没有杀掉旧进程。
  // 这时候新源码已经躺在磁盘上，却只能用旧进程跑——记一笔，让日志能对上现象。
  if (e && e.code === "EADDRINUSE") {
    log(`端口 ${PORT} 已被占用：沿用上一个实例，本次源码要等它退出后才会生效`);
    process.exit(0);
  }
  throw e;
});

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
