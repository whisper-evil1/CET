#!/usr/bin/env node
/**
 * 卷库导入器：把 66 套目录 + data/papers/*.json 正文写进数据库。
 *
 * 三条原则：
 *   1. **幂等**：id 全部是确定的（`<paperId>-sec-3` / `-p-2` / `-q-46`），重复跑只更新不新增；
 *   2. **不碰用户数据**：只重建本卷的 section/passage/question，且题目 id 稳定，
 *      已作答记录挂在 questionId 上，改题不会连带清掉别人的作答；
 *   3. **没正文就是 draft**：结构照建，status 记 draft，列表可见但不可练，
 *      闯关只抽 ready 卷的阅读篇章（见 reading-game 的 section.type 过滤）。
 *
 * 用法：
 *   node scripts/import-papers.mjs            # 导入/更新全部
 *   node scripts/import-papers.mjs --only cet4-2026-06-s1
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildCatalog } from "./papers-catalog.mjs";
import { normalizeBankedCloze } from "./lib/wordbank.mjs";

const prisma = new PrismaClient();
const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "data", "papers");
const only = (() => {
  const i = process.argv.indexOf("--only");
  return i >= 0 ? process.argv[i + 1] : null;
})();
/** --check：只跑自检，不写库（多人/多代理并行写正文时用，避免抢 SQLite 写锁） */
const CHECK = process.argv.includes("--check");

const READING_PLAN = [
  { order: 1, from: 26, count: 10, label: "Section A 选词填空" },
  { order: 2, from: 36, count: 10, label: "Section B 长篇阅读匹配" },
  { order: 3, from: 46, count: 5, label: "Section C 仔细阅读（一）" },
  { order: 4, from: 51, count: 5, label: "Section C 仔细阅读（二）" },
];

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** 正文 JSON 自检：返回错误列表，空数组即合格 */
function checkPaper(json, entry) {
  const errors = [];
  if (!json || typeof json !== "object") return ["不是对象"];
  if (json.id !== entry.id) errors.push(`id 不符（${json.id}）`);
  const sections = Array.isArray(json.sections) ? json.sections : [];
  const byType = new Map(sections.map((s) => [s.type, s]));

  const reading = byType.get("reading");
  if (!reading || !Array.isArray(reading.passages) || reading.passages.length !== 4) {
    errors.push("阅读必须是 4 篇");
  } else {
    reading.passages.forEach((p, i) => {
      const plan = READING_PLAN[i];
      const qs = Array.isArray(p.questions) ? p.questions : [];
      if (qs.length !== plan.count) errors.push(`阅读第 ${i + 1} 篇应有 ${plan.count} 题，实际 ${qs.length}`);
      const paras = Array.isArray(p.paragraphs) ? p.paragraphs : [];
      const words = paras.map((x) => text(x.text)).join(" ").split(/\s+/).filter(Boolean).length;
      // 选词填空原文短一些；仔细阅读/匹配至少 200 词
      if (words < (plan.order === 1 ? 120 : 200)) errors.push(`阅读第 ${i + 1} 篇正文太短（${words} 词）`);

      // 选词填空必须是「一篇挖 10 空 + A–O 十五词词库」，且 10 道题共用同一个词库
      const sigs = new Set(qs.map((q) => (q.options ?? []).map((o) => `${o.key}:${text(o.text)}`).join("|")));
      if (plan.order === 1) {
        const missing = [];
        const body = paras.filter((x) => x.label !== "词库").map((x) => text(x.text)).join(" ");
        for (let n = 26; n <= 35; n += 1) if (!body.includes(String(n))) missing.push(n);
        if (missing.length > 0) errors.push(`第 1 篇正文缺空号 ${missing.join(",")}`);
        if (!paras.some((x) => x.label === "词库")) errors.push("第 1 篇缺词库段");
        if (sigs.size !== 1) errors.push("第 1 篇 10 道题的词库不一致");
      }
      // 长篇阅读匹配：选项是段落字母，答案必须落在原文标注的段落里
      if (plan.order === 2) {
        const labels = new Set(paras.map((x) => text(x.label)).filter((x) => /^[A-Z]$/.test(x)));
        if (labels.size < 6) errors.push(`第 2 篇段落标注不足（${labels.size} 段）`);
        for (const q of qs) {
          if (!labels.has(text(q.answer))) errors.push(`第 ${q.number} 题答案 ${q.answer} 不是本篇段落`);
        }
      }

      qs.forEach((q, qi) => {
        const expect = plan.from + qi;
        if (q.number !== expect) errors.push(`阅读第 ${i + 1} 篇第 ${qi + 1} 题题号应为 ${expect}，实际 ${q.number}`);
        const opts = Array.isArray(q.options) ? q.options : [];
        const want = plan.order === 1 ? 15 : plan.order === 2 ? Math.max(4, opts.length) : 4;
        if (opts.length !== want) errors.push(`第 ${q.number} 题选项应为 ${want} 个，实际 ${opts.length}`);
        if (!opts.some((o) => o.key === q.answer)) errors.push(`第 ${q.number} 题答案 ${q.answer} 不在选项内`);
        if (text(q.stem).length < 8) errors.push(`第 ${q.number} 题题干过短`);
        if (text(q.analysis).length < 10) errors.push(`第 ${q.number} 题缺解析`);
      });
    });
  }

  for (const type of ["writing", "translation"]) {
    const sec = byType.get(type);
    const q = sec?.passages?.[0]?.questions?.[0];
    if (!q) errors.push(`缺 ${type}`);
    else {
      if (text(q.stem).length < 30) errors.push(`${type} 题干过短`);
      if (text(q.analysis).length < 40) errors.push(`${type} 缺参考范文/译文`);
    }
  }
  if (byType.get("listening")) {
    const lq = byType.get("listening").passages.flatMap((p) => p.questions ?? []);
    if (lq.length > 0 && lq.length !== 25) errors.push(`听力题应为 25 题，实际 ${lq.length}`);
  }
  return errors;
}

