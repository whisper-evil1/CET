// 部署前清理：云端沙箱是"增量上传 + 复用旧沙箱"，本地删掉的文件在沙箱里不会被删除，
// 早期原型部署残留的死文件会跟着一起参与编译并导致 next build 失败。
//
// 做法：读取【本地部署前生成】的 scripts/src-manifest.json（当前代码树里真实存在的 src 文件清单），
// 扫描沙箱内的 src，凡是不在清单里的文件一律删除。
//
// 为什么用清单文件而不是硬编码数组：硬编码会随代码演进漂移，曾把新增的
// api/leaderboard、api/checkin、components/leaderboard/* 当成残留文件误删，直接导致构建失败。
// 清单由 `node scripts/gen-src-manifest.mjs` 在部署前生成，永远与当前代码一致。
//
// 若清单缺失则跳过清理（宁可构建报错暴露问题，也不误删有效文件）。
import { readdirSync, statSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "src");
const MANIFEST = join(__dirname, "src-manifest.json");

if (!existsSync(SRC_DIR)) {
  console.log("[clean-stale] src not found, skip");
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.log("[clean-stale] manifest missing, skip cleanup (run scripts/gen-src-manifest.mjs before deploy)");
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.log("[clean-stale] manifest unreadable, skip cleanup:", e.message);
  process.exit(0);
}

if (!Array.isArray(manifest) || manifest.length === 0) {
  console.log("[clean-stale] manifest empty, skip cleanup");
  process.exit(0);
}

const ALLOW = new Set(manifest);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let removed = 0;
for (const file of walk(SRC_DIR)) {
  const rel = relative(SRC_DIR, file).split("\\").join("/");
  if (!ALLOW.has(rel)) {
    rmSync(file, { force: true });
    // 顺手清理已空的父目录（最多上溯 4 层，不越过 src）
    let parent = dirname(file);
    for (let i = 0; i < 4; i++) {
      if (parent === SRC_DIR || !parent.startsWith(SRC_DIR)) break;
      try {
        if (readdirSync(parent).length === 0) {
          rmSync(parent, { recursive: true, force: true });
          parent = dirname(parent);
        } else break;
      } catch {
        break;
      }
    }
    console.log(`[clean-stale] removed stale: ${rel}`);
    removed += 1;
  }
}
console.log(`[clean-stale] done, allowlist=${ALLOW.size}, removed ${removed} stale file(s)`);
