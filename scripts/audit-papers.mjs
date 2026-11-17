#!/usr/bin/env node
/**
 * 卷库完整性审计：一套卷是不是「能练」不看 status 字段，看四个板块的题量对不对。
 * 期望：写作 1 + 听力 25（8 段材料，段段有原文）+ 阅读 30 + 翻译 1 = 57。
 * 跑法：node scripts/audit-papers.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const EXPECT = { writing: 1, listening: 25, reading: 30, translation: 1 };

const papers = await prisma.paper.findMany({
  where: { hidden: false },
  orderBy: [{ year: "asc" }, { month: "asc" }, { level: "asc" }, { setNo: "asc" }],
  include: {
    sections: {
      orderBy: { order: "asc" },
      include: { passages: { include: { _count: { select: { questions: true } } } } },
    },
  },
});

const bad = [];
const rows = [];
for (const paper of papers) {
  const byType = new Map(paper.sections.map((s) => [s.type, s]));
  const counts = {};
  for (const [type, expect] of Object.entries(EXPECT)) {
    const section = byType.get(type);
    const got = section?.passages.reduce((a, p) => a + p._count.questions, 0) ?? 0;
    counts[type] = { got, expect, ok: got === expect };
  }
  const listeningNoTranscript =
    byType.get("listening")?.passages.filter((p) => !p.transcript).length ?? 0;
  const total = Object.values(counts).reduce((a, c) => a + c.got, 0);
  const ok =
    Object.values(counts).every((c) => c.ok) && listeningNoTranscript === 0 && total === 57;
  rows.push({ id: paper.id, total, ok });
  if (!ok) bad.push({ id: paper.id, counts, listeningNoTranscript, total });
}

const byLevel = rows.reduce((acc, r) => {
  acc[r.id.startsWith("cet4") || r.id.includes("cet4") ? "CET4" : "CET6"] =
    (acc[r.id.startsWith("cet4") || r.id.includes("cet4") ? "CET4" : "CET6"] ?? 0) + 1;
  return acc;
}, {});

console.log(`可见卷 ${papers.length} 套：完整 ${rows.length - bad.length} / 不完整 ${bad.length}`);
console.log(`级别分布：四级 ${byLevel.CET4 ?? 0} 套 · 六级 ${byLevel.CET6 ?? 0} 套`);
if (bad.length) {
  for (const b of bad.slice(0, 10)) {
    console.log(`  ✗ ${b.id} 合计 ${b.total} 题 ${JSON.stringify(b.counts)} 缺原文 ${b.listeningNoTranscript}`);
  }
}
const audio = await prisma.passage.count({ where: { section: { type: "listening" }, audioUrl: { not: null } } });
const transcript = await prisma.passage.count({
  where: { section: { type: "listening" }, transcript: { not: null } },
});
console.log(`听力材料：${await prisma.passage.count({ where: { section: { type: "listening" } } })} 段，含原文 ${transcript} 段，含音频文件 ${audio} 段`);
await prisma.$disconnect();
process.exit(bad.length ? 1 : 0);
