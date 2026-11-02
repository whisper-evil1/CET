/**
 * 端到端复现「加入生词本」：完全按 word-card.tsx 的载荷构造方式发请求。
 * 用法：node scripts/e2e-vocab.mjs
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import fs from "node:fs";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3100";

function readEnv(key) {
  const raw = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const secret = readEnv("AUTH_SECRET") || "dev-only-secret-change-me";
const token = await encode({
  token: { uid: "user-demo", sub: "user-demo", name: "dev" },
  secret,
  salt: "authjs.session-token",
  maxAge: 3600,
});

/** 与前端 sentenceAround 完全一致的实现 */
function sentenceAround(text, word) {
  const lower = text.toLowerCase();
  const target = word.toLowerCase();
  const at = lower.indexOf(target);
  if (at === -1) return text.slice(0, 160);
  let start = at;
  while (start > 0 && !/[.!?]/.test(text[start - 1] ?? "")) start -= 1;
  let end = at + target.length;
  while (end < text.length && !/[.!?]/.test(text[end] ?? "")) end += 1;
  return text.slice(start, Math.min(end + 1, text.length)).trim();
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: `authjs.session-token=${token}`,
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { parseError: true };
  }
  return { status: res.status, body };
}

const prisma = new PrismaClient();
const passage = await prisma.passage.findFirst({ where: { section: { type: "reading" } } });
const paragraphs = JSON.parse(passage?.paragraphs ?? "[]");
const text = paragraphs.map((p) => p.text ?? p.content ?? "").join("\n");

// 从文中挑一个足够"难"的实词，模拟真实点词
const words = [...new Set(text.match(/[A-Za-z]{6,}/g) ?? [])];
console.log("候选词:", words.slice(0, 12).join(", "));

let pass = 0;
let fail = 0;
const record = (name, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

for (const word of words.slice(0, 6)) {
  const context = sentenceAround(text, word);
  const lookup = await api("/api/lookup", {
    method: "POST",
    body: JSON.stringify({ word, passageId: passage.id, context }),
  });
  const entry = lookup.body?.data?.entry ?? null;

  // 与 word-card.tsx 的 addToVocab 完全一致的载荷
  const payload = {
    word: entry?.word ?? word.toLowerCase(),
    phonetic: entry?.phonetic ?? null,
    definitions: entry ? (entry.definitions ?? []).slice(0, 6) : [],
    example: entry?.examples?.[0]?.en ?? null,
    exampleZh: entry?.examples?.[0]?.zh ?? null,
    sourceContext: context,
    sourcePassageId: passage.id,
  };

  const added = await api("/api/vocab", { method: "POST", body: JSON.stringify(payload) });
  const ok = added.status === 200 && added.body?.code === 0;
  record(
    `加入生词本：${word}（context ${context.length} 字符）`,
    ok,
    ok ? `id=${added.body?.data?.id?.slice(-6)}` : `HTTP ${added.status} ${JSON.stringify(added.body).slice(0, 240)}`,
  );
}

const list = await api("/api/vocab");
record("生词本列表可读", Array.isArray(list.body?.data), `共 ${list.body?.data?.length ?? 0} 条`);

// 边界回归：超长语境 + 超长释义不应整条被拒（旧实现会 400，表现成"加不进去"）
{
  const longSentence = "Consumers who understand what a twenty-minute promise costs can ask for something better. ".repeat(12);
  const over = await api("/api/vocab", {
    method: "POST",
    body: JSON.stringify({
      word: "longcontext",
      phonetic: "p".repeat(400),
      definitions: [{ pos: "n.", zh: "释".repeat(800) }],
      example: "e".repeat(3000),
      exampleZh: "中".repeat(3000),
      sourceContext: longSentence,
      sourcePassageId: passage.id,
    }),
  });
  record("超长字段不整条拒绝", over.status === 200 && over.body?.code === 0, `HTTP ${over.status}`);

  const stored = await prisma.vocabWord.findUnique({
    where: { userId_word: { userId: "user-demo", word: "longcontext" } },
  });
  record(
    "语境被截断到 500",
    (stored?.sourceContext?.length ?? 0) > 0 && (stored?.sourceContext?.length ?? 0) <= 500,
    `实际 ${stored?.sourceContext?.length ?? 0} 字符`,
  );
  const defs = JSON.parse(stored?.definitions ?? "[]");
  record("释义被截断到 200", (defs[0]?.zh?.length ?? 0) <= 200, `实际 ${defs[0]?.zh?.length ?? 0} 字符`);
  await prisma.vocabWord.deleteMany({ where: { word: "longcontext" } });
}

await prisma.$disconnect();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
