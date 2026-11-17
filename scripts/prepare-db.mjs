/**
 * 部署/启动前的数据库准备。
 *
 * 背景：沙箱每次发布都会重新上传项目目录，因此把 SQLite 放在项目目录里，
 * 每次发布都会被「本地那份」覆盖 —— 用户的作答、生词本就没了。
 * 以前的做法是把库复制到 /tmp，但每次启动又无条件覆盖一次，等于每次发布清零。
 *
 * 现在的约定：
 *   1. 运行时库放在项目目录之外的持久目录（默认 $HOME/.cet-data），跨发布保留；
 *   2. 只有库不存在时才用 prisma/seed.db（干净种子）初始化；
 *   3. 之后只做 schema 增量同步，绝不无谓覆盖已有数据；
 *   4. 需要清零时显式传 --reset。
 *
 * 题库换版怎么办：
 *   初始化/覆盖时把 seed.db 的 sha256 记到 dataDir/seed.hash。
 *   下次启动若发现 seed.db 变了，说明题库换版（题目 id 往往跟着变，旧数据已对不上新题），
 *   此时先把旧库备份成 cet.db.bak.<时间戳>（保留可人工恢复），再按新种子重建。
 *   想强制保留旧数据传 --keep，想强制清零传 --reset。
 *
 * 用法（在 installCmd / startCmd 里）：
 *   eval "$(node scripts/prepare-db.mjs)"
 * 输出形如：
 *   export DATABASE_URL='file:/root/.cet-data/cet.db'
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const reset = process.argv.includes("--reset");
const keep = process.argv.includes("--keep");
const quiet = process.argv.includes("--quiet");
/**
 * 只建空库，不从 prisma/seed.db 复制。
 *
 * 用在「种子改由源码 prisma/seed.ts 现场生成」的场景（scripts/ensure-seed.mjs）：
 * 沙箱里残留的 prisma/seed.db 可能是很早以前的旧库，复制它就会把旧题库又带回来。
 */
const emptyOnly = process.argv.includes("--empty");

/**
 * 数据目录：优先用 $CET_DATA_DIR，其次 $HOME/.cet-data（沙箱里跨发布保留），
 * 家目录不可写时退回系统临时目录，保证脚本一定能把库准备好，而不是让启动命令直接失败。
 */
function resolveDataDir() {
  const preferred = process.env.CET_DATA_DIR?.trim() || path.join(os.homedir(), ".cet-data");
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return path.join(os.tmpdir(), "cet-data");
  }
}

const dataDir = resolveDataDir();
const dbPath = path.join(dataDir, "cet.db");
const hashPath = path.join(dataDir, "seed.hash");
/** Prisma 的 SQLite URL 在 Windows 上也不吃反斜杠，统一正斜杠 */
const dbUrlPath = dbPath.replace(/\\/g, "/");

function log(...args) {
  if (!quiet) console.error("[prepare-db]", ...args);
}

