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
};

export type PracticePassage = {
  id: string;
  order: number;
  title: string | null;
  paragraphs: Paragraph[];
  questions: PracticeQuestion[];
};

export type PracticePaper = {
  id: string;
  title: string;
  level: string;
  year: number | null;
  month: number | null;
  passages: PracticePassage[];
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
  type: string | null;
};

export type PaperSummary = {
  id: string;
  title: string;
  level: string;
  year: number | null;
  month: number | null;
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
