#!/usr/bin/env node
/**
 * 存量账号回填：把本地库里已有的邮箱 + 密码摘要推到云数据库。
 *
 * 用法：node scripts/sync-accounts-to-cloud.mjs [--dry]
 *
 * 为什么需要它：
 *   注册路径在本次改动之后会自动同步，但改动之前注册的账号（种子账号、历史用户）
 *   云端还没有镜像。这个脚本一次性补齐；重复执行安全（同一本地账号 → 23505 → 跳过）。
 *
 * 推到云侧的是 bcrypt 摘要，不是明文密码 —— 本地库里本来也只存摘要。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import pkg from "@prisma/client";

const { PrismaClient } = pkg;
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dry = process.argv.includes("--dry");

const configText = readFileSync(join(root, "src", "lib", "cloud-config.ts"), "utf8");
const pick = (key) => configText.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1] ?? "";
const endpoint = pick("endpoint");
const publishableKey = pick("publishableKey");
if (!endpoint || !publishableKey) {
  console.error("✗ 读不到 cloud-config.ts");
  process.exit(1);
}

// .env 里的 DATABASE_URL 由 prisma 自己读，这里不重复处理
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  select: { id: true, email: true, name: true, password: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});
await prisma.$disconnect();

const mask = (email) => email.replace(/(.{2}).*(@.*)/, "$1***$2");
console.log(`本地账号 ${users.length} 个，目标 ${endpoint}${dry ? "（演练，不写入）" : ""}\n`);

if (dry) {
  for (const u of users) console.log(`  · ${mask(u.email)}  hash=${u.password.slice(0, 7)}…`);
  process.exit(0);
}

const withOrigin = (input, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("origin")) headers.set("origin", endpoint);
  return fetch(input, { ...init, headers });
};
const cloud = createWorkBuddyCloud({ endpoint, publishableKey, fetch: withOrigin });

let pushed = 0;
let skipped = 0;
let failed = 0;

for (const u of users) {
  const { error } = await cloud.database.from("app_accounts").insert({
    local_user_id: u.id,
    email: u.email.trim().toLowerCase(),
    name: u.name,
    password_hash: u.password,
    password_algo: "bcrypt",
    source: "backfill",
  });

  if (!error) {
    pushed += 1;
    console.log(`  ✓ ${mask(u.email)}`);
    continue;
  }
  const state = String(error.code ?? "").replace(/^DATABASE_/, "");
  if (state === "23505") {
    skipped += 1;
    console.log(`  · ${mask(u.email)} 已在云端，跳过`);
    continue;
  }
  failed += 1;
  console.log(`  ✗ ${mask(u.email)} → ${error.code ?? ""} ${error.message ?? ""}`.trim());
}

console.log(`\n新增 ${pushed}，已存在 ${skipped}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