async function upsertPaper(entry, json) {
  const origin = json?.origin === "official" ? "official" : "simulated";
  const status = json ? "ready" : "draft";
  const data = {
    title: entry.title,
    level: entry.level,
    year: entry.year,
    month: entry.month,
    setNo: entry.setNo,
    origin,
    status,
    totalTime: entry.totalTime,
    sort: entry.sort,
  };
  await prisma.paper.upsert({
    where: { id: entry.id },
    update: data,
    create: { id: entry.id, ...data },
  });

  const contentByType = new Map((json?.sections ?? []).map((s) => [s.type, s]));
  const keepSectionIds = [];

  for (const bp of entry.sections) {
    const secId = `${entry.id}-sec-${bp.order}`;
    keepSectionIds.push(secId);
    const content = contentByType.get(bp.type);
    const hasListening = bp.type === "listening" && (content?.passages?.length ?? 0) > 0;
    const title =
      bp.type === "listening" && !hasListening
        ? "Section II Listening Comprehension（音频暂缺）"
        : bp.title;

    await prisma.section.upsert({
      where: { id: secId },
      update: { order: bp.order, type: bp.type, title, timeLimit: bp.timeLimit },
      create: {
        id: secId,
        paperId: entry.id,
        order: bp.order,
        type: bp.type,
        title,
        timeLimit: bp.timeLimit,
      },
    });

    if (!content) continue;
    const keepPassageIds = [];
    for (const [pi, p] of (content.passages ?? []).entries()) {
      const pid = `${entry.id}-p-${bp.order}-${pi + 1}`;
      keepPassageIds.push(pid);
      await prisma.passage.upsert({
        where: { id: pid },
        update: {
          order: pi + 1,
          title: p.title ?? null,
          paragraphs: JSON.stringify(p.paragraphs ?? []),
          transcript: p.transcript ? JSON.stringify(p.transcript) : null,
          audioUrl: p.audioUrl ?? null,
          audioDuration: p.audioDuration ?? null,
          sectionId: secId,
        },
        create: {
          id: pid,
          paperId: entry.id,
          sectionId: secId,
          order: pi + 1,
          title: p.title ?? null,
          paragraphs: JSON.stringify(p.paragraphs ?? []),
          transcript: p.transcript ? JSON.stringify(p.transcript) : null,
          audioUrl: p.audioUrl ?? null,
          audioDuration: p.audioDuration ?? null,
        },
      });

      for (const q of p.questions ?? []) {
        const qid = `${entry.id}-q-${q.number ?? 0}-${pi + 1}`;
        const payload = {
          order: q.number ?? 0,
          number: q.number ?? 0,
          stem: text(q.stem),
          options: JSON.stringify(q.options ?? []),
          answer: text(q.answer),
          analysis: text(q.analysis),
          optionAnalysis: q.optionAnalysis ? JSON.stringify(q.optionAnalysis) : null,
          evidencePara: q.evidencePara ?? null,
          evidenceText: q.evidenceText ?? null,
          type: q.type ?? null,
          passageId: pid,
        };
        await prisma.question.upsert({
          where: { id: qid },
          update: payload,
          create: { id: qid, ...payload },
        });
      }
      // 清掉本篇里本次没给的题（题号删减时）
      const keepQids = (p.questions ?? []).map((q) => `${entry.id}-q-${q.number ?? 0}-${pi + 1}`);
      await prisma.question.deleteMany({
        where: { passageId: pid, id: { notIn: keepQids } },
      });
    }
    await prisma.passage.deleteMany({
      where: { sectionId: secId, id: { notIn: keepPassageIds } },
    });
  }

  await prisma.section.deleteMany({
    where: { paperId: entry.id, id: { notIn: keepSectionIds } },
  });
}

