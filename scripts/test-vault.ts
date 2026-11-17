/**
 * 账号保险库连通性自测：写一条 → 读回来 → 比对字段。
 * 用法：set -a; . ./.env; set +a; npx tsx scripts/test-vault.ts
 */
import { saveAccountToVault, loadAccountFromVault, vaultKeyFor } from "../src/lib/account-vault";

const email = `vault-probe-${Date.now()}@cet.local`;

async function main() {
  console.log("key:", vaultKeyFor(email));
  const ok = await saveAccountToVault({
    userId: "probe-user-id",
    email,
    name: "探针",
    passwordHash: "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234",
  });
  console.log("save:", ok);

  const back = await loadAccountFromVault(email);
  console.log("load:", back);

  if (!back) {
    console.error("FAIL 读不回来");
    process.exit(1);
  }
  if (back.userId !== "probe-user-id" || back.email !== email) {
    console.error("FAIL 字段不一致");
    process.exit(1);
  }
  const missing = await loadAccountFromVault(`nobody-${Date.now()}@cet.local`);
  console.log("missing lookup:", missing);
  console.log("PASS");
}

void main();
