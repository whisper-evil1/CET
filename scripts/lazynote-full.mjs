#!/usr/bin/env node
/**
 * 把「懒笔记」的真题整卷页 + 各题型解析页抓下来，落成 data/papers/*.json 的正文。
 *
 * 为什么要这一步：之前听力已经是真题原文，但阅读/写作/翻译还是按官方结构编写的仿真稿，
 * 卷库里只能标「听力真题」。用户要的是真题 —— 那就把整卷换成原卷：
 *   写作 Directions、选词填空原文+词库、长篇匹配原文、仔细阅读两篇原文、
 *   翻译中文段，全部逐字取自真题页；答案取自整卷的「客观题答案速查」表；
 *   逐题解析取自各题型解析页。
 *
 * 关键约束：
 *   1. 只覆盖 writing / reading / translation 三个 section，listening 由 lazynote-listening.mjs 负责；
 *   2. 一套卷六部分全部解析通过才写盘，任何一处对不上就整卷跳过并报错（不留半套真题）；
 *   3. 写盘前先备份到 _backup/papers-<时间戳>/，随时可回滚。
 *
 * 用法：
 *   node scripts/lazynote-full.mjs --dry --only cet4-2025-12-s1   # 试解析，不写
 *   node scripts/lazynote-full.mjs                                # 全量
 *   node scripts/lazynote-full.mjs --refresh                      # 忽略缓存重新抓
 */
import fs from "node:fs";
import path from "node:path";
import { BASE, PARTS, loadLines, parseId, findLine } from "./lib-lazynote.mjs";

const PAPER_DIR = path.join(process.cwd(), "data", "papers");
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const REFRESH = argv.includes("--refresh");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

const TITLES = {
  A: "Section A 选词填空",
  B: "Section B 长篇阅读匹配",
  C1: "Section C 仔细阅读（一）",
  C2: "Section C 仔细阅读（二）",
};

/* ---------------- 通用小工具 ---------------- */

const isNumLine = (l) => /^\d{1,2}\.$/.test(l);

/** 最后一次匹配的下标（正文在目录之后） */
function lastLine(lines, matcher) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const hit = matcher instanceof RegExp ? matcher.test(line) : typeof matcher === "string" ? line === matcher : matcher(line);
    if (hit) return i;
  }
  return -1;
}

