#!/usr/bin/env node
/**
 * 构建指纹：把「源码内容」压成一个短哈希，写进产物目录。
 *
 * 存在的理由：
 *   发布后要判断容器里那份产物是不是当前源码编译出来的。判时间戳不行——
 *   发布流程会重新解压源码，mtime 被整体重置，永远「看起来更新」。
 *   内容哈希与解压顺序、时间无关，只有代码真变了才变。
 *
 * 谁在用：
 *   - `npm run build` 末尾调本文件写出指纹（CLI 模式）；
 *   - `server.cjs` require 本模块，启动时比对指纹决定要不要重建。
 *   两边共用同一份实现，避免算法漂移导致每次都误判重建。
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** 生产产物目录：与 next.config.ts 的 distDir 保持一致 */
const PROD_DIST = "prod-artifacts";
/** dev 产物目录，仅用于区分，不参与指纹 */
const DEV_DIST = ".next-dev";

function distDir() {
  return process.env.NODE_ENV === "development" ? DEV_DIST : PROD_DIST;
}

/** 参与指纹的入口：只认真正影响产物的文件 */
const ROOTS = ["src", "prisma/schema.prisma", "package.json", "tsconfig.json"];
const CONFIGS = ["next.config.ts", "next.config.mjs", "next.config.js"];

function sourceHash(rootDir = process.cwd()) {
  const h = crypto.createHash("sha1");
  const roots = [...ROOTS];
  for (const name of CONFIGS) {
    if (fs.existsSync(path.join(rootDir, name))) roots.push(name);
  }

  const files = [];
  const walk = (rel) => {
    const abs = path.join(rootDir, rel);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      // 子路径一律用 "/" 拼，不用 path.join：Windows 会拼出反斜杠，
      // 同一份代码在两台机器上就会算出两个不同的指纹，
      // 产物跨平台复用时会永远被判成"过期"而反复重建。
      for (const e of fs.readdirSync(abs).sort()) walk(`${rel}/${e}`);
    } else {
      files.push(rel);
    }
  };
  roots.forEach(walk);
  // 排序也用规范路径，保证 Windows / Linux 顺序一致
  files.sort();

  for (const rel of files) {
    h.update(rel);
    try {
      h.update(fs.readFileSync(path.join(rootDir, rel)));
    } catch {}
  }
  return h.digest("hex").slice(0, 16);
}

function stampPath(rootDir = process.cwd()) {
  return path.join(rootDir, distDir(), "BUILD_STAMP");
}

function writeStamp(hash, rootDir = process.cwd()) {
  const target = stampPath(rootDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, hash);
  return target;
}

/** 读指纹：产物不存在或没写过指纹都返回 null，调用方按「需重建」处理 */
function readStamp(rootDir = process.cwd()) {
  try {
    return fs.readFileSync(stampPath(rootDir), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/**
 * 删掉构建缓存目录。
 *
 * 产物本身只有 13MB，但 `.next-prod/cache` 有 700MB 左右（webpack 增量缓存）。
 * 发布是把目录整个上传的，不清就得多传 700MB，还容易被判为超限。
 * cache 只服务「下一次构建更快」，不影响 `next start`。
 */
function dropCache(rootDir = process.cwd()) {
  const target = path.join(rootDir, distDir(), "cache");
  if (!fs.existsSync(target)) return 0;
  const before = dirSize(target);
  fs.rmSync(target, { recursive: true, force: true });
  return before;
}

function dirSize(p) {
  let total = 0;
  const walk = (cur) => {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        try {
          total += fs.statSync(abs).size;
        } catch {}
      }
    }
  };
  walk(p);
  return total;
}

module.exports = {
  sourceHash,
  writeStamp,
  readStamp,
  stampPath,
  dropCache,
  dirSize,
  distDir,
  PROD_DIST,
};

if (require.main === module) {
  const hash = sourceHash();
  const target = writeStamp(hash);
  console.log(`[build-stamp] 指纹 ${hash} → ${path.relative(process.cwd(), target)}`);

  if (!process.argv.includes("--keep-cache")) {
    const freed = dropCache();
    if (freed) {
      console.log(`[build-stamp] 已清理构建缓存 ${(freed / 1024 / 1024).toFixed(0)}MB`);
    }
  }
}
