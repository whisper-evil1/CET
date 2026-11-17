#!/usr/bin/env node
/**
 * 听力真题落地器：把「公开真题解析页」的整篇录音原文 + 25 题题干/选项/答案/解析
 * 抓成本地纯文本，解析成 data/papers/*.json 的听力 section。
 *
 * 设计取舍：
 *   1. **只搬真题，不改写**：原文逐字照搬（抓 HTML 后本地去标签），不扩写、不意译，
 *      句子只做「按句切分 + 估算播放时长」这类机械处理；
 *   2. **幂等**：同一套卷重复跑结果一致，`--only` 可单卷重跑；
 *   3. **可核对**：每套卷记下 source url 与抓取时间，页面上能看到出处；
 *   4. **不碰其它 section**：写作/阅读/翻译保持原样，只替换 listening。
 *
 * 用法：
 *   node scripts/lazynote-listening.mjs --dry              # 只抓+解析+自检，不写盘
 *   node scripts/lazynote-listening.mjs                    # 全部写回 data/papers
 *   node scripts/lazynote-listening.mjs --only cet4-2025-12-s2
 *   node scripts/lazynote-listening.mjs --refresh          # 重新抓（默认复用 _sources 缓存）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const PAPER_DIR = path.join(ROOT, "data", "papers");
const SRC_DIR = path.join(ROOT, "_sources", "lazynote");
fs.mkdirSync(SRC_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};
const DRY = flag("--dry");
const REFRESH = flag("--refresh");
const ONLY = val("--only");

const CJK = /[\u3400-\u9fff]/;
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—" };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

function htmlToLines(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ");
  // 只把「块级」标签换成换行；span 是行内标签，换行会把「A) 选项」撕成两行
  s = s.replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|blockquote|pre)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s).replace(/\r/g, "\n").replace(/[ \t\u00a0\u3000]+/g, " ");
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const clean = (s) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=[A-Za-z])/g, "$1 ")
    .trim();

function sourceUrl(id) {
  // cet4-2025-12-s2 → https://english-exam.lazynote.cn/cet4/sections/listening/2025-12-2/
  const m = /^(cet[46])-(\d{4})-(\d{2})-s(\d)$/.exec(id);
  if (!m) return null;
  return `https://english-exam.lazynote.cn/${m[1]}/sections/listening/${m[2]}-${m[3]}-${m[4]}/`;
}

async function loadLines(id, url) {
  const cache = path.join(SRC_DIR, `${id}.html`);
  let html = null;
  if (!REFRESH && fs.existsSync(cache)) {
    const buf = fs.readFileSync(cache);
    if (buf.length > 20000) html = buf.toString("utf8");
  }
  if (!html) {
    const buf = execFileSync("curl", ["-sL", "-m", "60", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", url], {
      maxBuffer: 48 * 1024 * 1024,
    });
    html = buf.toString("utf8");
    if (html.length < 20000) throw new Error(`页面过小（${html.length} 字节），可能 404/限流`);
    fs.writeFileSync(cache, html, "utf8");
  }
  return htmlToLines(html);
}

/* ---------------- 解析 ---------------- */

const MARKER = /^Questions\s+(\d+)\s*(?:to|and|&|-|–)\s*(\d+)\s+are based on the\s+(.+?)\s*\.?$/i;
const QMARK = /^(\d{1,3})\s*[.．]\s*$/;
const OPT = /^([A-D])\s*[)）]\s*(.+)$/;
const TAG = /^【(题目|翻译|答案|定位|信号|替换|排除)】$/;

/**
 * 篇目性质以**官方结构**为准，不信页面上的那句 "based on the …"
 *
 * 真题解析站的标题文字偶尔写错（2023-06 第一套把第 12–15 题的对话写成 passage），
 * 但题号区间是死的：四级 1–7 新闻、8–15 长对话、16–25 篇章；
 * 六级 1–8 长对话、9–15 篇章、16–25 讲座。按区间判，标题就不会串。
 */
function kindFromRange(from, level) {
  if (level === "cet6") {
    if (from <= 8) return "conversation";
    if (from <= 15) return "passage";
    return "recording";
  }
  if (from <= 7) return "news";
  if (from <= 15) return "conversation";
  return "passage";
}

/** 兜底：区间判不出来时，才回头看页面上的措辞 */
function kindOf(raw) {
  const t = raw.toLowerCase();
  if (t.includes("news")) return "news";
  if (t.includes("conversation")) return "conversation";
  if (t.includes("recording")) return "recording";
  return "passage";
}

