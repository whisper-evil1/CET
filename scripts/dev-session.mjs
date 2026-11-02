/**
 * 生成一个合法的 NextAuth 会话 cookie（JWT 策略），用于端到端接口验证。
 * 不依赖账号密码：直接把 uid 写进 token。
 * 用法：node scripts/dev-session.mjs [userId]
 */
import { encode } from "next-auth/jwt";
import fs from "node:fs";
import path from "node:path";

function readEnv(key) {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return "";
  const line = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const uid = process.argv[2] ?? "user-demo";
const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const salt = "authjs.session-token";

const token = await encode({
  token: { uid, sub: uid, name: "dev", email: "dev@local" },
  secret,
  salt,
  maxAge: 60 * 60 * 24 * 7,
});

process.stdout.write(token);