function joinParas(lines) {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 找一段题号：从 start 起，遇到 `26.` 行开头的区块。
 * 两种版式都要吃：整卷页是「题号单独一行」，选词填空解析页是「26. 原句」同一行。
 */
function parseQuestionBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = /^(\d{1,2})\.\s*(.*)$/.exec(line);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 60) {
      if (cur) blocks.push(cur);
      cur = { number: Number(m[1]), body: m[2] ? [m[2]] : [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/** 题块 → { stem, options[] } */
function splitStemOptions(body) {
  const stem = [];
  const options = [];
  for (const line of body) {
    const m = /^([A-D])\)\s*(.+)$/.exec(line);
    if (m && (options.length > 0 || stem.length > 0)) {
      options.push({ key: m[1], text: m[2].trim() });
      continue;
    }
    if (options.length === 0) stem.push(line);
  }
  return { stem: stem.join(" ").replace(/\s+/g, " ").trim(), options };
}


/**
 * 把卷面上的十个空位标成 26______ … 35______。
 *
 * 不能见 2x、3x 就替换：正文里本来就有「periods 26 from three to…」「by 29 percent」这种数字，
 * 全局替换会多标出两个空。真卷的空号是**严格递增 26→35**，所以按顺序逐个认，
 * 对不上号的（裸数字）直接跳过。
 */
function markBlanks(text) {
  const hits = [];
  let expect = 26;
  const re = /(\s|^)(2[6-9]|3[0-5])(?=\s|$)/g;
  let m;
  while ((m = re.exec(text)) && expect <= 35) {
    if (Number(m[2]) !== expect) continue;
    hits.push({ at: m.index + m[1].length, len: m[2].length });
    expect += 1;
  }
  if (expect !== 36) throw new Error(`选词填空只认出 ${expect - 26} 个空号（应为 10 个）`);
  let out = text;
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const { at, len } = hits[i];
    out = `${out.slice(0, at + len)}______${out.slice(at + len)}`;
  }
  return out;
}

/* ---------------- 整卷页解析 ---------------- */

function parseFullPaper(lines, level) {
  // 页面顶部有目录、底部有「全卷构成」，都会出现 Part 名称；
  // 真正的卷面标题带「(N minutes)」，且出现在正文区，所以取最后一次匹配。
  const iWriting = lastLine(lines, /^Part I Writing\s*\(\d+\s*minutes\)/i);
  const iListening = lastLine(lines, /^Part II Listening.*\(\d+\s*minutes\)/i);
  const iReading = lastLine(lines, /^Part (Ⅲ|III) Reading.*\(\d+\s*minutes\)/i);
  const iTrans = lastLine(lines, /^Part IV Translation.*\(\d+\s*minutes\)/i);
  const iAnswers = findLine(lines, /全卷客观题答案速查/);

  if ([iWriting, iListening, iReading, iTrans, iAnswers].some((i) => i < 0)) {
    throw new Error("整卷页缺少必要小标题（Part I/II/III/IV 或答案速查）");
  }

  /* --- 写作 --- */
  const writingLines = lines.slice(iWriting + 1, iListening);
  const dirIdx = findLine(writingLines, /^Directions\s*:/i);
  if (dirIdx < 0) throw new Error("写作缺 Directions");
  const writingPrompt = writingLines
    .slice(dirIdx)
    .join(" ")
    .replace(/^Directions\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  /* --- 阅读 --- */
  const readingRegion = lines.slice(iReading + 1, iTrans);
  const iA = findLine(readingRegion, /^Section A$/);
  const iB = findLine(readingRegion, /^Section B$/);
  const iC = findLine(readingRegion, /^Section C$/);
  if (iA < 0 || iB < 0 || iC < 0) throw new Error("阅读缺 Section A/B/C");

  const parseSectionA = () => {
    const block = readingRegion.slice(iA + 1, iB).filter((l) => !/^Directions\s*:/i.test(l));
    // 词库在原文之后、Section B 之前，是连续一串「A) word」（个别卷写成「A word」，没有右括号）。
    // 不能只按「大写字母+空格」从尾部往前扫：正文的句子常以「I …」「A …」开头，会被一起吞掉。
    // 真正的判据是「15 行连续、编号 A→O」，按这个窗口去找，取最后一处。
    const isBankLine = (l) => /^([A-Z])\)?\s+\S/.test(l);
    let bankStart = -1;
    for (let i = 0; i + 15 <= block.length; i += 1) {
      let ok = true;
      for (let k = 0; k < 15; k += 1) {
        const m = isBankLine(block[i + k]) && /^([A-Z])\)?\s+\S/.exec(block[i + k]);
        if (!m || m[1] !== String.fromCharCode(65 + k)) {
          ok = false;
          break;
        }
      }
      if (ok) bankStart = i;
    }
    if (bankStart < 0) throw new Error("选词填空缺词库");
    const passage = markBlanks(joinParas(block.slice(0, bankStart)).replace(/[ \t]{2,}/g, " "));
    const bank = block
      .slice(bankStart, bankStart + 15)
      .map((l) => /^([A-Z])\)?\s+(.+)$/.exec(l))
      .map((m) => ({ key: m[1], text: m[2].trim() }));
    if (bank.length !== 15) throw new Error(`选词填空词库不是 15 个（${bank.length}）`);
    if (!/(26|2[6-9])______/.test(passage)) throw new Error("选词填空原文没有 26 空格标记");
    return { passage, bank };
  };

  const parseSectionB = () => {
    const block = readingRegion.slice(iB + 1, iC).filter((l) => !/^Directions\s*:/i.test(l));
    const paras = [];
    let current = null;
    const statements = [];
    for (let i = 0; i < block.length; i += 1) {
      const line = block[i];
      const labelOnly = /^([A-Z])\)$/.exec(line);
      const labelInline = /^([A-Z])\)\s+(.+)$/.exec(line);
      if (labelOnly) {
        if (current) paras.push(current);
        current = { label: labelOnly[1], text: [] };
        continue;
      }
      if (labelInline && statements.length === 0) {
        if (current) paras.push(current);
        current = { label: labelInline[1], text: [labelInline[2]] };
        continue;
      }
      if (isNumLine(line)) {
        if (current) {
          paras.push(current);
          current = null;
        }
        statements.push({ number: Number(line.slice(0, -1)), body: [] });
        continue;
      }
      if (statements.length) {
        const last = statements[statements.length - 1];
        // 题号行之后的第一行是题干；偶有续行，拼一起
        last.body.push(line);
      } else if (current) {
        current.text.push(line);
      }
    }
    if (current) paras.push(current);
    const paragraphs = paras.map((p) => ({ label: p.label, text: joinParas(p.text) }));
    return { paragraphs, statements };
  };

  const parseSectionC = () => {
    const block = readingRegion.slice(iC + 1);
    const out = [];
    for (let idx = 0; idx < block.length; idx += 1) {
      if (!/^Passage (One|Two)$/.test(block[idx])) continue;
      let j = idx + 1;
      const parasLines = [];
      while (j < block.length && !isNumLine(block[j]) && !/^Passage (One|Two)$/.test(block[j])) {
        const line = block[j];
        if (!/^Questions \d+ (to|and) \d+ are based on/i.test(line) && !/^Directions/i.test(line)) {
          parasLines.push(line);
        }
        j += 1;
      }
      const qLines = [];
      while (j < block.length && !/^Passage (One|Two)$/.test(block[j])) {
        qLines.push(block[j]);
        j += 1;
      }
      out.push({ paragraphs: parasLines, questions: parseQuestionBlocks(qLines) });
    }
    if (out.length !== 2) throw new Error(`仔细阅读篇数不是 2（${out.length}）`);
    return out;
  };

  const secA = parseSectionA();
  const secB = parseSectionB();
  const secC = parseSectionC();

  /* --- 翻译 --- */
  const transLines = lines
    .slice(iTrans + 1, iAnswers)
    .filter((l) => !/^Directions/i.test(l))
    // 卷面页会重复一行「英语四级2025年12月·第1套真题」的角标，别让它混进译文原文
    .filter((l) => !/^英语(四级|六级)\d{4}年.*真题/.test(l));
  const translationZh = joinParas(transLines);
  if (translationZh.length < 60) throw new Error("翻译原文过短");

  /* --- 答案速查 --- */
  const answerRegion = lines.slice(iAnswers);
  const answers = new Map();
  for (const line of answerRegion) {
    const re = /(\d{1,2})\s+([A-Z])(?=[\s·、（(]|$)/g;
    let m;
    while ((m = re.exec(line))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 55 && !answers.has(n)) answers.set(n, m[2]);
    }
  }
  if (answers.size < 45) throw new Error(`答案速查只解析出 ${answers.size} 题`);

  return { writingPrompt, secA, secB, secC, translationZh, answers, level };
}

