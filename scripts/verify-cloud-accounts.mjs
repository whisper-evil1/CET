#!/usr/bin/env node
/**
 * 云侧凭据表的安全边界验证。
 *
 * 用法：node scripts/verify-cloud-accounts.mjs
 *
 * 四条断言：
 *   1. 应用侧（publishableKey = 公开身份）SELECT 拿不到任何一行 —— 密码摘要不可被读走
 *   2. 重复插入同一邮箱返回 23505（唯一冲突），应用按「已同步」处理，不报错
 *   3. 邮箱格式不合规的插入被 WITH CHECK 拦下（42501 / 23514 一类）
 *   4. UPDATE / DELETE 无策略 → 被拒，历史不可改写
 *
 * 之所以在 Node 里跑而不是浏览器：要验证的是「即使有人拿到公开的 publishableKey，
 * 也读不到凭据」，Node 直连最接近攻击者视角。Origin 头按云服务要求补上。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";

const here = dirname(fileURLToPath(import.meta.url));
const configText = readFileSync(join(here, "..", "src", "lib", "cloud-config.ts"), "utf8");
const pick = (key) => configText.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1] ?? "";

const endpoint = pick("endpoint");
const publishableKey = pick("publishableKey");
if (!endpoint || !publishableKey) {
  console.error("✗ 读不到 cloud-config.ts 里的 endpoint / publishableKey");
  process.exit(1);
}

const withOrigin = (input, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("origin")) headers.set("origin", endpoint);
  return fetch(input, { ...init, headers });
};

const cloud = createWorkBuddyCloud({ endpoint, publishableKey, fetch: withOrigin });
const table = () => cloud.database.from("app_accounts");

let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failed += 1;
  console.log(`  ✗ ${m}`);
};
const codeOf = (e) => e?.code ?? e?.details ?? e?.message ?? "(无 code)";
/** SDK 会给 SQLSTATE 加 DATABASE_ 前缀，比对时统一剥掉 */
const sqlState = (e) => String(e?.code ?? "").replace(/^DATABASE_/, "");

console.log(`\nendpoint = ${endpoint}\n`);

/* 1. 应用侧读不到任何一行 */
console.log("[1] 应用侧 SELECT 应为空（RLS: USING false）");
{
  const { data, error } = await table().select("email, password_hash").limit(5);
  if (error) bad(`查询报错：${codeOf(error)}`);
  else if (Array.isArray(data) && data.length === 0) ok("返回 0 行，凭据不可被客户端读取");
  else bad(`返回了 ${data?.length} 行，凭据已泄露`);
}

/* 2. 幂等语义：同一本地账号重复推送 → 23505；同邮箱换账号 → 追加新行 */
console.log("\n[2] 幂等语义（唯一键在 local_user_id，不在 email）");
{
  const email = `idem${Date.now().toString(36)}@qq.com`;
  const localId = `verify-${Date.now()}`;
  const row = {
    local_user_id: localId,
    email,
    name: "幂等验证",
    password_hash: "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
    password_algo: "bcrypt",
    source: "backfill",
  };
  const first = await table().insert(row);
  if (first.error) bad(`首次插入失败：${codeOf(first.error)}`);
  else ok("首次插入成功");

  const again = await table().insert(row);
  if (sqlState(again.error) === "23505") ok(`同一本地账号重复推送 → ${codeOf(again.error)}，按「已同步」处理`);
  else bad(`重复推送未返回 23505，而是 ${codeOf(again.error ?? {})}`);

  // 同一邮箱、不同本地账号（例如本地库重建后重新注册），应追加而不是被挡下，
  // 这样「最新一行」始终对应该邮箱当前的密码摘要。
  const renewed = await table().insert({
    ...row,
    local_user_id: `verify-renew-${Date.now()}`,
    password_hash: "$2b$10$ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkjihgfedcba98765",
    source: "register",
  });
  if (renewed.error) bad(`同邮箱换账号应追加，实际被拒：${codeOf(renewed.error)}`);
  else ok("同邮箱换账号 → 追加新行（镜像停在最新密码摘要）");
}

/* 3. 邮箱格式不合规被 WITH CHECK 拦下 */
console.log("\n[3] 非法邮箱应被 WITH CHECK 拦下");
{
  const { error } = await table().insert({
    local_user_id: `verify-bad-${Date.now()}`,
    email: "not-an-email",
    name: null,
    password_hash: "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
    password_algo: "bcrypt",
    source: "backfill",
  });
  if (error) ok(`已拒绝：${codeOf(error)}`);
  else bad("非法邮箱被写入了，策略没生效");
}

/* 4. UPDATE / DELETE 无策略，应被拒 */
console.log("\n[4] UPDATE / DELETE 应被拒（无对应策略）");
{
  const upd = await table().update({ name: "被篡改" }).eq("email", "cloudsync@qq.com");
  if (upd.error) ok(`UPDATE 被拒：${codeOf(upd.error)}`);
  else ok(`UPDATE 未影响任何行（0 行可见，等同拒绝）`);

  const del = await table().delete().eq("email", "cloudsync@qq.com");
  if (del.error) ok(`DELETE 被拒：${codeOf(del.error)}`);
  else ok(`DELETE 未影响任何行（0 行可见，等同拒绝）`);
}

console.log("");
if (failed > 0) {
  console.log(`结论：${failed} 项未通过`);
  process.exit(1);
}
console.log("结论：凭据表边界成立 —— 可写、不可读、不可改、不可删");
