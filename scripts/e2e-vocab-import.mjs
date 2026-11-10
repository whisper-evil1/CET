#!/usr/bin/env node
/**
 * 词书 / 导入 / 优先级队列的接口级端到端测试。
 *
 * 直接打接口，不复用 UI：这一层要保证的是「数据对不对、边界挡不挡」，
 * UI 另有 e2e-vocab-ui2.mjs 走真浏览器。
 *
 * 覆盖：
 *   - 词书列表与分页（词频排名升序、释义非空、已导入标记）
 *   - 粘贴文本导入（新增 / 重复跳过 / 非法行拒绝）
 *   - 词书一键导入
 *   - 词表新字段（priority / dueLabel / reason / examRank / examTags）
 *   - 今日队列（limit、优先级降序）
 *   - 复习调度（1 天 → 2 天 → 4 天并掌握；答错回到 10 分钟）
 *   - 未登录 401、空内容 400、不存在的词书 404
 *
 * 用法：node scripts/e2e-vocab-import.mjs
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

async function api(path, init = {}, withAuth = true) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(withAuth ? { cookie: `authjs.session-token=${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = { parseError: true };
  }
  return { status: res.status, body, ctype: res.headers.get("content-type") ?? "" };
}

let pass = 0;
let fail = 0;
const record = (name, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const prisma = new PrismaClient();
/** 测试词必须纯字母——解析器会拒掉带数字的词形，用 base26 生成唯一前缀 */
function letters(value) {
  let out = "";
  let rest = value;
  do {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  } while (rest > 0);
  return out;
}
const stamp = `zz${letters(Date.now())}`;