/* ---------------- 解析页解析 ---------------- */

/** 写作页 → 参考范文 */
function parseModelEssay(lines) {
  const start = findLine(lines, /^【参考范文/);
  if (start < 0) return "";
  const end = findLine(lines, /^【参考译文】/, start + 1);
  const body = lines.slice(start + 1, end < 0 ? lines.length : end);
  return joinParas(body);
}

/** 翻译页 → 参考译文 */
function parseModelTranslation(lines) {
  const start = findLine(lines, /^参考译文$/);
  if (start < 0) return "";
  const body = [];
  for (let i = start + 1; i < lines.length && body.length < 6; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z]/.test(line) && /[.?!]$/.test(line)) body.push(line);
    else if (body.length) break;
  }
  return body.join(" ");
}

/**
 * 题型解析页 → Map<题号, { letter, type, evidence, detail }>
 * 三个题型的解析页版式不同，但都有【答案】；能取到「定位句 / 依据」就带上。
 */
function parseAnalysisPage(lines) {
  const map = new Map();
  const blocks = parseQuestionBlocks(lines.slice(findLine(lines, /^题目与逐题解析/) + 1));
  for (const block of blocks) {
    const body = block.body;
    const iAns = body.findIndex((l) => /^【答案】$/.test(l));
    if (iAns < 0) continue;
    const ansLine = body[iAns + 1] ?? "";
    const letter = /^([A-O])/.exec(ansLine)?.[1] ?? null;
    const type = /（(.+?)）/.exec(ansLine)?.[1] ?? null;
    // 定位句：C 型在【定位】下一行；A 型在【依据】下一行；B 型【定位】下是段号再下一行才是原句
    const evidence = [];
    for (const marker of ["【定位】", "【依据】"]) {
      const i = body.findIndex((l) => l.startsWith(marker));
      if (i < 0) continue;
      for (let k = i + 1; k < Math.min(i + 4, body.length); k += 1) {
        const line = body[k];
        if (/^【/.test(line)) break;
        if (/^[A-O]$|^[A-O] 段$/.test(line)) continue;
        if (line.length > 20) {
          evidence.push(line);
          break;
        }
      }
    }
    // 逐选项归因：解析页在【选项】/【竞争词】下逐项写「A) ✓ 正确」或「B) 偷换概念」再跟一句理由。
    // 这一段比任何单句摘要都有用，优先拼它；没有才退回块内最长的一行中文。
    const optIdx = body.findIndex((l) => /^【选项】$|^【竞争词】$|^【辨邻】$/.test(l));
    let optionNotes = null;
    if (optIdx >= 0) {
      const seg = body.slice(optIdx + 1);
      const items = [];
      for (let i = 0; i < seg.length; i += 1) {
        const m = /^([A-O])\)\s*(\S.*)$/.exec(seg[i]);
        if (!m) continue;
        const reason = [];
        for (let k = i + 1; k < seg.length && !/^([A-O])\)\s*\S/.test(seg[k]) && !/^【/.test(seg[k]); k += 1) {
          reason.push(seg[k]);
        }
        const tail = reason.join(" ").replace(/\s+/g, " ").trim();
        items.push(`${m[1]}) ${m[2]}${tail ? `：${tail.slice(0, 90)}` : ""}`);
      }
      if (items.length) optionNotes = items.slice(0, 4).join("\n");
    }
    const fallback = body
      .filter((l) => l.length > 30 && /[\u4e00-\u9fa5]/.test(l) && !/^【/.test(l))
      .sort((a, b) => b.length - a.length)[0];
    map.set(block.number, {
      letter,
      type,
      evidence: evidence[0] ?? null,
      detail: optionNotes ?? (fallback ? fallback.replace(/\s+/g, " ").trim() : null),
    });
  }
  return map;
}

