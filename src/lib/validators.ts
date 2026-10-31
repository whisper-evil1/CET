import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("请输入正确的邮箱"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最长 64 位"),
  name: z.string().trim().min(1, "昵称不能为空").max(20, "昵称最长 20 个字").optional(),
});

export const answerSchema = z.object({
  questionId: z.string().min(1),
  choice: z.enum(["A", "B", "C", "D"]),
});

export const analysisViewSchema = z.object({
  questionId: z.string().min(1),
});

export const commentCreateSchema = z.object({
  content: z.string().min(1, "留言不能为空").max(500, "最多 500 字"),
  visibility: z.enum(["private", "public"]).default("private"),
  parentId: z.string().min(1).nullable().optional(),
});

export const commentUpdateSchema = z.object({
  visibility: z.enum(["public"]).optional(), // 只允许 private → public
});

export const lookupSchema = z.object({
  word: z.string().trim().min(1).max(64),
  passageId: z.string().optional(),
  context: z.string().max(1000).optional(),
});

export const vocabCreateSchema = z.object({
  word: z.string().trim().min(1).max(64),
  phonetic: z.string().max(120).nullable().optional(),
  definitions: z
    .array(z.object({ pos: z.string().max(20), zh: z.string().max(200) }))
    .max(12)
    // 允许空数组：词典查不到释义时也可加入生词本，释义后续可补
    .default([]),
  example: z.string().max(500).nullable().optional(),
  exampleZh: z.string().max(500).nullable().optional(),
  sourceContext: z.string().max(500).nullable().optional(),
  sourcePassageId: z.string().max(64).nullable().optional(),
});

export const reviewSchema = z.object({
  result: z.enum(["known", "unknown"]),
});

export const aiChatSchema = z.object({
  questionId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(24, "对话轮次过多，请重新开始"),
});