const catalog = buildCatalog();
fs.mkdirSync(CONTENT_DIR, { recursive: true });

let ready = 0;
let draft = 0;
const broken = [];

for (const entry of catalog) {
  if (only && entry.id !== only) continue;
  const file = path.join(CONTENT_DIR, `${entry.id}.json`);
  let json = null;
  if (fs.existsSync(file)) {
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
      // 正文允许按「每空四选一」写，入库前统一升成 A–O 词库（幂等）
      const readingSec = (json.sections ?? []).find((s) => s.type === "reading");
      const banked = readingSec?.passages?.[0];
      const nb = banked ? normalizeBankedCloze(banked) : { ok: true, changed: false };
      if (!nb.ok) throw new Error(`选词填空无法词库化：${nb.reason}`);
      const errors = checkPaper(json, entry);
      if (errors.length > 0) {
        broken.push({ id: entry.id, errors });
        json = null;
      }
    } catch (error) {
      broken.push({ id: entry.id, errors: [`JSON 解析失败：${error.message}`] });
      json = null;
    }
  }
  if (!CHECK) await upsertPaper(entry, json);
  if (json) ready += 1;
  else draft += 1;
}

if (CHECK) {
  console.log(`[只校验，不写库] 检查 ${ready + draft} 套：合格 ${ready} / 不合格 ${draft}`);
  for (const b of broken) console.log(`  ${b.id}: ${b.errors.slice(0, 4).join("; ")}`);
  await prisma.$disconnect();
  process.exit(broken.length > 0 ? 1 : 0);
}

const total = await prisma.paper.count();
const readyCount = await prisma.paper.count({ where: { status: "ready" } });
const questions = await prisma.question.count();

console.log(`目录 ${catalog.length} 套；本次 ready ${ready} / draft ${draft}`);
console.log(`库内共 ${total} 套（ready ${readyCount}），题目 ${questions} 道`);
if (broken.length > 0) {
  console.log(`\n正文未通过自检（按 draft 入库）：`);
  for (const b of broken) console.log(`  ${b.id}: ${b.errors.slice(0, 3).join("; ")}`);
  process.exitCode = 1;
}
await prisma.$disconnect();
