/**
 * 把当前 dev.db 固化成 prisma/seed.db —— 部署时用作「首次初始化」的干净种子。
 *
 * 为什么要单独一份：dev.db 会被本地调试/测试写入脏数据，直接拿去当种子，
 * 线上一上线就带着测试留言和测试生词。seed.db 只在明确重置后重新生成。
 *
 * 用法：npm run db:reset && npm run db:snapshot
 */
import fs from "node:fs";
import path from "node:path";

const dev = path.join(process.cwd(), "prisma", "dev.db");
const seed = path.join(process.cwd(), "prisma", "seed.db");

if (!fs.existsSync(dev)) {
  console.error("[snapshot-seed] 找不到 prisma/dev.db，先跑 npm run db:reset");
  process.exit(1);
}

fs.copyFileSync(dev, seed);
// 带上 WAL 时把脏页合并进主文件，避免种子里缺数据
for (const suffix of ["-wal", "-shm"]) {
  fs.rmSync(`${seed}${suffix}`, { force: true });
}

const size = (fs.statSync(seed).size / 1024).toFixed(0);
console.log(`[snapshot-seed] 已生成 prisma/seed.db（${size} KB）`);
