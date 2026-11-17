import type { Paragraph, PracticePassage, QuestionOption } from "./types";

/**
 * 阅读板块的三种真实答题形态。
 *
 * 四级的阅读（Section III）从来不是「十道四选一」：
 *   1. Section A 选词填空：一篇挖了 10 个空的短文 + 15 个词（A–O），一个词只用一次
 *   2. Section B 长篇阅读匹配：10 个陈述句，各自去找对应的段落字母（A–H，可重复）
 *   3. Section C 仔细阅读：两篇短文 × 5 题，才是标准的 A–D 四选一
 *
 * 以前前端把三者统一当 A–D 处理，于是：
 *   - 选词填空的答案字母（L / E / J …）提交时被 A–D 的校验拦掉，表现为「答不起」
 *   - 匹配题的选项在库里只存了 A–D 四个「Paragraph X」占位，题干下自然选不出 E/F
 *   - 选词填空把 15 个词原样贴到每一道题下面，出现十份一样的选项列表
 *
 * 这个模块只做一件事：从 passage 数据里把「这道题该怎么答」推导出来，
 * 组件层不再自己猜题型。
 */
export type ReadingTaskKind = "banked" | "matching" | "choice";

export type BlankSlot = {
  /** 空号，如 26 */
  number: number;
  /** 对应的题目 id */
  questionId: string;
};

export type ReadingTask = {
  kind: ReadingTaskKind;
  /** 左栏正文段落：选词填空会剔除掉「词库」那一段 */
  paragraphs: Paragraph[];
  /** 选词填空的共享词库（A–O） */
  wordBank: QuestionOption[];
  /** 段落匹配可选的段落字母 */
  letters: string[];
  /** 选词填空正文里的空号 → 题目 */
  blanks: BlankSlot[];
  /** 顶部板块名 */
  board: string;
  /** 一句话答题说明 */
  instruction: string;
  /** 空号在正文里出现的格式是否完整（数据缺格式时退化为纯清单） */
  hasInlineBlanks: boolean;
};

const SINGLE_LETTER = /^[A-Z]$/;
/** 正文里的空号：26______ / 26____ （两位数字 + 两条以上下划线） */
const BLANK_PATTERN = /\b(\d{2})\s*_{2,}/g;
/** 词库段落里形如 "A) arrival" 的条目 */
const BANK_WORD_PATTERN = /([A-O])\s*[)）.．、]\s*([A-Za-z][A-Za-z'’-]*)/g;

function isParagraphLabel(label: string) {
  return SINGLE_LETTER.test(label.trim());
}

/** 从「词库」段落文本里兜底解析单词表（题目 options 缺失时才用） */
function parseBankWords(text: string): QuestionOption[] {
  const out: QuestionOption[] = [];
  const seen = new Set<string>();
  BANK_WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BANK_WORD_PATTERN.exec(text)) !== null) {
    const key = match[1]!;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text: match[2]! });
  }
  return out;
}

/** 把正文里出现的空号按出现顺序收集起来 */
export function collectBlankNumbers(paragraphs: Paragraph[]): number[] {
  const numbers: number[] = [];
  const seen = new Set<number>();
  for (const paragraph of paragraphs) {
    BLANK_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BLANK_PATTERN.exec(paragraph.text)) !== null) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || seen.has(value)) continue;
      seen.add(value);
      numbers.push(value);
    }
  }
  return numbers;
}

/** 判断 options 是不是「Paragraph A」这类占位文本（匹配题的历史脏数据） */
function looksLikeParagraphOptions(options: QuestionOption[]) {
  if (options.length === 0) return false;
  return options.every((option) => /^paragraph\s+[A-Z]$/i.test(option.text.trim()));
}