/**
 * 拼一段人话解析。detail（逐选项归因）只给四选一用——选词填空页的那个「最长中文行」
 * 讲的是**别的空**为什么不行，挂到这一题会张冠李戴。
 */
function analysisText(info, fallbackLetter, extra, { detail = false } = {}) {
  const letter = info?.letter ?? fallbackLetter ?? null;
  const bits = [];
  if (letter) bits.push(`【答案】${letter}${info?.type ? `（${info.type}）` : `（${extra ? "官方答案" : "见正文"}）`}`);
  if (extra) bits.push(extra);
  if (info?.evidence) bits.push(`【原文】${info.evidence}`);
  if (detail && info?.detail) bits.push(info.detail);
  return bits.join("\n");
}

/* ---------------- 组卷 ---------------- */

function buildSections(existing, parsed, analyses, models, { shared = false, source = null } = {}) {
  const secAQuestions = [];
  for (let n = 26; n <= 35; n += 1) {
    const letter = parsed.answers.get(n);
    if (!letter) throw new Error(`答案缺第 ${n} 题`);
    const word = parsed.secA.bank.find((w) => w.key === letter);
    if (!word) throw new Error(`第 ${n} 题答案 ${letter} 不在词库里`);
    secAQuestions.push({
      number: n,
      stem: `Choose the word for blank ${n}.`,
      options: parsed.secA.bank.map((w) => ({ key: w.key, text: w.text })),
      answer: letter,
      type: "选词填空",
      analysis: analysisText(analyses.A.get(n), letter, `应填 ${letter}) ${word.text}`, { detail: true }),
    });
  }

  const letterPool = parsed.secB.paragraphs.map((p) => p.label);
  const secBQuestions = parsed.secB.statements
    .sort((a, b) => a.number - b.number)
    .map((st) => {
      const letter = parsed.answers.get(st.number);
      if (!letter) throw new Error(`答案缺第 ${st.number} 题`);
      // 匹配题的四个候选段落：正确项 + 邻近三段的干扰（页面用「选段落」呈现，和卷面「填段落字母」等价）
      const distractors = letterPool.filter((l) => l !== letter).slice(0, 3);
      const options = [letter, ...distractors]
        .sort((a, b) => a.localeCompare(b))
        .map((l) => ({ key: l, text: `Paragraph ${l}` }));
      return {
        number: st.number,
        stem: st.body.join(" ").replace(/\s+/g, " ").trim(),
        options,
        answer: letter,
        type: "信息匹配",
        analysis: analysisText(analyses.B.get(st.number), letter, null, { detail: true }),
      };
    });

  const buildChoice = (block, pageMap, from) => {
    const questions = block.questions.map((qb, i) => {
      const number = qb.number || from + i;
      const { stem, options } = splitStemOptions(qb.body);
      const letter = parsed.answers.get(number) ?? null;
      if (!letter) throw new Error(`答案缺第 ${number} 题`);
      if (options.length !== 4) throw new Error(`第 ${number} 题选项不是 4 个（${options.length}）`);
      return {
        number,
        stem,
        options,
        answer: letter,
        type: "阅读理解",
        analysis: analysisText(pageMap.get(number), letter, null, { detail: true }),
      };
    });
    if (questions.length !== 5) throw new Error(`仔细阅读题数不是 5（${questions.length}）`);
    return questions;
  };

  const c1 = buildChoice(parsed.secC[0], analyses.C1, 46);
  const c2 = buildChoice(parsed.secC[1], analyses.C2, 51);

  const paraLabel = (arr) => arr.map((text, i) => ({ label: String.fromCharCode(65 + i), text }));

  const readingPassages = [
    {
      order: 1,
      title: TITLES.A,
      paragraphs: [
        { label: "A", text: parsed.secA.passage },
        { label: "词库", text: parsed.secA.bank.map((w) => `${w.key}) ${w.text}`).join("\n") },
      ],
      questions: secAQuestions,
    },
    {
      order: 2,
      title: TITLES.B,
      paragraphs: parsed.secB.paragraphs,
      questions: secBQuestions,
    },
    {
      order: 3,
      title: TITLES.C1,
      paragraphs: paraLabel(parsed.secC[0].paragraphs),
      questions: c1,
    },
    {
      order: 4,
      title: TITLES.C2,
      paragraphs: paraLabel(parsed.secC[1].paragraphs),
      questions: c2,
    },
  ];

  const writingPassage = [
    {
      order: 1,
      title: "Writing",
      paragraphs: [],
      questions: [
        {
          number: 0,
          stem: parsed.writingPrompt,
          analysis: models.essay ? `【参考范文】\n${models.essay}` : "",
        },
      ],
    },
  ];

  const translationPassage = [
    {
      order: 1,
      title: "Translation",
      paragraphs: [],
      questions: [
        {
          number: 56,
          stem: `请将下面一段话译成英语：\n\n${parsed.translationZh}`,
          analysis: models.translation ? `【参考译文】\n${models.translation}` : "",
        },
      ],
    },
  ];

  return existing.map((sec) => {
    if (sec.type === "writing") return { ...sec, passages: writingPassage };
    if (sec.type === "reading") {
      return {
        ...sec,
        note: shared
          ? `本场次只出一份卷面，本套阅读与 ${source} 同卷（含选词填空、长篇匹配、两篇仔细阅读），原文、题目与答案均取自该套真题。`
          : "原文与题目逐字取自真题原卷，答案为官方答案，逐题解析据真题解析整理；阅读部分不再有仿真稿。",
        passages: readingPassages,
      };
    }
    if (sec.type === "translation") return { ...sec, passages: translationPassage };
    return sec;
  });
}

