/**
 * 空库时用 prisma/seed.ts 生成题库。
 *
 * 为什么需要它：
 *   .gitignore 里排除了 prisma/seed.db（二进制种子），而发布流程同样按
 *   .gitignore 过滤上传内容 —— 于是沙箱里那份 seed.db 永远是最早部署时留下的旧库，
 *   新题库（多篇阅读、写作/翻译、听力）怎么改都上不去，线上一直显示旧题。
 *   源码 prisma/seed.ts 是会上传的，所以改成「库为空时从源码现场生成」。
 *
 * 安全性：
 *   seed.ts 对试卷是 deleteMany + create（会级联清掉作答/收藏/评论），
 *   因此这里**只在库为空时**才执行。库里有卷就跳过，部署不会重置用户数据。
 *   需要强制重建时，先让 prepare-db --reset 清库，本脚本自然就会重新生成。
 */
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

const prisma = new PrismaClient();

let paperCount = 0;
try {
  paperCount = await prisma.paper.count();
} catch (error) {
  // 表还不存在时说明库是全新的，交给下方 seed 流程（seed 前会先 db push）
  console.error("[ensure-seed] 读取试卷数失败，按空库处理:", error.message.split("\n")[0]);
} finally {
  await prisma.$disconnect();
}

if (paperCount > 0) {
  console.log(`[ensure-seed] 已有 ${paperCount} 套试卷，跳过种子生成（保护现有数据）`);
  process.exit(0);
}

console.log("[ensure-seed] 库为空，从 prisma/seed.ts 生成题库…");
const result = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if ((result.status ?? 1) !== 0) {
  console.error("[ensure-seed] 种子生成失败，退出码", result.status);
  process.exit(result.status ?? 1);
}
console.log("[ensure-seed] 题库生成完成");
