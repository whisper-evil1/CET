import { z } from "zod";

// 允许注册的邮箱域名白名单。挡住乱填的临时邮箱/不存在的域名。
// 想收紧成只允许 QQ 邮箱，把白名单改成 ["qq.com", "foxmail.com", "vip.qq.com"] 即可。
const ALLOWED_EMAIL_DOMAINS = new Set([
  "qq.com",
  "vip.qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "vip.163.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "139.com",
  "189.cn",
  "aliyun.com",
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
]);

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("请输入正确的邮箱")
    .refine((e) => {
      const domain = e.split("@")[1] ?? "";
      return ALLOWED_EMAIL_DOMAINS.has(domain);
    }, "只支持主流邮箱（QQ、163、Gmail 等），请勿使用临时邮箱"),
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
  // 语境句只是给模型看的提示，超长不该让整次查词失败，由调用方截断
  context: z.string().max(4000).optional(),
});

/**
 * 生词入库。
 *
 * 这里的长度上限是「防滥用」的宽松阈值，不是存储上限：
 * 真实长难句动辄 200+ 字符，词典释义也可能上百字，如果按存储长度硬卡，
 * 用户点"加入生词本"会整条被 400 拒绝 —— 表现就是"点了没反应/加不进去"。
 * 因此校验放宽，真正的裁剪统一在路由层做（route.ts 的 clampTo），
 * 保证「先收下，再截断」，永远不会因为长度把一条合法请求打回。
 */
export const vocabCreateSchema = z.object({
  word: z.string().trim().min(1).max(64),
  phonetic: z.string().max(500).nullable().optional(),
  definitions: z
    .array(z.object({ pos: z.string().max(200), zh: z.string().max(2000) }))
    .max(12)
    // 允许空数组：词典查不到释义时也可加入生词本，释义后续可补
    .default([]),
  example: z.string().max(4000).nullable().optional(),
  exampleZh: z.string().max(4000).nullable().optional(),
  sourceContext: z.string().max(4000).nullable().optional(),
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
