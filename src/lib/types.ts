import { z } from "zod";

/* ---------------- 基础领域类型 ---------------- */

export const paragraphSchema = z.object({
  label: z.string(), // A / B / C ...
  text: z.string(),
});
export type Paragraph = z.infer<typeof paragraphSchema>;

export const optionSchema = z.object({
  key: z.string(), // A / B / C / D
  text: z.string(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

export const definitionSchema = z.object({
  pos: z.string(), // n. / v. / adj.
  zh: z.string(),
});
export type Definition = z.infer<typeof definitionSchema>;

export const exampleSchema = z.object({
  en: z.string(),
  zh: z.string().optional(),
});
export type Example = z.infer<typeof exampleSchema>;

/** 选项逐项分析：{ A: "错在哪", B: "..." } */
export type OptionAnalysis = Record<string, string>;

/** 听力原文逐句结构 */
export type TranscriptLine = {
  id: number;
  start: number;
  end: number;
  text: string;
};

/** Section 类型 */
export type SectionType = "writing" | "listening" | "reading" | "translation";

/** 试卷内的 Section */
export type PracticeSection = {
  id: string;
  order: number;
  type: SectionType;
  title: string;
  timeLimit: number | null;
  passages: PracticePassage[];
};

/* ---------------- 词卡 / 词典 ---------------- */

export type WordEntry = {
  word: string;
  phonetic: string | null;
  definitions: Definition[];
  examples: Example[];
  /** builtin | ai | api | cache | offline —— 用于前端提示释义来源 */
  source: "builtin" | "ai" | "api" | "cache" | "offline";
  /** 查不到释义时为 true，前端允许加入生词本但标注"释义待补" */
  needsDefinition?: boolean;
};

/* ---------------- 接口返回体 ---------------- */

/** 刷题页题目（不含答案与解析，避免在首屏 payload 里泄露答案） */
export type PracticeQuestion = {
  id: string;
  number: number;
  stem: string;
  options: QuestionOption[];
  type: string | null;
  /** 参考要点/解析（写作翻译展示参考范文，阅读听力展示解析） */
  analysis: string;
};

/** 听力题目（含证据句 id，提交后才返回） */
export type ListeningQuestion = PracticeQuestion & {
  evidenceSentences: number[];
};

export type PracticePassage = {
  id: string;
  order: number;
  title: string | null;
  paragraphs: Paragraph[];
  /** 听力专用 */
  audioUrl: string | null;
  audioDuration: number | null;
  transcript: TranscriptLine[];
  questions: PracticeQuestion[];
};

export type PracticePaper = {
  id: string;
  title: string;
  level: string;
  year: number | null;
  month: number | null;
  sections: PracticeSection[];
};

/** 提交答案后返回的判题结果 + 解析 */
export type AnswerResult = {
  questionId: string;
  choice: string;
  isCorrect: boolean;
  answer: string;
  analysis: string;
  optionAnalysis: OptionAnalysis | null;
  evidencePara: string | null;
  evidenceText: string | null;
  /** 听力用：答案出自原文第几句 */
  evidenceSentences: number[];
  type: string | null;
};

export type PaperSummary = {
  id: string;
  title: string;
  level: string;
  year: number | null;
  month: number | null;
  /** 同场考试的第几套（1/2/3） */
  setNo: number | null;
  /** official = 官方原题；simulated = 按官方结构编写的仿真材料 */
  origin: string;
  /** ready = 正文齐备可练；draft = 结构已建、正文待补 */
  status: string;
  passageCount: number;
  questionCount: number;
  /** 已作答题数，用于首页进度 */
  answeredCount: number;
  correctCount: number;
};

export type CommentItem = {
  id: string;
  content: string;
  visibility: "private" | "public";
  likes: number;
  createdAt: string;
  canEdit: boolean;
  isMine: boolean;
  author: { id: string; name: string | null; avatar: string | null };
  replies: CommentItem[];
};

export type VocabItem = {
  id: string;
  word: string;
  phonetic: string | null;
  definitions: Definition[];
  example: string | null;
  exampleZh: string | null;
  sourceContext: string | null;
  reviewCount: number;
  status: "learning" | "mastered";
  createdAt: string;
  /* ---- v2.1 记忆曲线 ---- */
  /** 下次该复习的时间（ISO）；null = 立即到期 */
  dueAt: string | null;
  /** 到期状态文案，如「逾期 3 天」「5 天后」「新词」 */
  dueLabel: string;
  overdue: boolean;
  intervalDays: number;
  ease: number;
  lapses: number;
  /** 0-100 优先级，列表排序与展示用 */
  priority: number;
  /** 一行说明为什么排在这个优先级 */
  reason: string;
  /** COCA/BNC 综合词频排名 */
  examRank: number | null;
  /** "cet4,cet6" */
  examTags: string | null;
  source: "lookup" | "wordbook" | "import";
  wordbookId: string | null;
};

/** 今日队列响应 */
export type VocabQueue = {
  items: VocabItem[];
  /** 学习中的总数 */
  learningCount: number;
  /** 已到复习期的数量 */
  dueCount: number;
  /** 从未学过的新词数量 */
  newCount: number;
  /** 已掌握数量 */
  masteredCount: number;
};

/** 词书元信息 */
export type WordbookMeta = {
  id: string;
  name: string;
  level: string;
  rule: string;
  count: number;
  /** 已经导入到当前用户生词本的条数 */
  imported: number;
};

/** 词书内的一条词 */
export type WordbookEntry = {
  word: string;
  rank: number;
  collins: number;
  oxford: boolean;
  phonetic: string | null;
  definitions: Definition[];
  imported: boolean;
};

export type ImportResult = {
  total: number;
  added: number;
  updated: number;
  skipped: number;
  /** 解析不出释义的词（仍会入库，待 /api/vocab/refresh 补） */
  unresolved: string[];
  /** 被跳过的原文行，最多 10 条，便于用户自查格式 */
  rejected: string[];
};

export type LearningStats = {
  vocabTotal: number;
  vocabLearning: number;
  vocabMastered: number;
  favoriteCount: number;
  answeredCount: number;
  correctCount: number;
  accuracy: number;
};

/** AI 经验包 */
export type ExperiencePack = {
  pitfall: string;
  correctApproach: string;
  commonMistakes: string[];
  keyVocab: string[];
  basedOnCommentCount: number;
  generatedAt: string;
};

/** 排行榜条目 */
export type LeaderboardEntry = {
  userId: string;
  userName: string | null;
  avatar: string | null;
  totalScore: number;
  checkinDays: number;
  accuracy: number;
  newVocab: number;
  questionCount: number;
  rank: number;
};

/** 打卡数据（/api/checkin） */
export type CheckinData = {
  today: Record<"CET4" | "CET6", number>;
  checkedIn: Record<"CET4" | "CET6", boolean>;
  monthByLevel: Record<"CET4" | "CET6", number>;
  monthDays: number;
  streak: number;
  calendar: { date: string; levels: ("CET4" | "CET6")[] }[];
};

/** 错题聚合概览（/api/mistakes） */
export type MistakeSummary = {
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number;
  /** 错题按题型分布（降序） */
  byType: { type: string; count: number }[];
  /** 错题按篇章/试卷分布（降序） */
  byPaper: { paperId: string; title: string; wrongCount: number }[];
  /** 错题中误选的选项字母分布（降序），用于提示最易踩的干扰项 */
  byWrongChoice: { choice: string; count: number }[];
};

/** 单条错题（/api/mistakes） */
export type MistakeItem = {
  id: string;
  questionId: string;
  /** 用户选错的选项字母 */
  choice: string;
  createdAt: string;
  question: {
    number: number;
    stem: string;
    options: QuestionOption[];
    answer: string;
    analysis: string;
    optionAnalysis: OptionAnalysis | null;
    type: string | null;
    passageTitle: string | null;
    paperTitle: string;
    evidenceText: string | null;
  };
};
