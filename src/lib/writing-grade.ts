/**
 * 写作 / 翻译批改：提示词构造 + 本地规则批改。
 *
 * 这个模块是纯函数、不碰数据库，前后端共用：
 *   - 浏览器直连云模型时，用它构造系统提示词；
 *   - 服务端 /api/ai/grade 用同一份构造，保证两条通道给的要求一致；
 *   - 没有 AI Key 时，用 buildLocalReview 依据学生**真实作答**出一份可执行的批改，
 *     而不是「当前是演示模式」那种通用套话。
 *
 * 之前这里复用的是阅读答疑的提示词与 mock 模板，所以对着翻译题会讲
 * 「回原文扫一遍找到同一段」——那套技巧对翻译毫无意义。因此单独成模块。
 */

export type GradeType = "writing" | "translation";

export type GradeInput = {
  type: GradeType;
  /** 题干（翻译题是中文原文 + directions） */
  stem: string;
  /** 参考译文 / 参考范文，可能为空 */
  reference: string | null;
  /** 学生作答 */
  answer: string;
  paperTitle?: string;
  /** CET4 / CET6，用于定词数要求 */
  level?: string | null;
};

const isTranslation = (t: GradeType) => t === "translation";
const taskName = (t: GradeType) => (isTranslation(t) ? "翻译" : "写作");

/* ---------------- 系统提示词 ---------------- */

export function buildGradePrompt(input: GradeInput): string {
  const task = taskName(input.type);
  const ref = input.reference?.trim();

  if (isTranslation(input.type)) {
    return `你是四六级英语考试的翻译阅卷老师，正在批改一名学生的汉译英。

【题目原文】
${input.stem}

【参考译文】
${ref || "（本题暂无参考译文，请依据原文自行判断信息是否传达完整）"}

批改要求：
1. 先给分数：按四六级翻译 15 分制给一个具体分数，并说明落在哪一档。
2. 逐句对照原文，指出**漏译、误译、语法错误、用词不当**，要引用学生的原句片段，不要泛泛而谈。
3. 特别检查：时态是否统一、主谓是否一致、冠词与单复数、中文标点是否残留、专有名词与数字是否准确。
4. 给出 2–3 处可以直接替换的高分表达，写成「原句 → 建议」的形式。
5. 用中文点评，英文例句保留英文。总长度控制在 600 字以内，直接给结论，不要复述题目。`;
  }

  return `你是四六级英语考试的写作阅卷老师，正在批改一名学生的作文。

【题目要求】
${input.stem}

【参考范文】
${ref || "（本题暂无参考范文，请依据题目要求自行判断是否切题）"}

批改要求：
1. 先给分数：按四六级写作 15 分制给一个具体分数，并说明落在哪一档。
2. 从**内容切题、结构组织、语言准确、句式多样**四个维度分别点评，每个维度都要引用学生的原句作为依据。
3. 指出具体的语法与用词错误（主谓一致、时态、搭配、冠词、拼写），逐条列出错误片段和改法。
4. 如果通篇是模板套话（如 with the development of、every coin has two sides），直接点出来并给出替换思路。
5. 用中文点评，英文例句保留英文。总长度控制在 600 字以内，直接给结论，不要复述题目。`;
}

/* ---------------- 本地规则批改 ---------------- */

const CONNECTIVES = [
  "however",
  "therefore",
  "moreover",
  "furthermore",
  "in addition",
  "besides",
  "consequently",
  "as a result",
  "on the one hand",
  "on the other hand",
  "whereas",
  "although",
  "though",
  "while",
  "nevertheless",
  "nonetheless",
  "thus",
  "hence",
  "meanwhile",
  "in contrast",
  "for instance",
  "for example",
  "what is more",
  "to begin with",
  "first of all",
  "last but not least",
  "in conclusion",
  "to sum up",
];

const CLICHES = [
  "with the development of",
  "with the rapid development of",
  "every coin has two sides",
  "as we all know",
  "as is known to all",
  "it is universally acknowledged",
  "in a word",
  "last but not least",
  "there is no denying that",
  "plays an increasingly important role",
];

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "being", "it", "its", "this",
  "that", "these", "those", "we", "our", "they", "their", "he", "she", "his", "her", "i",
  "you", "your", "not", "no", "do", "does", "did", "has", "have", "had", "will", "would",
  "can", "could", "should", "may", "might", "must", "there", "here", "which", "who", "whom",
  "what", "when", "where", "why", "how", "all", "also", "more", "most", "some", "any", "many",
  "much", "such", "than", "then", "so", "very", "just", "only", "own", "same", "other",
]);

type Metrics = {
  words: number;
  sentences: string[];
  sentenceCount: number;
  avgLen: number;
  paragraphs: number;
  connectives: string[];
  cliches: string[];
  chinesePunct: string[];
  doubleSpace: number;
  repeated: string[];
  lowerStart: boolean;
  spaceBeforePunct: number;
};