/* ---------------- 主流程 ---------------- */

const files = fs
  .readdirSync(PAPER_DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => !ONLY || f === `${ONLY}.json`)
  .sort();

if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = path.join(process.cwd(), "_backup", `papers-${stamp}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(PAPER_DIR, f), path.join(backup, f));
  console.log(`备份 ${files.length} 套 → ${path.relative(process.cwd(), backup)}`);
}

const report = [];
for (const f of files) {
  const file = path.join(PAPER_DIR, f);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const id = json.id;
  const parsedId = parseId(id);
  if (!parsedId) {
    report.push({ id, ok: false, why: "id 规则不匹配" });
    continue;
  }
  // 同一场次只出一份卷面：第三套（个别场次第二套）的卷面页只写「本部分与第 X 套共用」，
  // 没有正文。这种情况整卷按第 1 套取，并在 JSON 里记 sharedWith、页面上照实标注。
  const candidates = [id];
  const setM = /-s(\d)$/.exec(id);
  if (setM && setM[1] !== "1") candidates.push(id.replace(/-s\d$/, "-s1"));

  let lastErr = null;
  let wrote = false;

  for (const useId of candidates) {
    const usedId = parseId(useId);
    const url = (p) => `${BASE}/${usedId.level}/${p(usedId.slug)}`;
    try {
      const fullLines = await loadLines(`${useId}.full`, url(PARTS.full), { refresh: REFRESH, minChars: 5000 });
      const parsed = parseFullPaper(fullLines, usedId.level);

      const load = async (kind) => {
        try {
          return await loadLines(`${useId}.${kind}`, url(PARTS[kind]), { refresh: REFRESH, minChars: 1000 });
        } catch {
          return null;
        }
      };
      const [writingLines, transLines, aLines, bLines, c1Lines, c2Lines] = await Promise.all([
        load("writing"),
        load("translation"),
        load("secA"),
        load("secB"),
        load("secC1"),
        load("secC2"),
      ]);

      const analyses = {
        A: aLines ? parseAnalysisPage(aLines) : new Map(),
        B: bLines ? parseAnalysisPage(bLines) : new Map(),
        C1: c1Lines ? parseAnalysisPage(c1Lines) : new Map(),
        C2: c2Lines ? parseAnalysisPage(c2Lines) : new Map(),
      };
      const models = {
        essay: writingLines ? parseModelEssay(writingLines) : "",
        translation: transLines ? parseModelTranslation(transLines) : "",
      };

      const shared = useId !== id;
      const sections = buildSections(json.sections, parsed, analyses, models, { shared, source: useId });
      const reading = sections.find((s) => s.type === "reading");
      const qn = reading.passages.reduce((a, pg) => a + pg.questions.length, 0);
      if (qn !== 30) throw new Error(`阅读题数不是 30（${qn}）`);

      if (!DRY) {
        json.sections = sections;
        json.origin = "official";
        json.fullSource = {
          url: url(PARTS.full),
          ...(shared ? { sharedWith: useId } : {}),
          fetchedAt: new Date().toISOString().slice(0, 10),
          sections: ["writing", "reading", "translation"],
          readingQuestions: qn,
          modelEssay: Boolean(models.essay),
          modelTranslation: Boolean(models.translation),
        };
        fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      }
      report.push({
        id,
        ok: true,
        shared,
        qn,
        essay: models.essay.length,
        trans: models.translation.length,
        analysis: [analyses.A, analyses.B, analyses.C1, analyses.C2].map((m) => m.size).join("/"),
        words: reading.passages.reduce(
          (a, pg) => a + pg.paragraphs.reduce((x, y) => x + y.text.split(/\s+/).length, 0),
          0
        ),
        built: sections,
      });
      wrote = true;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!wrote) {
    report.push({ id, ok: false, why: String(lastErr?.message || lastErr).slice(0, 140) });
  }
}

const ok = report.filter((r) => r.ok);
const bad = report.filter((r) => !r.ok);
console.log(`\n套卷 ${report.length}｜成功 ${ok.length}｜失败 ${bad.length}`);
if (ok.length) {
  const avg = Math.round(ok.reduce((a, r) => a + r.words, 0) / ok.length);
  console.log(`阅读正文平均 ${avg} 词/卷；解析命中 ${ok[0].analysis}（A/B/C1/C2）`);
}
for (const r of bad) console.log(`  ✗ ${r.id}  ${r.why}`);
if (DRY && ok.length === 1) {
  const reading = ok[0].built.find((s) => s.type === "reading");
  const writing = ok[0].built.find((s) => s.type === "writing");
  const trans = ok[0].built.find((s) => s.type === "translation");
  console.log("\n样例：");
  console.log(`  写作题干：${writing.passages[0].questions[0].stem.slice(0, 110)}`);
  console.log(`  参考范文：${writing.passages[0].questions[0].analysis.slice(0, 60).replace(/\n/g, " ")}…`);
  for (const p of reading.passages) {
    console.log(`  ${p.title}｜段 ${p.paragraphs.length}｜题 ${p.questions.length}`);
    console.log(`    首题 ${p.questions[0].number}: ${p.questions[0].stem.slice(0, 80)}`);
    console.log(`    选项 ${p.questions[0].options.map((o) => `${o.key})${o.text.slice(0, 14)}`).join(" ")}`);
    console.log(`    答案 ${p.questions[0].answer}；解析 ${p.questions[0].analysis.slice(0, 100).replace(/\n/g, " / ")}`);
  }
  console.log(`  选词填空原文首句：${reading.passages[0].paragraphs[0].text.slice(0, 120).replace(/\n/g, " ")}`);
  console.log(`  翻译原文：${trans.passages[0].questions[0].stem.slice(0, 90).replace(/\n/g, " ")}`);
  console.log(`  参考译文：${trans.passages[0].questions[0].analysis.slice(0, 80).replace(/\n/g, " ")}`);
}