export function detectReadingTask(passage: PracticePassage): ReadingTask {
  const title = passage.title ?? "";
  const questions = passage.questions;
  const first = questions[0];
  const options = first?.options ?? [];

  // 「词库」段落的 label 不是单个大写字母，这是选词填空的强特征
  const bankParagraph = passage.paragraphs.find((p) => !isParagraphLabel(p.label));
  const contentParagraphs = bankParagraph
    ? passage.paragraphs.filter((p) => p !== bankParagraph)
    : passage.paragraphs;

  const bankedByTitle = /选词|banked|cloze/i.test(title);
  /** 选词填空：词库是 A–O 的单词，选项一律是单个英文词，且至少 8 个 */
  const bankedByShape =
    options.length >= 8 && options.every((option) => /^[A-Za-z][A-Za-z'’\-]*$/.test(option.text.trim()));
  const matchingByTitle = /匹配|matching/i.test(title);
  const matchingByShape = looksLikeParagraphOptions(options);

  /* 匹配题必须先判。
     它的选项同样是 A/B/C…，数量等于段落数（常为 7 段 = 7 个选项），
     旧判据「选项超过 6 个就是选词填空」会把 Section B 直接判成选词填空：
     正文上方挂出一排 A) Paragraph C 的「词库」，十个陈述句变成十个空号，
     这就是「第 2 篇不是段落匹配」那次反馈的根因。 */
  if (matchingByTitle || matchingByShape) {
    const lettersFromParagraphs = contentParagraphs
      .map((p) => p.label.trim())
      .filter(isParagraphLabel);
    const letters = lettersFromParagraphs.length
      ? Array.from(new Set(lettersFromParagraphs)).sort()
      : options.map((o) => o.key);

    return {
      kind: "matching",
      paragraphs: contentParagraphs,
      wordBank: [],
      letters,
      blanks: [],
      board: "长篇阅读匹配",
      instruction: `为 ${questions[0]?.number ?? 36}–${questions.at(-1)?.number ?? 45} 每题匹配一个段落字母（${
        letters[0] ?? "A"
      }–${letters.at(-1) ?? "H"}），同一段落可重复使用。`,
      hasInlineBlanks: false,
    };
  }

  if (bankedByTitle || bankedByShape || bankParagraph) {
    const blankNumbers = collectBlankNumbers(contentParagraphs);
    const questionByNumber = new Map(questions.map((q) => [q.number, q]));

    const blanks: BlankSlot[] = blankNumbers
      .map((number) => {
        const question = questionByNumber.get(number);
        return question ? { number, questionId: question.id } : null;
      })
      .filter((slot): slot is BlankSlot => Boolean(slot));

    // 正文没写空号（老数据）时，退回「每道题一个空位」，仍然能按清单作答
    const fallbackBlanks: BlankSlot[] = blanks.length
      ? blanks
      : questions.map((q) => ({ number: q.number, questionId: q.id }));

    const wordBank =
      options.length >= 8
        ? options
        : bankParagraph
          ? parseBankWords(bankParagraph.text)
          : options;

    return {
      kind: "banked",
      paragraphs: contentParagraphs,
      wordBank,
      letters: [],
      blanks: fallbackBlanks,
      board: "选词填空",
      instruction: `从词库 A–${wordBank.at(-1)?.key ?? "O"} 中为 ${fallbackBlanks[0]?.number ?? 26}–${
        fallbackBlanks.at(-1)?.number ?? 35
      } 各选一个词，每个词只用一次。`,
      hasInlineBlanks: blanks.length > 0,
    };
  }

  return {
    kind: "choice",
    paragraphs: passage.paragraphs,
    wordBank: [],
    letters: [],
    blanks: [],
    board: /匹配/.test(title) ? "长篇阅读匹配" : "仔细阅读",
    instruction: `阅读文章，完成 ${questions[0]?.number ?? 46}–${questions.at(-1)?.number ?? 50} 题。`,
    hasInlineBlanks: false,
  };
}

/** 词库字母 → 单词，便于在解析里把 "L" 显示成 "L) empty" */
export function makeAnswerLabeler(wordBank: QuestionOption[], letters: string[]) {
  const byKey = new Map(wordBank.map((o) => [o.key, o.text]));
  return (key: string) => {
    if (wordBank.length) {
      const word = byKey.get(key);
      return word ? `${key}) ${word}` : key;
    }
    if (letters.length) return `${key} 段`;
    return key;
  };
}
