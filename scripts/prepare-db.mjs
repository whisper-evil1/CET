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
 *   3. 之后只做 schema 增量同步，绝不覆盖已有数据；
 *   4. 需要清零时显式传 --reset。
 *
 * 用法（在 installCmd / startCmd 里）：
 *   eval "$(node scripts/prepare-db.mjs)"
 * 输出形如：
 *   export DATABASE_URL='file:/root/.cet-data/cet.db'
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const reset = process.argv.includes("--reset");
const quiet = process.argv.includes("--quiet");

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
/** Prisma 的 SQLite URL 在 Windows 上也不吃反斜杠，统一正斜杠 */
const dbUrlPath = dbPath.replace(/\\/g, "/");

function log(...args) {
  if (!quiet) console.error("[prepare-db]", ...args);
}

fs.mkdirSync(dataDir, { recursive: true });

if (reset && fs.existsSync(dbPath)) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  log("已按 --reset 清除运行时库");
}

if (!fs.existsSync(dbPath)) {
  // 优先用专门的干净种子；没有就退回开发库
  const candidates = [
    path.join(process.cwd(), "prisma", "seed.db"),
    path.join(process.cwd(), "prisma", "dev.db"),
  ];
  const source = candidates.find((p) => fs.existsSync(p));
  if (!source) {
    log("找不到种子库（prisma/seed.db 或 prisma/dev.db），将创建一个空库");
    fs.writeFileSync(dbPath, "");
  } else {
    fs.copyFileSync(source, dbPath);
    // WAL 文件不是必须的，拷过去反而可能带来脏页
    log(`首次初始化：从 ${path.basename(source)} 复制到 ${dbPath}`);
  }
} else {
  log(`沿用已有运行时库：${dbPath}（数据保留）`);
}

// 交给 shell 执行：eval "$(node scripts/prepare-db.mjs)"
process.stdout.write(`export DATABASE_URL='file:${dbUrlPath}'\n`);