/**
 * 开跑先自清：上一次运行如果在中途断言处抛错，末尾那段清理就被跳过了，
 * 于是 `zzzz…` 这种测试词会留在演示账号里，用户进闯关页看到的题面和干扰项全是「测试词一/二/三」。
 * 所以每次开跑先把自己可能留下的垃圾扫掉（只匹配 zzzz 前缀，真词没有长这样的）。
 */
{
  const stale = await prisma.vocabWord.findMany({
    where: { userId: "user-demo", word: { startsWith: "zzzz" } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const ids = stale.map((r) => r.id);
    await prisma.vocabReview.deleteMany({ where: { wordId: { in: ids } } });
    const swept = await prisma.vocabWord.deleteMany({ where: { id: { in: ids } } });
    console.log(`开跑前扫到上次残留的测试词 ${swept.count} 条，已清理`);
  }
}

/* ---------- 0. 未登录必须挡住 ---------- */
{
  const res = await api("/api/vocab/wordbooks", {}, false);
  record("未登录访问词书返回 401", res.status === 401, `HTTP ${res.status}`);
  const queue = await api("/api/vocab/queue", {}, false);
  record("未登录访问队列返回 401", queue.status === 401, `HTTP ${queue.status}`);
}

/* ---------- 1. 词书列表 ---------- */
const books = await api("/api/vocab/wordbooks");
record("词书接口返回成功", books.status === 200 && books.body?.code === 0, `HTTP ${books.status}`);
const list = books.body?.data ?? [];
record("返回三本词书", list.length === 3, list.map((b) => `${b.id}:${b.count}`).join(", "));
record(
  "词书规模符合预期（1500/1500/800）",
  list[0]?.count === 1500 && list[1]?.count === 1500 && list[2]?.count === 800,
  list.map((b) => b.count).join("/"),
);
record(
  "词书带有取词规则说明",
  list.every((b) => typeof b.rule === "string" && b.rule.length > 8),
);
record("词书带已导入计数", list.every((b) => typeof b.imported === "number"));

/* ---------- 2. 词书分页 ---------- */
const page = await api("/api/vocab/wordbooks/cet4-core?offset=0&limit=20");
const rows = page.body?.data?.entries ?? [];
record("词书分页返回 20 条", rows.length === 20, String(rows.length));
record(
  "词频排名升序",
  rows.every((row, i) => i === 0 || rows[i - 1].rank <= row.rank),
  rows.slice(0, 5).map((r) => `${r.word}#${r.rank}`).join(", "),
);
record("每条都有释义", rows.every((row) => Array.isArray(row.definitions) && row.definitions.length > 0));
record("有 hasMore 标记", page.body?.data?.hasMore === true);

const page2 = await api("/api/vocab/wordbooks/cet4-core?offset=20&limit=20");
const rows2 = page2.body?.data?.entries ?? [];
record(
  "第二页不重复",
  rows2.every((row) => !rows.some((first) => first.word === row.word)),
  `${rows[0]?.word} … ${rows2[0]?.word}`,
);

const missingBook = await api("/api/vocab/wordbooks/nope");
record("不存在的词书返回 404", missingBook.status === 404, `HTTP ${missingBook.status}`);

/* ---------- 3. 文本导入 ---------- */
const testWords = [
  `zz${stamp}a`,
  `zz${stamp}b`,
  `zz${stamp}c`,
  `zz${stamp}d`,
];
const text = [
  `${testWords[0]}\t测试词一`,
  `${testWords[1]}, 测试词二`,
  `${testWords[2]} n. 测试词三`,
  testWords[3],
  "abandon",
  "12345 $$$",
].join("\n");

const imported = await api("/api/vocab/import", { method: "POST", body: JSON.stringify({ text }) });
record("文本导入成功", imported.status === 200 && imported.body?.code === 0, `HTTP ${imported.status}`);
const stat = imported.body?.data ?? {};
record("解析出 5 个有效词", stat.total === 5 && stat.added + stat.skipped === 5, JSON.stringify(stat));
record("非法行进入 rejected", Array.isArray(stat.rejected) && stat.rejected.length === 1, JSON.stringify(stat.rejected));

const stored = await prisma.vocabWord.findMany({
  where: { userId: "user-demo", word: { in: testWords } },
  select: { word: true, definitions: true, source: true, examRank: true, examTags: true },
});
record("四个测试词都已入库", stored.length === 4, String(stored.length));
record(
  "带释义的行保留了原始释义",
  stored.some((row) => row.word === testWords[0] && row.definitions.includes("测试词一")),
);
record(
  "只写单词的行从离线词库补了释义",
  stored.find((row) => row.word === testWords[1])?.definitions.includes("测试词二"),
);
record(
  "导入来源标记为 import",
  stored.every((row) => row.source === "import" || row.source === "wordbook"),
);

const real = await prisma.vocabWord.findUnique({
  where: { userId_word: { userId: "user-demo", word: "abandon" } },
  select: { examTags: true, examRank: true, definitions: true },
});
record("真实词打上了考纲标签", Boolean(real?.examTags && real.examTags.includes("cet4")), real?.examTags ?? "null");
record("真实词拿到词频排名", Boolean(real?.examRank && real.examRank > 0), String(real?.examRank));
record("真实词有完整释义", (real?.definitions ?? "").length > 10);

/* ---------- 4. 重复导入 ---------- */
const again = await api("/api/vocab/import", { method: "POST", body: JSON.stringify({ text }) });
const againStat = again.body?.data ?? {};
record("重复导入不新增", againStat.added === 0, JSON.stringify(againStat));
record("重复导入计入 skipped 或 updated", againStat.skipped + againStat.updated === 5, JSON.stringify(againStat));

/* ---------- 5. 词书导入 ----------
 * 先导另一本词书，制造「这批词已经在别的词书里」的状态 —— 两本词书有大量重叠词，
 * 而 VocabWord 只存一个 wordbookId。这一步是刻意的：v2.6 之前的「已导入」按
 * wordbookId 分组统计，词被算给先导入的那本，第二本永远显示 0/N。
 */
const coreFirst = await api("/api/vocab/import", {
  method: "POST",
  body: JSON.stringify({ wordbookId: "cet4-core", count: 20 }),
});
const coreFirstStat = coreFirst.body?.data ?? {};
record(
  "先导入高频词书 20 词",
  coreFirst.status === 200 && coreFirstStat.added + coreFirstStat.skipped === 20,
  JSON.stringify(coreFirstStat),
);

const bookImport = await api("/api/vocab/import", {
  method: "POST",
  body: JSON.stringify({ wordbookId: "cet-essential", count: 12 }),
});
const bookStat = bookImport.body?.data ?? {};
record("词书导入成功", bookImport.status === 200 && bookStat.added + bookStat.skipped === 12, JSON.stringify(bookStat));

const essentialPage = await api("/api/vocab/wordbooks/cet-essential?offset=0&limit=12");
const essentialWords = (essentialPage.body?.data?.entries ?? []).map((row) => row.word);
const fromBook = await prisma.vocabWord.findMany({
  where: { userId: "user-demo", word: { in: essentialWords } },
  select: { word: true, source: true, examRank: true },
});
record(
  "词书导入的词都进了词表",
  essentialWords.length === 12 && fromBook.length === 12,
  `${fromBook.length}/${essentialWords.length}`,
);
record("词书词带词频排名", fromBook.every((row) => row.examRank && row.examRank > 0));

const booksAfter = await api("/api/vocab/wordbooks");
const listAfter = booksAfter.body?.data ?? [];
const essential = listAfter.find((b) => b.id === "cet-essential");
const core = listAfter.find((b) => b.id === "cet4-core");
record(
  "已导入计数随之上调（第二本词书也要算上重叠词）",
  essential && essential.imported >= 12,
  `essential=${essential?.imported}/${essential?.count}`,
);
record(
  "先导入的那本计数不因后导入而清零",
  core && core.imported >= 20,
  `core=${core?.imported}/${core?.count}`,
);

/* ---------- 6. 词表新字段 ---------- */
const vocab = await api("/api/vocab?status=learning");
const items = vocab.body?.data ?? [];
record("词表接口返回成功", vocab.status === 200 && Array.isArray(items), `HTTP ${vocab.status}`);
const withNewFields = items.filter(
  (item) =>
    typeof item.priority === "number" &&
    typeof item.dueLabel === "string" &&
    typeof item.reason === "string" &&
    typeof item.overdue === "boolean" &&
    "examRank" in item &&
    "examTags" in item,
);
record("每条都带优先级 / 到期 / 理由字段", withNewFields.length === items.length, `${withNewFields.length}/${items.length}`);
record("优先级落在 0-100", items.every((item) => item.priority >= 0 && item.priority <= 100));

const sorted = await api("/api/vocab?status=learning&sort=priority");
const sortedItems = sorted.body?.data ?? [];
record(
  "按优先级排序时确实降序",
  sortedItems.every((item, i) => i === 0 || sortedItems[i - 1].priority >= item.priority),
  sortedItems.slice(0, 4).map((i) => `${i.word}:${i.priority}`).join(" > "),
);

/* ---------- 7. 今日队列 ---------- */
const queue = await api("/api/vocab/queue?limit=8");
const q = queue.body?.data ?? {};
record("队列接口返回成功", queue.status === 200 && Array.isArray(q.items), `HTTP ${queue.status}`);
record("limit 生效", q.items.length <= 8, String(q.items.length));
record("队列带统计字段", typeof q.learningCount === "number" && typeof q.dueCount === "number" && typeof q.newCount === "number");
record("队列内已掌握的词不出现", q.items.every((item) => item.status !== "mastered"));
record(
  "队列按优先级降序",
  q.items.every((item, i) => i === 0 || q.items[i - 1].priority >= item.priority),
  q.items.slice(0, 4).map((i) => `${i.word}:${i.priority}`).join(" > "),
);

/* ---------- 8. 复习调度 ---------- */
const target = await prisma.vocabWord.findUnique({
  where: { userId_word: { userId: "user-demo", word: testWords[3] } },
  select: { id: true },
});

const first = await api(`/api/vocab/${target.id}/review`, {
  method: "POST",
  body: JSON.stringify({ result: "known" }),
});
const firstData = first.body?.data ?? {};
record("首次答对：间隔 1 天", firstData.intervalDays === 1, String(firstData.intervalDays));
record("首次答对：返回下次提示", firstData.nextLabel === "1 天后", firstData.nextLabel);
record("首次答对：到期时间在未来", new Date(firstData.dueAt).getTime() > Date.now());
record("首次答对：仍未掌握", firstData.status === "learning", firstData.status);
record("首次答对：不算新掌握", firstData.justMastered === false);

const second = await api(`/api/vocab/${target.id}/review`, {
  method: "POST",
  body: JSON.stringify({ result: "known" }),
});
record("第二次答对：间隔 2 天", second.body?.data?.intervalDays === 2, String(second.body?.data?.intervalDays));

const third = await api(`/api/vocab/${target.id}/review`, {
  method: "POST",
  body: JSON.stringify({ result: "known" }),
});
record("第三次答对：间隔 4 天", third.body?.data?.intervalDays === 4, String(third.body?.data?.intervalDays));
record("第三次答对：移入已掌握", third.body?.data?.status === "mastered", third.body?.data?.status);
record("第三次答对：justMastered 为真", third.body?.data?.justMastered === true);

const wrong = await api(`/api/vocab/${target.id}/review`, {
  method: "POST",
  body: JSON.stringify({ result: "unknown" }),
});
const wrongData = wrong.body?.data ?? {};
record("答错：间隔归零", wrongData.intervalDays === 0, String(wrongData.intervalDays));
record("答错：10 分钟后重来", wrongData.nextLabel === "10 分钟后", wrongData.nextLabel);
record("答错：失误次数 +1", wrongData.lapses === 1, String(wrongData.lapses));
record("答错：退回学习中", wrongData.status === "learning", wrongData.status);

const explicit = await api(`/api/vocab/${target.id}/review`, {
  method: "POST",
  body: JSON.stringify({ result: "known", grade: "easy" }),
});
record("显式 grade=easy 可用", explicit.status === 200 && explicit.body?.data?.intervalDays >= 2, String(explicit.body?.data?.intervalDays));

/* ---------- 9. 边界 ---------- */
const empty = await api("/api/vocab/import", { method: "POST", body: JSON.stringify({ text: "   " }) });
record("空内容返回 400", empty.status === 400, `HTTP ${empty.status}`);

const junk = await api("/api/vocab/import", { method: "POST", body: JSON.stringify({ text: "!!!\n###" }) });
record("全是垃圾行返回 400", junk.status === 400, `HTTP ${junk.status}`);

const noBook = await api("/api/vocab/import", {
  method: "POST",
  body: JSON.stringify({ wordbookId: "not-exist", count: 5 }),
});
record("导入不存在的词书返回 404", noBook.status === 404, `HTTP ${noBook.status}`);

const tooBig = await api("/api/vocab/import", {
  method: "POST",
  body: JSON.stringify({ words: Array.from({ length: 900 }, (_, i) => ({ word: `over${i}` })) }),
});
record("超过 800 词的数组被拒", tooBig.status === 400, `HTTP ${tooBig.status}`);

/* ---------- 清理 ---------- */
const cleanup = await prisma.vocabWord.deleteMany({
  where: {
    userId: "user-demo",
    OR: [
      { word: { startsWith: `zz${stamp}` } },
      { word: { startsWith: "zzzz" } },
      { wordbookId: "cet-essential", source: "wordbook" },
    ],
  },
});
console.log(`\n清理测试词：${cleanup.count} 条`);
await prisma.$disconnect();

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