/** 删掉库文件及其 WAL / SHM 边车文件 */
function removeDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** 找可用的种子库：优先专门的干净种子，其次开发库 */
function findSeed() {
  const candidates = [
    path.join(process.cwd(), "prisma", "seed.db"),
    path.join(process.cwd(), "prisma", "dev.db"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** 用种子库初始化运行时库，并记录种子指纹 */
function seedFrom(source) {
  fs.copyFileSync(source, dbPath);
  // WAL 文件不是必须的，拷过去反而可能带来脏页
  fs.writeFileSync(hashPath, sha256(source));
  log(`已从 ${path.basename(source)} 初始化运行时库 → ${dbPath}`);
}

/** 把现有库备份成带时间戳的文件，返回文件名 */
function backupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = path.join(dataDir, `cet.db.bak.${stamp}`);
  fs.copyFileSync(dbPath, target);
  return path.basename(target);
}

/**
 * 换版重建时必须原样保留的表 —— 它们跟题库无关，是用户的个人资产。
 *
 *   User            ：账号本身。丢了它，用户浏览器里的 JWT 就变成「指向空气的 id」，
 *                     之后每一次写操作都会因外键失败报错，表现为「页面能看、一点就报错」。
 *   VocabWord       ：生词本。只依赖 userId，跟题目换不换版没关系，没有任何理由丢。
 *   DictionaryEntry ：词典缓存。纯缓存，留着能省掉换版后的重新查词。
 *
 * Answer / Favorite 不保留：它们挂在 questionId 上，题目换了版就对不上新题，
 * 强行带过来只会在页面上制造孤儿记录。
 */
const PRESERVE_TABLES = ["User", "VocabWord", "DictionaryEntry"];

/**
 * 用新种子重建运行时库，同时把 PRESERVE_TABLES 从旧库搬过来。
 *
 * 实现用 node:sqlite + ATTACH：整个过程在一条连接里完成，无需额外依赖。
 * 列取两边的交集再显式列出 —— 老库可能是 v1 schema（列少几个或多几个），
 * 直接 SELECT * 会因为列数不匹配整条失败。
 *
 * 返回迁移摘要；任何一步失败都抛错，由调用方退回「整库重建」。
 */
async function rebuildPreservingUserData(seedFile, backupFile) {
  const { DatabaseSync } = await import("node:sqlite");
  const backupPath = path.join(dataDir, backupFile);
  const work = `${dbPath}.rebuild`;

  fs.rmSync(work, { force: true });
  fs.copyFileSync(seedFile, work);

  const migrated = [];
  const db = new DatabaseSync(work);
  try {
    // ATTACH 的路径里单引号要转义；Windows 反斜杠在 SQLite 里也不认
    const attachPath = backupPath.replace(/\\/g, "/").replace(/'/g, "''");
    db.exec(`ATTACH DATABASE '${attachPath}' AS old`);

    for (const table of PRESERVE_TABLES) {
      const newCols = db.prepare(`PRAGMA main.table_info("${table}")`).all().map((c) => c.name);
      const oldCols = new Set(
        db.prepare(`PRAGMA old.table_info("${table}")`).all().map((c) => c.name),
      );
      if (oldCols.size === 0) continue;

      const cols = newCols.filter((c) => oldCols.has(c));
      if (!cols.length) continue;

      const list = cols.map((c) => `"${c}"`).join(", ");
      db.exec(
        `INSERT OR IGNORE INTO main."${table}" (${list}) SELECT ${list} FROM old."${table}"`,
      );
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM main."${table}"`).get();
      migrated.push(`${table}=${n}`);
    }

    db.exec("DETACH DATABASE old");
  } finally {
    db.close();
  }

  removeDb();
  fs.renameSync(work, dbPath);
  return migrated.join(", ");
}

fs.mkdirSync(dataDir, { recursive: true });

if (reset && fs.existsSync(dbPath)) {
  removeDb();
  log("已按 --reset 清除运行时库");
}

const seed = findSeed();

if (!fs.existsSync(dbPath)) {
  if (emptyOnly) {
    fs.writeFileSync(dbPath, "");
    log("按 --empty 创建空库（种子由源码生成）");
  } else if (!seed) {
    log("找不到种子库（prisma/seed.db 或 prisma/dev.db），将创建一个空库");
    fs.writeFileSync(dbPath, "");
  } else {
    seedFrom(seed);
  }
} else {
  // 库已存在：只有种子换版时才重建，其余情况一律保留数据
  const knownHash = fs.existsSync(hashPath) ? fs.readFileSync(hashPath, "utf8").trim() : "";
  const currentHash = seed ? sha256(seed) : "";

  if (!seed) {
    log(`沿用已有运行时库：${dbPath}（数据保留）`);
  } else if (keep) {
    log(`沿用已有运行时库：${dbPath}（--keep，忽略种子变更）`);
  } else if (!knownHash) {
    // 从老版本升级上来的库没有指纹：只补记指纹，不重建，避免误清数据
    fs.writeFileSync(hashPath, currentHash);
    log(`沿用已有运行时库并补记种子指纹：${dbPath}`);
  } else if (knownHash !== currentHash) {
    const backup = backupDb();
    log(`检测到种子库换版，旧库已备份 → ${backup}`);

    /*
     * 先试着「换题库但留住账号和生词本」，失败才退回整库重建。
     *
     * 为什么值得多这一步：整库重建会让所有已登录用户的 JWT 立刻失效
     * （User 行没了），他们下次操作就会撞上外键错误 —— 这正是上一轮
     * 「页面能打开、一点就报错」那一批故障的来源。把 User/VocabWord 搬过来，
     * 用户完全无感，生词本也不用重加。
     */
    let preserved = "";
    try {
      preserved = await rebuildPreservingUserData(seed, backup);
      log(`已按新种子重建题库，用户数据已保留（${preserved}）`);
    } catch (err) {
      log(`保留用户数据失败（${err.message}），退回整库重建`);
      removeDb();
      seedFrom(seed);
    }

    // 两种情况都要更新指纹，否则下次启动会再次判定为换版
    fs.writeFileSync(hashPath, currentHash);
  } else {
    log(`沿用已有运行时库：${dbPath}（数据保留，种子未变）`);
  }
}

// 交给 shell 执行：eval "$(node scripts/prepare-db.mjs)"
process.stdout.write(`export DATABASE_URL='file:${dbUrlPath}'\n`);
