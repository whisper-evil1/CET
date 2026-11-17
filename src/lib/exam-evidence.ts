import { prisma } from "@/lib/prisma";
import { matchRegexOf, variantsOf } from "@/lib/word-match";

/**
 * 真题证据：这个词在本站真题语料里出现在哪几套卷的哪句话。
 *
 * 数据源是 Paper / Passage（66 套 2021–2026 官方真题，听力稿在 transcript、
 * 笔试试文在 paragraphs）。不是外购词频表——所以口径是「本站真题题库」，
 * 页面文案也按这个口径写（「本站 66 套真题中出现 N 句次」），
 * 不冒充「近 7 年全国统考全量统计」这种做不到的口径。
 *
 * 只统计 origin=official 且未隐藏的卷：仿真稿不进「真题再现」，避免名不副实。
 */

export type ExamExample = {
  /** 命中的原句（已按长度截断） */
  en: string;
  level: string;
  year: number | null;
  month: number | null;
  setNo: number | null;
  /** listening | reading | writing | translation */
  section: string;
  /** 出处文案，如「2023年6月 CET-4 真题 · 阅读」，服务端算好，前端原样显示 */
  cite: string;
};

export type ExamEvidence = {
  /** 命中句次（去重后的句数） */
  total: number;
  /** 听力句次 */
  listening: number;
  /** 笔试句次（阅读/写作/翻译） */
  written: number;
  /** 命中过的卷套数 */
  paperCount: number;
  yearMin: number | null;
  yearMax: number | null;
  /** 题库口径：本站共多少套官方真题（分母） */
  corpusPapers: number;
  examples: ExamExample[];
};

/** 语料总套数（official 且未隐藏），变化少，进程内缓存 */
let corpusCache: { count: number; at: number } | null = null;
const CORPUS_TTL_MS = 10 * 60 * 1000;

async function corpusPaperCount(): Promise<number> {
  if (corpusCache && Date.now() - corpusCache.at < CORPUS_TTL_MS) return corpusCache.count;
  const count = await prisma.paper.count({ where: { origin: "official", hidden: false } });
  corpusCache = { count, at: Date.now() };
  return count;
}

const evidenceCache = new Map<string, ExamEvidence | null>();
const CACHE_CAP = 800;

/** 填空（26______）、超短句不算例句 */
const CLOZE = /_{3,}|\bQ\d+\b/;
const MIN_CHARS = 24;
const MAX_CHARS = 220;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+(?=["'(A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 长句截到命中词附近，保证例句在卡片上两三行看得完 */
function clipSentence(sentence: string, re: RegExp): string {
  if (sentence.length <= MAX_CHARS) return sentence;
  re.lastIndex = 0;
  const m = re.exec(sentence);
  const at = m ? m.index : 0;
  const start = Math.max(0, at - 80);
  const end = Math.min(sentence.length, at + MAX_CHARS - 80);
  return (start > 0 ? "… " : "") + sentence.slice(start, end).trim() + (end < sentence.length ? " …" : "");
}

function citationOf(example: Pick<ExamExample, "level" | "year" | "month" | "section">): string {
  const level = example.level === "CET6" ? "CET-6" : "CET-4";
  const when = example.year ? `${example.year}年${example.month ? `${example.month}月 ` : ""}` : "";
  const kind = example.section === "listening" ? "听力" : example.section === "translation" ? "翻译" : example.section === "writing" ? "写作" : "阅读";
  return `${when}${level} 真题 · ${kind}`;
}

async function computeEvidence(word: string): Promise<ExamEvidence | null> {
  const variants = variantsOf(word);
  if (variants.length === 0) return null;

  const rows = await prisma.passage.findMany({
    where: {
      paper: { origin: "official", hidden: false },
      OR: variants.flatMap((v) => [{ paragraphs: { contains: v } }, { transcript: { contains: v } }]),
    },
    include: {
      paper: { select: { level: true, year: true, month: true, setNo: true } },
      section: { select: { type: true } },
    },
    take: 400,
  });

  const re = matchRegexOf(word);
  if (!re) return null;

  type HitMeta = Pick<ExamExample, "level" | "year" | "month" | "setNo" | "section">;
  const seen = new Set<string>();
  const hits: { sentence: string; meta: HitMeta }[] = [];
  const papers = new Set<string>();
  let listening = 0;
  let written = 0;
  const years: number[] = [];

  for (const row of rows) {
    const meta = {
      level: row.paper.level,
      year: row.paper.year,
      month: row.paper.month,
      setNo: row.paper.setNo,
      section: row.section?.type ?? (row.transcript ? "listening" : "reading"),
    };
    const chunks: string[] = [];
    for (const raw of [row.paragraphs, row.transcript]) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const text = (item as { text?: unknown })?.text;
            if (typeof text === "string") chunks.push(text);
          }
        }
      } catch {
        /* 老数据可能不是 JSON，整段当纯文本 */
        chunks.push(raw);
      }
    }

    for (const chunk of chunks) {
      for (const sentence of splitSentences(chunk)) {
        re.lastIndex = 0;
        if (!re.test(sentence)) continue;
        if (CLOZE.test(sentence)) continue;
        const clean = clipSentence(sentence, re);
        if (clean.replace(/\s/g, "").length < MIN_CHARS) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ sentence: clean, meta });
        papers.add(`${row.paper.year}-${row.paper.month}-${row.paper.setNo}-${row.paper.level}`);
        if (meta.section === "listening") listening += 1;
        else written += 1;
        if (row.paper.year) years.push(row.paper.year);
      }
    }
  }

  if (hits.length === 0) return null;

  // 例句挑选：不同卷优先、整句长度适中优先，最多 3 条
  const ranked = hits
    .map((hit, i) => ({ hit, i, score: (hit.sentence.length >= 40 && hit.sentence.length <= 160 ? 2 : 0) + i * 0.001 }))
    .sort((a, b) => b.score - a.score);
  const picked: ExamExample[] = [];
  const usedPapers = new Set<string>();
  for (const { hit } of ranked) {
    const pkey = `${hit.meta.year}-${hit.meta.month}-${hit.meta.setNo}-${hit.meta.level}`;
    if (usedPapers.has(pkey) && picked.length < 2) continue;
    usedPapers.add(pkey);
    picked.push({ en: hit.sentence, ...hit.meta, cite: citationOf(hit.meta) });
    if (picked.length >= 3) break;
  }

  return {
    total: hits.length,
    listening,
    written,
    paperCount: papers.size,
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    corpusPapers: await corpusPaperCount(),
    examples: picked,
  };
}

/**
 * 查一个词的真题证据（带进程内缓存）。
 * 题库没命中的词返回 null，页面据此显示「题库暂未收录」。
 */
export async function getExamEvidence(rawWord: string): Promise<ExamEvidence | null> {
  const word = rawWord.trim().toLowerCase();
  if (!word || word.length > 32) return null;
  if (evidenceCache.has(word)) return evidenceCache.get(word) ?? null;

  let evidence: ExamEvidence | null = null;
  try {
    evidence = await computeEvidence(word);
  } catch (error) {
    console.error("[exam-evidence]", word, error);
    evidence = null;
  }
  if (evidenceCache.size >= CACHE_CAP) evidenceCache.clear();
  evidenceCache.set(word, evidence);
  return evidence;
}