const NOISE = /^(播放本篇|显示原文抽屉|收起原文|Directions[:：]|Part (I|II|III|IV)\b|Section [ABC]$|以下按|本卷全部|与试卷排版)/i;

/** 一篇正文：编号句子 + 紧随的中译行 */
function parseTranscript(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (NOISE.test(l)) continue;
    const m = /^(\d{1,3})[.)、]?\s+(\S.*)$/.exec(l);
    if (!m) continue;
    const text = clean(m[2]);
    if (!text || CJK.test(text)) continue;
    if (!/[A-Za-z]{2}/.test(text)) continue;
    const next = lines[i + 1];
    let zh = "";
    if (next && !NOISE.test(next) && CJK.test(next) && !/^\d{1,3}[.)、]?\s/.test(next)) {
      zh = clean(next);
      i += 1;
    }
    out.push({ n: Number(m[1]), text, zh });
  }
  return out;
}

/** 无编号时兜底：整段英文按句号切 */
function parseTranscriptFallback(lines) {
  const body = lines.filter((l) => !NOISE.test(l) && !CJK.test(l)).join(" ");
  return body
    .split(/(?<=[.!?])\s+(?=["“A-Z])/)
    .map((s) => clean(s))
    .filter((s) => s.length > 12)
    .map((text, i) => ({ n: i + 1, text, zh: "" }));
}

const TRAP = /^(未提及|原词陷阱|偷换概念|与原文相反|偷换范围|以偏概全|答案错位|张冠李戴|因果倒置|程度失当|无中生有|答非所问|过度推断|同义替换)/;

function parseQuestions(lines) {
  const out = [];
  let cur = null;
  let section = null;

  const push = () => {
    if (cur) out.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const qm = QMARK.exec(l);
    if (qm) {
      push();
      cur = { number: Number(qm[1]), options: [], stem: "", answer: "", type: "", evidencePara: "", evidence: "", signal: "", swap: "", trap: {} };
      section = "options";
      continue;
    }
    if (!cur) continue;

    const tag = TAG.exec(l);
    if (tag) {
      section = { 题目: "stem", 翻译: "stemZh", 答案: "answer", 定位: "ev", 信号: "signal", 替换: "swap", 排除: "trap" }[tag[1]];
      continue;
    }

    const om = OPT.exec(l);
    if (om) {
      if (section === "options" && cur.options.length < 4) {
        cur.options.push({ key: om[1], text: clean(om[2]) });
        continue;
      }
      if (section === "trap") {
        const rest = clean(om[2]);
        const tm = TRAP.exec(rest);
        cur.trap[om[1]] = tm ? { trap: tm[1], note: clean(rest.slice(tm[1].length)) } : { trap: "", note: rest };
        continue;
      }
      continue;
    }

    if (section === "stem" && !cur.stem) cur.stem = clean(l);
    else if (section === "answer" && !cur.answer) {
      const am = /^([A-D])\s*(?:[（(]([^）)]*)[）)])?\s*(.*)$/.exec(clean(l));
      if (am) {
        cur.answer = am[1];
        cur.type = clean(am[2] ?? "");
      }
    } else if (section === "ev") {
      if (/^[A-Z]\d{1,2}$/.test(l)) cur.evidencePara = l;
      else if (cur.evidencePara && !cur.evidence && !CJK.test(l)) cur.evidence = clean(l);
    } else if (section === "signal" && !cur.signal) cur.signal = clean(l);
    else if (section === "swap" && !cur.swap) cur.swap = clean(l);
    else if (section === "trap" && /^借用原文/.test(l) && cur.lastTrapKey) {
      cur.trap[cur.lastTrapKey].note = clean(`${cur.trap[cur.lastTrapKey].note} ${l}`);
    }
    if (section === "trap" && cur.trap) {
      const keys = Object.keys(cur.trap);
      if (keys.length) cur.lastTrapKey = keys[keys.length - 1];
    }
  }
  push();
  return out;
}

const TITLES = {
  news: ["News Report One", "News Report Two", "News Report Three"],
  conversation: ["Conversation One", "Conversation Two", "Conversation Three"],
  passage: ["Passage One", "Passage Two", "Passage Three"],
  recording: ["Recording One", "Recording Two", "Recording Three"],
};

/** 按词数估算时长：语速约 2.6 词/秒，句间留 0.35 秒气口 */
function buildTranscript(sentences) {
  let t = 0;
  return sentences.map((s, i) => {
    const words = s.text.split(/\s+/).filter(Boolean).length;
    const dur = Math.max(1.4, words / 2.6);
    const start = Number(t.toFixed(1));
    const end = Number((t + dur).toFixed(1));
    t = end + 0.35;
    return { id: i + 1, start, end, text: s.text, ...(s.zh ? { zh: s.zh } : {}) };
  });
}

function packAnalysis(q) {
  const bits = [];
  // 原文的题型标签自带「题」字（细节题/推断题），避免拼成「细节题题」
  const type = (q.type || "").replace(/题$/, "");
  if (type) bits.push(`${type}题。`);
  if (q.evidence) bits.push(`答案句${q.evidencePara ? `（${q.evidencePara}）` : ""}：${q.evidence}`);
  if (q.signal) {
    const signal = q.signal.length > 110 ? `${q.signal.slice(0, 108)}…` : q.signal;
    bits.push(`信号：${signal}`);
  }
  return bits.join("");
}

function toOptionAnalysis(q) {
  const map = {};
  for (const [k, v] of Object.entries(q.trap)) {
    map[k] = v.trap ? `${v.trap}：${v.note}` : v.note;
  }
  if (q.answer) map[q.answer] = q.swap ? `正确项：与答案句同义替换（${q.swap}）` : "正确项：与录音原句一致。";
  return Object.keys(map).length ? map : null;
}

function parsePaper(lines, id) {
  let start = lines.findIndex((l) => MARKER.test(l));
  if (start < 0) throw new Error("找不到任何 Questions … are based on the 标记");
  // 回退到该篇所属的 Section 标题（留作上下文，不影响解析）
  let end = lines.findIndex((l, i) => i > start && /^Part III/.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start, end);

  const level = /^cet6/.test(id) ? "cet6" : "cet4";
  const marks = [];
  body.forEach((l, i) => {
    const m = MARKER.exec(l);
    if (m) {
      const from = Number(m[1]);
      const byRange = kindFromRange(from, level);
      marks.push({ i, from, to: Number(m[2]), kind: byRange ?? kindOf(m[3]), label: m[3] });
    }
  });

  const counters = {};
  const passages = [];
  for (let k = 0; k < marks.length; k += 1) {
    const mk = marks[k];
    const stop = k + 1 < marks.length ? marks[k + 1].i : body.length;
    const chunk = body.slice(mk.i + 1, stop);
    const qAt = chunk.findIndex((l) => QMARK.test(l));
    const textPart = qAt >= 0 ? chunk.slice(0, qAt) : chunk;
    const qPart = qAt >= 0 ? chunk.slice(qAt) : [];
    let sentences = parseTranscript(textPart);
    if (sentences.length < 3) sentences = parseTranscriptFallback(textPart);
    const qs = parseQuestions(qPart);

    counters[mk.kind] = (counters[mk.kind] ?? 0) + 1;
    const ordinal = counters[mk.kind];
    const title =
      (TITLES[mk.kind] ?? TITLES.passage)[ordinal - 1] ??
      `${mk.kind === "news" ? "News Report" : mk.kind === "conversation" ? "Conversation" : mk.kind === "recording" ? "Recording" : "Passage"} ${ordinal}`;
    const transcript = buildTranscript(sentences);
    passages.push({
      title,
      kind: mk.kind,
      range: [mk.from, mk.to],
      transcript,
      audioDuration: transcript.length ? transcript[transcript.length - 1].end : 0,
      questions: qs.map((q) => ({
        number: q.number,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: packAnalysis(q),
        optionAnalysis: toOptionAnalysis(q),
        evidencePara: q.evidencePara || null,
        evidenceText: q.evidence || null,
        type: q.type || null,
      })),
    });
  }
  return passages;
}

/** 自检：题号 1..25 全覆盖、每题 4 选项、答案 A–D、原文句数够 */
function audit(passages) {
  const errs = [];
  const all = passages.flatMap((p) => p.questions);
  const nums = all.map((q) => q.number).sort((a, b) => a - b);
  const expect = Array.from({ length: 25 }, (_, i) => i + 1);
  if (nums.length !== 25) errs.push(`题数 ${nums.length}`);
  const missing = expect.filter((n) => !nums.includes(n));
  if (missing.length) errs.push(`缺题 ${missing.join(",")}`);
  for (const p of passages) {
    if (p.transcript.length < 3) errs.push(`${p.title} 原文过短(${p.transcript.length} 句)`);
    for (const q of p.questions) {
      if (!q.stem) errs.push(`第 ${q.number} 题缺题干`);
      const alpha = q.options.map((o) => o.key).join("");
      if (alpha !== "ABCD") errs.push(`第 ${q.number} 题选项 ${alpha || "空"}`);
      if (!/^[A-D]$/.test(q.answer)) errs.push(`第 ${q.number} 题答案异常(${q.answer || "空"})`);
    }
  }
  return errs;
}

/* ---------------- 主流程 ---------------- */

const files = fs
  .readdirSync(PAPER_DIR)
  .filter((f) => f.endsWith(".json"))
  .filter((f) => (ONLY ? f === `${ONLY}.json` : true))
  .sort();

const report = [];
for (const f of files) {
  const file = path.join(PAPER_DIR, f);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const id = json.id;
  const url = sourceUrl(id);
  if (!url) {
    report.push({ id, ok: false, why: "id 解析失败" });
    continue;
  }
  try {
    // 多套卷规则：一场考试只播一份听力，多套卷的差别只在阅读/写译（选项顺序可能打乱）。
    // 所以真题站往往只挂第一套的听力解析页，第二、三套的听力解析页 404。
    // 取不到自己那套时按同场第一套取，并在 JSON 里写明 sharedWith、页面上照实标注，
    // 不冒充「本套独有」。实测 2022-06 就是这种情形（只有 -1 有听力页）。
    const sources = [id];
    const setNo = /-s(\d)$/.exec(id);
    if (setNo && setNo[1] !== "1") sources.push(id.replace(/-s\d$/, "-s1"));
    let lines = null;
    let usedId = id;
    let lastErr = null;
    for (const candidate of sources) {
      const candidateUrl = sourceUrl(candidate);
      if (!candidateUrl) continue;
      try {
        lines = await loadLines(candidate, candidateUrl);
        usedId = candidate;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!lines) throw lastErr ?? new Error("抓取失败");
    const passages = parsePaper(lines, id);
    const errs = audit(passages);
    const qn = passages.flatMap((p) => p.questions).length;
    const sn = passages.reduce((a, p) => a + p.transcript.length, 0);
    if (errs.length) {
      report.push({ id, ok: false, why: errs.slice(0, 4).join("；"), qn, sn, url });
      continue;
    }
    if (!DRY) {
      const shared = usedId !== id;
      const sections = json.sections.map((s) => {
        if (s.type !== "listening") return s;
        return {
          type: "listening",
          title: s.title ?? "Section II Listening Comprehension",
          note: shared
            ? "本场次听力只有一份音频，本套听力与同场第一套同卷；原文、题目与答案取自该套真题。考场多套卷的选项顺序可能不同，这里沿用第一套的顺序。在线音频由语音合成朗读原文，不是考场录音；换浏览器、换手机都能播。"
            : "听力为历年真题原文，题目与答案为官方标准答案；在线音频由语音合成朗读原文，不是考场录音；换浏览器、换手机都能播。",
          passages: passages.map((p) => ({
            title: p.title,
            kind: p.kind,
            transcript: p.transcript,
            audioDuration: p.audioDuration,
            questions: p.questions,
          })),
        };
      });
      json.sections = sections;
      // 只把听力换成真题；阅读/写作/翻译仍是仿真稿，所以整卷记 hybrid，页面上照实标「真题听力」
      json.origin = "hybrid";
      json.listeningSource = {
        url: sourceUrl(usedId),
        ...(shared ? { sharedWith: usedId } : {}),
        fetchedAt: new Date().toISOString().slice(0, 10),
        passages: passages.length,
        sentences: sn,
      };
      fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    }
    report.push({ id, ok: true, passages: passages.length, qn, sn, shared: usedId !== id, url: sourceUrl(usedId) });
  } catch (err) {
    report.push({ id, ok: false, why: String(err.message || err).slice(0, 160), url });
  }
}

const ok = report.filter((r) => r.ok);
const bad = report.filter((r) => !r.ok);
console.log(`\n套卷 ${report.length}｜成功 ${ok.length}｜失败 ${bad.length}${DRY ? "（dry-run，未写盘）" : ""}`);
if (ok.length) {
  const sn = ok.reduce((a, r) => a + r.sn, 0);
  console.log(`共 ${ok.reduce((a, r) => a + r.qn, 0)} 道听力真题、${sn} 句原文（均取自真题解析页，逐字未改写）`);
}
for (const r of bad) console.log(`  ✗ ${r.id}  ${r.why}`);