function measure(answer: string): Metrics {
  const text = answer.replace(/\r\n/g, "\n").trim();
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  // 句末标点后接空白处切开。这里刻意不用正则后行断言（lookbehind）：
  // 正则是解析期语法，Safari 16.4 以下不支持后行断言会让整个 chunk 直接报错白屏，
  // 因此改为「先把句末标点替换成哨兵，再按哨兵切」。
  const SENTINEL = "\u0001";
  const marked = text.replace(/([.!?][)\]"']?)\s+/g, `$1${SENTINEL}`);
  const sentences = marked
    .split(/[\u0001\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const lower = text.toLowerCase();

  const connectives = CONNECTIVES.filter((c) => lower.includes(c));
  const cliches = CLICHES.filter((c) => lower.includes(c));

  // 中文标点混进英文（全角逗号句号最典型）
  const chinesePunct: string[] = [];
  for (const ch of ["，", "。", "；", "：", "！", "？", "、", "（", "）", "“", "”"]) {
    if (text.includes(ch)) chinesePunct.push(ch);
  }

  const doubleSpace = (text.match(/\S {2,}\S/g) ?? []).length;
  const spaceBeforePunct = (text.match(/\s+[,.!?;:]/g) ?? []).length;

  // 连续重复词：the the / very very
  const repeated: string[] = [];
  const wordList = text.match(/[A-Za-z']+/g) ?? [];
  for (let i = 1; i < wordList.length; i++) {
    if (wordList[i].toLowerCase() === wordList[i - 1].toLowerCase() && wordList[i].length > 1) {
      repeated.push(wordList[i - 1].toLowerCase());
    }
  }

  const firstLetter = text.match(/[A-Za-z]/)?.[0] ?? "";
  const lowerStart = firstLetter !== "" && firstLetter === firstLetter.toLowerCase();

  return {
    words: words.length,
    sentences,
    sentenceCount: sentences.length,
    avgLen: sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    connectives,
    cliches,
    chinesePunct,
    doubleSpace,
    repeated: [...new Set(repeated)],
    lowerStart,
    spaceBeforePunct,
  };
}

const quote = (s: string, max = 56) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const contentWords = (s: string) =>
  (s.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

/** 参考译文覆盖率：学生译文命中了多少参考译文的实词 */
function coverage(reference: string, answer: string): { hit: number; total: number; ratio: number } {
  const ref = [...new Set(contentWords(reference))];
  if (ref.length === 0) return { hit: 0, total: 0, ratio: 1 };
  const mine = new Set(contentWords(answer));
  const hit = ref.filter((w) => mine.has(w)).length;
  return { hit, total: ref.length, ratio: hit / ref.length };
}

/**
 * 只保留含汉字的行。
 * 题干通常是「英文指令 + 中文原文」拼接（For this part, you are allowed 30 minutes…），
 * 若直接从整段题干抽数字，会把指令里的 30 分钟也算成"原文里的信息"，
 * 于是学生明明译完了原文，却被判「数字没译到」——误报。
 */
function cjkLines(stem: string): string {
  return stem
    .split(/\n+/)
    .filter((line) => /[\u4e00-\u9fff]/.test(line))
    .join("\n");
}

/**
 * 英文数字词。
 * 学生完全可能把 2000 写成 "two thousand"、120 写成 "one hundred and twenty"，
 * 这种译法是对的。仅按阿拉伯数字串查找会把人冤枉成"漏译"，
 * 所以只要作答里出现数字词，就整条跳过数字核对——宁可漏报，不要误报。
 */
const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)\b/i;

/** 题干中文部分里的数字学生是否译到（译成英文数字词的视为译到） */
function missedNumbers(stem: string, answer: string): string[] {
  const source = cjkLines(stem);
  if (!source) return [];
  if (NUMBER_WORDS.test(answer)) return [];
  const nums = [...new Set(source.match(/\d+(?:[.,]\d+)?%?/g) ?? [])];
  const flat = answer.replace(/,/g, "");
  return nums.filter((n) => !flat.includes(n.replace(/,/g, "")));
}

/** 题干括号里给出的英文术语（专有名词），学生是否照用 */
function missedTerms(stem: string, answer: string): string[] {
  const terms = [...cjkLines(stem).matchAll(/[（(]\s*([A-Za-z][A-Za-z\s.'-]{2,})\s*[）)]/g)]
    .map((m) => m[1].trim())
    .filter((t) => t.split(/\s+/).length <= 5);
  const lower = answer.toLowerCase();
  return [...new Set(terms)].filter((t) => !lower.includes(t.toLowerCase()));
}

function minWords(level: string | null | undefined): number {
  const l = (level ?? "").toUpperCase();
  if (l.includes("6")) return 150;
  return 120;
}

export function buildLocalReview(input: GradeInput): string {
  const m = measure(input.answer);
  const task = taskName(input.type);
  const round = (n: number) => Math.round(n * 2) / 2;

  let score = 15;
  const problems: string[] = [];
  const goods: string[] = [];

  /* ---- 通用扣分 ---- */
  if (m.chinesePunct.length > 0) {
    score -= 1.5;
    problems.push(
      `**混入了中文标点**：出现了 ${m.chinesePunct.map((c) => `\`${c}\``).join(" ")}。英文里必须换成半角 \`, . ; : ? !\`，考场上这一项会直接拉低语言分。`,
    );
  }
  if (m.repeated.length > 0) {
    score -= 0.5;
    problems.push(
      `**重复用词**：${m.repeated.map((w) => `\`${w} ${w}\``).join("、")}。连写两遍同一个词通常是笔误，检查一下是不是想写两个不同的词。`,
    );
  }
  if (m.doubleSpace > 0 || m.spaceBeforePunct > 0) {
    score -= 0.5;
    problems.push(
      `**空格不规范**：${m.doubleSpace > 0 ? `有 ${m.doubleSpace} 处连续空格` : ""}${m.doubleSpace > 0 && m.spaceBeforePunct > 0 ? "，" : ""}${m.spaceBeforePunct > 0 ? `有 ${m.spaceBeforePunct} 处在标点前多了空格` : ""}。标点前不留空格、标点后留一个。`,
    );
  }
  if (m.lowerStart) {
    score -= 0.5;
    problems.push(`**句首没大写**：第一句是「${quote(m.sentences[0] ?? "")}」，句首字母应大写。`);
  }
  if (m.sentenceCount > 0 && m.avgLen < 7) {
    score -= 1;
    problems.push(
      `**句子太碎**：${m.sentenceCount} 句平均只有 ${m.avgLen} 词，读起来是断的。试着用 \`which\`/\`because\`/\`although\` 把短句并成复合句。`,
    );
  }
  if (m.avgLen > 35) {
    score -= 0.5;
    problems.push(
      `**长句失控**：平均句长 ${m.avgLen} 词，最长一句是「${quote([...m.sentences].sort((a, b) => b.length - a.length)[0] ?? "")}」。一逗到底容易被判语法错误，建议拆成两到三句。`,
    );
  }

  /* ---- 分题型 ---- */
  if (isTranslation(input.type)) {
    if (m.words < 50) {
      score -= 4;
      problems.push(
        `**篇幅严重不足**：只有 ${m.words} 词。四六级翻译原文通常 140–160 个汉字，完整译文一般在 90 词以上，说明有大段漏译。`,
      );
    } else if (m.words < 80) {
      score -= 2;
      problems.push(`**篇幅偏短**：${m.words} 词，对照原文长度仍有信息没译出来。`);
    } else {
      goods.push(`篇幅到位：${m.words} 词，与原文的信息量基本匹配。`);
    }

    const ref = input.reference?.trim();
    if (ref) {
      const cov = coverage(ref, input.answer);
      if (cov.total > 0) {
        const pct = Math.round(cov.ratio * 100);
        if (cov.ratio < 0.2) {
          score -= 2;
          problems.push(
            `**关键信息偏离参考译文**：参考译文的实词只命中了 ${pct}%（${cov.hit}/${cov.total}）。要么换了说法，要么确实漏译，对着参考译文逐句核一遍。`,
          );
        } else if (cov.ratio < 0.35) {
          score -= 1;
          problems.push(
            `**用词与参考译文差异较大**：实词命中 ${pct}%（${cov.hit}/${cov.total}）。意思对就不扣分，但要确认没有把关键名词换成近义但不等义的词。`,
          );
        } else {
          goods.push(`关键信息抓得准：参考译文的实词命中 ${pct}%，主要信息都传达出来了。`);
        }
      }
    }

    const missNum = missedNumbers(input.stem, input.answer);
    if (missNum.length > 0) {
      score -= 2;
      problems.push(
        `**数字没译到**：原文里的 ${missNum.map((n) => `\`${n}\``).join("、")} 在译文里找不到。数字、年代、百分比是翻译的硬采分点，漏一个就扣一处。`,
      );
    }

    const missTerm = missedTerms(input.stem, input.answer);
    if (missTerm.length > 0) {
      score -= Math.min(2, missTerm.length);
      problems.push(
        `**给定术语没用上**：题目括号里已经给了 ${missTerm.map((t) => `\`${t}\``).join("、")}，译文里没有出现。给了标准译法就照抄，自己另译反而扣分。`,
      );
    }
  } else {
    const need = minWords(input.level);
    // 四六级对篇幅是硬要求：不足六成基本等于内容没写完，扣分必须到位，
    // 否则一篇 55 词的作文还能给到 11 分，与实际阅卷差太远。
    if (m.words < need * 0.5) {
      score -= 7;
      problems.push(
        `**字数严重不足**：${m.words} 词，要求 ${need} 词左右，连一半都不到，等于没有写完，内容分基本拿不到。先把每一段补到 3–4 句。`,
      );
    } else if (m.words < need * 0.6) {
      score -= 5;
      problems.push(`**字数严重不足**：${m.words} 词，要求 ${need} 词左右，不到六成，内容分很难拿到。`);
    } else if (m.words < need * 0.85) {
      score -= 2.5;
      problems.push(`**字数偏少**：${m.words} 词，要求 ${need} 词左右，少了约 ${need - m.words} 词，论述展开不够。`);
    } else {
      goods.push(`字数达标：${m.words} 词（要求 ${need} 词左右）。`);
    }

    if (m.paragraphs <= 1) {
      score -= 1.5;
      problems.push(
        `**没有分段**：整篇只有 ${m.paragraphs || 1} 段。四六级作文建议三段——引出观点、展开论证、总结，段落本身就是结构分。`,
      );
    } else {
      goods.push(`分段清楚：共 ${m.paragraphs} 段，结构可读。`);
    }

    if (m.cliches.length >= 2) {
      score -= 1.5;
      problems.push(
        `**模板套话偏多**：出现了 ${m.cliches.map((c) => `\`${c}\``).join("、")}。这类句式阅卷时一眼能认出，用多了会被判背诵模板，建议换成具体到本题的说法。`,
      );
    } else if (m.cliches.length === 1) {
      score -= 0.5;
      problems.push(`**有一处模板套话**：\`${m.cliches[0]}\`，可以换成更贴题的表达。`);
    }
  }

  if (m.connectives.length === 0) {
    score -= 1.5;
    problems.push(
      `**缺连接词**：全文没有 however / therefore / in addition 这类衔接词，句子是并列堆着的。加 3–4 个就能明显提升连贯性。`,
    );
  } else {
    goods.push(`有衔接意识：用了 ${m.connectives.slice(0, 5).map((c) => `\`${c}\``).join("、")}${m.connectives.length > 5 ? " 等" : ""}。`);
  }

  if (m.words >= 20) {
    const longest = [...m.sentences].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length > 40) {
      goods.push(`有复杂句意识：最长一句写了 ${longest.split(/\s+/).length} 词（「${quote(longest)}」），说明不是只敢写简单句。`);
    }
  }

  score = Math.max(3, Math.min(15, round(score)));

  const tier =
    score >= 13
      ? "属于高分段，语言基本准确，个别地方打磨一下就是满分档"
      : score >= 10
        ? "属于中上水平，意思能传达，但语言准确性还有明显的提分空间"
        : score >= 7
          ? "属于中等偏下，能看出想表达什么，但错误比较密集，会持续拉低分数"
          : "属于低分段，建议先解决基本语法和句子完整性，再谈表达";

  const lines: string[] = [];
  lines.push(`## 批改结果：${score} / 15`);
  lines.push("");
  lines.push(`**总评**：${tier}。本次共 ${m.words} 词、${m.sentenceCount} 句、平均句长 ${m.avgLen} 词。`);
  lines.push("");

  if (goods.length > 0) {
    lines.push("**做得好的**");
    lines.push("");
    for (const g of goods) lines.push(`- ${g}`);
    lines.push("");
  }

  if (problems.length > 0) {
    lines.push("**需要改进的**");
    lines.push("");
    problems.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
    lines.push("");
  } else {
    lines.push("**需要改进的**");
    lines.push("");
    lines.push("- 规则检查没发现明显硬伤。建议再读一遍，重点看论证是否有展开、有没有更贴切的词可以替换。");
    lines.push("");
  }

  const ref = input.reference?.trim();
  if (ref) {
    lines.push("**对照参考" + (isTranslation(input.type) ? "译文" : "范文") + "**");
    lines.push("");
    lines.push(`> ${quote(ref, 220)}`);
    lines.push("");
    lines.push(
      isTranslation(input.type)
        ? "对着这一段逐句比：它的语序、时态、专有名词是怎么处理的，尤其是你漏掉的那几处信息它放在了哪个位置。"
        : "重点看它的段落怎么分配、每段第一句怎么立论，这两点模仿起来见效最快。",
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `以上由本地规则逐项检查得出（字数、句长、衔接词、标点、数字与术语覆盖等${isTranslation(input.type) ? "翻译" : "写作"}硬指标）。云模型可用时会给出逐句的语义点评。`,
  );

  return lines.join("\n");
}
