#!/usr/bin/env node
/**
 * 从云侧导出的账号数据还原本地库。
 *
 * 用法：
 *   node scripts/restore-accounts.mjs accounts.json
 *   cat accounts.json | node scripts/restore-accounts.mjs
 *
 * 输入格式（云侧 exec_sql 导出，字段名对齐即可）：
 *   [{ "email": "a@qq.com", "name": "小明", "password_hash": "$2b$10$...", ... }]
 *
 * 为什么这条路走得通：
 *   云端存的就是 bcrypt 摘要本身，与本地 User.password 是同一个字符串。
 *   bcrypt 不绑机器、不绑盐的存储位置，把摘要原样搬回来，用户用原密码就能登录，
 *   不需要重置密码。这也是「只写不读的镜像」真正的价值所在。
 *
 * 安全说明：
 *   摘要属于凭据，脚本不主动落盘、不回显完整摘要，只报处理条数。
 */
import { readFileSync } from "node:fs";
import pkg from "@prisma/client";

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

const file = process.argv[2];
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");

let rows;
try {
  rows = JSON.parse(raw);
} catch {
  console.error("✗ 输入不是合法 JSON");
  process.exit(1);
}
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("✗ 输入应为非空数组");
  process.exit(1);
}

const mask = (email) => String(email).replace(/(.{2}).*(@.*)/, "$1***$2");
let created = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  const email = String(row.email ?? "").trim().toLowerCase();
  const password = String(row.password_hash ?? row.password ?? "").trim();
  if (!email || !password.startsWith("$2")) {
    failed += 1;
    console.log(`  ✗ ${mask(email || "(空)")} 缺少邮箱或 bcrypt 摘要`);
    continue;
  }

  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) {
    skipped += 1;
    console.log(`  · ${mask(email)} 已存在，跳过`);
    continue;
  }

  try {
    await prisma.user.create({
      data: { email, password, name: row.name ?? email.split("@")[0] ?? "同学" },
    });
    created += 1;
    console.log(`  ✓ ${mask(email)}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${mask(email)} → ${error?.message ?? error}`);
  }
}

await prisma.$disconnect();
console.log(`\n还原 ${created}，已存在 ${skipped}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
