#!/usr/bin/env node
/**
 * 卷库验收：66 套目录是否齐、ready 卷的正文是否真能练、题目结构是否合官方题号。
 *
 * 只读，不改数据。默认查数据库（Node 直连 Prisma），带 --base 时额外打接口。
 *
 * 用法：
 *   node scripts/e2e-papers.mjs
 *   node scripts/e2e-papers.mjs --base http://127.0.0.1:3000
 */
import { PrismaClient } from "@prisma/client";
import { buildCatalog } from "./papers-catalog.mjs";

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i >= 0 ? process.argv[i + 1].replace(/\/$/, "") : null;
})();

const prisma = new PrismaClient();
const catalog = buildCatalog();
const text = (v) => (typeof v === "string" ? v.trim() : "");

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== 一、目录完整性 ===");
check("目录正好 66 套", catalog.length === 66, `实际 ${catalog.length}`);
check("四级 33 套", catalog.filter((e) => e.level === "CET4").length === 33);
check("六级 33 套", catalog.filter((e) => e.level === "CET6").length === 33);
const ids = new Set(catalog.map((e) => e.id));
check("目录 id 无重复", ids.size === catalog.length);

const papers = await prisma.paper.findMany({
  where: { hidden: false },
  include: {
    sections: {
      orderBy: { order: "asc" },
      include: {
        passages: {
          orderBy: { order: "asc" },
          include: { questions: { orderBy: { order: "asc" } } },
        },
      },
    },
  },
});
const byId = new Map(papers.map((p) => [p.id, p]));

console.log("\n=== 二、目录卷已入库 ===");
const missing = catalog.filter((e) => !byId.has(e.id)).map((e) => e.id);
check("66 套目录卷全部在库", missing.length === 0, missing.slice(0, 5).join(","));

const ready = papers.filter((p) => p.status === "ready" && ids.has(p.id));
const draft = papers.filter((p) => p.status !== "ready");
console.log(`ready ${ready.length} 套 / draft ${draft.length} 套 / 库内共 ${papers.length} 套`);

console.log("\n=== 三、ready 卷结构 ===");
const titles = new Map();
for (const paper of ready) {
  const tag = paper.id;
  const reading = paper.sections.find((s) => s.type === "reading");
  const writing = paper.sections.find((s) => s.type === "writing");
  const translation = paper.sections.find((s) => s.type === "translation");

  check(`${tag} 有阅读段`, Boolean(reading));
  check(`${tag} 有写作段`, Boolean(writing));
  check(`${tag} 有翻译段`, Boolean(translation));
  if (!reading || !writing || !translation) continue;

  check(`${tag} 阅读 4 篇`, reading.passages.length === 4, `实际 ${reading.passages.length}`);

  const numbers = [];
  for (const passage of reading.passages) {
    for (const q of passage.questions) numbers.push(q.number);
  }
  const expect = Array.from({ length: 30 }, (_, i) => i + 26);
  check(
    `${tag} 题号 26–55 连续`,
    numbers.length === 30 && numbers.sort((a, b) => a - b).every((n, i) => n === expect[i]),
    `实际 ${numbers.length} 题`,
  );

  for (const passage of reading.passages) {
    for (const q of passage.questions) {
      const options = JSON.parse(q.options || "[]");
      check(`${tag}#${q.number} 答案在选项内`, options.some((o) => o.key === q.answer));
      check(`${tag}#${q.number} 有解析`, text(q.analysis).length >= 10);
      titles.set(`${text(passage.title)}`, true);
    }
  }

  // 选词填空：词库 15 词 + 十个空号
  const banked = reading.passages[0];
  const bankOpts = JSON.parse(banked.questions[0]?.options || "[]");
  const paras = JSON.parse(banked.paragraphs || "[]");
  check(`${tag} 选词填空词库 15 词`, bankOpts.length === 15, `实际 ${bankOpts.length}`);
  check(`${tag} 选词填空有词库段`, paras.some((p) => p.label === "词库"));
  const body = paras.filter((p) => p.label !== "词库").map((p) => p.text).join(" ");
  const blankMiss = [];
  for (let n = 26; n <= 35; n += 1) if (!body.includes(String(n))) blankMiss.push(n);
  check(`${tag} 十个空号齐全`, blankMiss.length === 0, blankMiss.join(","));

  // 长篇匹配：答案落在段落标注里
  const matching = reading.passages[1];
  const labels = new Set(
    JSON.parse(matching.paragraphs || "[]")
      .map((p) => text(p.label))
      .filter((l) => /^[A-Z]$/.test(l)),
  );
  const badMatch = matching.questions.filter((q) => !labels.has(text(q.answer))).map((q) => q.number);
  check(`${tag} 匹配题答案均在段落内`, badMatch.length === 0, badMatch.join(","));
  check(`${tag} 匹配篇段落 ≥6`, labels.size >= 6, `实际 ${labels.size}`);

  const wq = writing.passages[0]?.questions[0];
  check(`${tag} 写作题干 ≥30 字`, text(wq?.stem).length >= 30);
  check(`${tag} 写作有范文`, text(wq?.analysis).split(/\s+/).length >= 120, `${text(wq?.analysis).split(/\s+/).length} 词`);
  const tq = translation.passages[0]?.questions[0];
  check(`${tag} 翻译题干 ≥30 字`, text(tq?.stem).length >= 30);
  check(`${tag} 翻译有参考译文`, text(tq?.analysis).length >= 200, `${text(tq?.analysis).length} 字符`);

  // 同一套卷四篇题材不重复（按标题去重后仍应是 4 个不同标题）
  const pt = reading.passages.map((p) => text(p.title));
  check(`${tag} 四篇标题互不相同`, new Set(pt).size === pt.length);
}

console.log("\n=== 四、draft 卷必须真的空 ===");
for (const paper of draft) {
  const q = paper.sections.reduce(
    (sum, s) => sum + s.passages.reduce((n, p) => n + p.questions.length, 0),
    0,
  );
  check(`${paper.id} draft 无题目`, q === 0, `${q} 题`);
}

if (BASE) {
  console.log("\n=== 五、接口 ===");
  const res = await fetch(`${BASE}/api/papers`);
  const body = await res.json();
  check("GET /api/papers 200", res.ok, String(res.status));
  const list = Array.isArray(body?.data) ? body.data : [];
  check("接口返回 66 套", list.length === 66 && list.length === papers.length, `实际 ${list.length}`);
  check("接口带 status 字段", list.every((p) => typeof p.status === "string"));
  check("接口带 origin 字段", list.every((p) => typeof p.origin === "string"));
  const firstReady = list.find((p) => p.status === "ready");
  if (firstReady) {
    const detail = await fetch(`${BASE}/api/papers/${firstReady.id}`);
    const db = await detail.json();
    check("ready 卷详情 200", detail.ok);
    const secs = db?.data?.sections ?? [];
    const types = secs.map((x) => x.type).join(",");
    check("详情按 Section 分层", types === "writing,listening,reading,translation", types);
    check(
      "听力段留空（无音频不挂题）",
      (secs.find((x) => x.type === "listening")?.passages ?? []).length === 0,
    );
  }
  const draftOne = list.find((p) => p.status === "draft");
  if (draftOne) {
    const detail = await fetch(`${BASE}/api/papers/${draftOne.id}`);
    check("draft 卷详情 404", detail.status === 404, String(detail.status));
  }
}

console.log(`\n结果：PASS ${pass} / FAIL ${fail}`);
if (failures.length > 0) {
  console.log("\n失败项：");
  for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`);
  if (failures.length > 40) console.log(`  … 另有 ${failures.length - 40} 项`);
}
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
