/**
 * 构建产物是否与源码一致 —— 靠「源码内容指纹」判断，而不是靠产物在不在。
 *
 * 踩过的坑：
 *   发布平台会复用上一次的沙箱，里面的 .next 不会被清掉。启动器原来只检查
 *   .next/BUILD_ID 存不存在，于是永远认为「已经构建过」，接着用旧产物跑 ——
 *   表现出来就是「代码改了、部署显示成功、线上行为一点没变」。
 *   之前 seed.db 上不去线上也是同一类问题（沙箱里的旧文件比上传的新源码更"权威"）。
 *
 * 为什么用内容哈希而不是时间戳：
 *   发布流程解压源码时会把 mtime 重置成解压时间，用「谁更新」判断必然误判成过期，
 *   结果每次重启都白建一遍。内容不会变，所以哈希是可靠的。
 *
 * 为什么需要 stamp 文件：
 *   BUILD_ID 只说明「构建过」，不说明「用哪份源码构建的」。构建成功后把指纹写进
 *   .next/.src-hash，下次启动一比对就知道要不要重建。
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIST = process.env.NEXT_DIST_DIR?.trim() || ".next";
const STAMP = path.join(DIST, ".src-hash");

/** 参与指纹的路径：只挑「改动后必须重新编译」的，避免把数据文件也算进去拖慢启动 */
const ROOTS = [
  "src",
  "public",
  "prisma/schema.prisma",
  "prisma/seed.ts",
  "package.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "server.cjs",
  // 发布前由 scripts/bump-build-nonce.mjs 改写：指纹必变 → 沙箱必重建
  "scripts/build-nonce.txt",
];

/** 无关键，跳过 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".next-v1", ".next-v2", ".next-v3", ".next-v4", ".next-v5", ".next-v6"]);

function collect(target, out) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    const base = path.basename(target);
    if (SKIP_DIRS.has(base) || base.startsWith(".next")) return;
    for (const name of fs.readdirSync(target).sort()) {
      collect(path.join(target, name), out);
    }
    return;
  }
  out.push(target);
}

/** 返回源码内容指纹（16 位十六进制） */
function sourceFingerprint() {
  const files = [];
  for (const root of ROOTS) collect(root, files);
  files.sort();

  const hash = crypto.createHash("sha1");
  for (const file of files) {
    hash.update(file);
    try {
      hash.update(fs.readFileSync(file));
    } catch {
      // 读不到就只把路径计入，至少能在文件增删时触发重建
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/** 是否需要重新构建 */
function needsBuild() {
  if (!fs.existsSync(path.join(DIST, "BUILD_ID"))) return true;
  if (!fs.existsSync(STAMP)) {
    // 有产物但没有指纹：不知道是哪份源码建的，当作不可信，重建一次
    return true;
  }
  return fs.readFileSync(STAMP, "utf8").trim() !== sourceFingerprint();
}

/**
 * 构建成功后落指纹。
 * 允许传入别的产物目录（热切换会先构建到 `<dist>-hot` 再整目录换上去），
 * 这样指纹跟着产物走，换完目录下次启动比对才不会误判成「源码又变了」。
 */
function writeStamp(distDir) {
  const dir = distDir || DIST;
  fs.mkdirSync(dir, { recursive: true });
  const fp = sourceFingerprint();
  fs.writeFileSync(path.join(dir, ".src-hash"), fp);
  return fp;
}

module.exports = { DIST, STAMP, ROOTS, sourceFingerprint, needsBuild, writeStamp };
