// 部署前生成 src 文件清单（白名单）。
// 必须在【本地】部署前运行：把当前代码树里真实存在的 src 文件路径写进 scripts/src-manifest.json。
// 云端 install 阶段由 clean-stale.mjs 读取该清单，删掉沙箱里不在清单内的历史残留文件。
// 这样清单永远不会和代码漂移（之前硬编码白名单曾误删新增路由）。
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = join(ROOT, "src");
const OUT = join(__dirname, "src-manifest.json");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(SRC_DIR, full).split("\\").join("/"));
  }
  return out;
}

const files = walk(SRC_DIR).sort();
writeFileSync(OUT, JSON.stringify(files, null, 2), "utf8");
console.log(`[gen-src-manifest] wrote ${files.length} files -> ${OUT}`);
