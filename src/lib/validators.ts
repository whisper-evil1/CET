import { z } from "zod";
import { checkEmail } from "./email-rules";

/**
 * 邮箱字段。
 *
 * 规则与文案都在 src/lib/email-rules.ts 的 checkEmail 里，前端失焦提示、
 * 「发送验证码」前的预检、这里的入库校验三处共用同一套 —— 以前是
 * input[type=email] 挡一遍 + zod 这里再写一遍，两处文案不一样，
 * 用户会看到「浏览器说格式对、提交后说只支持主流邮箱」这种前后矛盾的提示。
 *
 * 校验通过后顺手规范化（转小写），后续落库、发信都用这个值。
 */
const emailField = z
  .string()
  .trim()
  .min(1, "先填一下邮箱")
  .max(120, "邮箱太长了，检查一下是不是粘贴多了")
  .superRefine((value, ctx) => {
    const checked = checkEmail(value);
    if (!checked.ok) ctx.addIssue({ code: "custom", message: checked.message });
  })
  .transform((value) => {
    const checked = checkEmail(value);
    return checked.ok ? checked.email : value.trim().toLowerCase();
  });

/** 6 位数字验证码。前端只有一个 input，值从粘贴里带出空格也能收 */
const codeField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((value) => value.length === 6, "验证码是 6 位数字，检查一下是否复制完整");

export const registerSchema = z.object({
  email: emailField,
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最长 64 位"),
  name: z.string().trim().min(1, "昵称不能为空").max(20, "昵称最长 20 个字").optional(),
  /**
   * 邮箱验证码。
   *
   * 为什么是可选的：接口开放给脚本和第三方调用，历史调用方只传
   * { email, password }，一刀切成必填会把这些全部打断。
   * 真正的强制开关在注册路由里：配了 RESEND_API_KEY 或显式设
   * EMAIL_CODE_REQUIRED=1 时才拒绝「没带码」的请求；一旦带了码就必须验对。
   */
  code: codeField.optional(),
});

/** 验证码登录：不传密码，只传邮箱 + 码 */
export const codeLoginSchema = z.object({
  email: emailField,
  code: codeField,
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

export const reviewSchema = z
  .object({
    result: z.enum(["known", "unknown"]).optional(),
    /** 显式调度等级，缺省时由 result 推导：known→good / unknown→again */
    grade: z.enum(["again", "hard", "good", "easy"]).optional(),
  })
  // 闯关页只传 grade（它自己知道四选一判对判错），老调用方只传 result。
  // 两者至少要有一个，否则调度无从判断，直接 400 说清楚。
  .refine((value) => Boolean(value.result || value.grade), {
    message: "需要 result 或 grade 之一",
  });

/**
 * 外部词表导入。
 * 三种入口共用一套校验：粘贴文本 / 直接给词数组 / 导入内置词书。
 * 文本上限 120000 字符（约 4000 行），真正入库上限由 MAX_WORDS=800 控制。
 */
export const vocabImportSchema = z.object({
  text: z.string().max(120000, "文本太长了，请分几次导入").optional(),
  words: z
    .array(
      z.object({
        word: z.string().trim().min(1).max(48),
        definitions: z
          .array(z.object({ pos: z.string().max(200), zh: z.string().max(2000) }))
          .max(12)
          .optional(),
      }),
    )
    .max(800, "一次最多导入 800 个词")
    .optional(),
  /** 从内置词书导入：cet4-core | cet6-core | cet-essential */
  wordbookId: z.string().max(64).optional(),
  /** 词书导入条数，1-3000 */
  count: z.number().int().min(1).max(3000).optional(),
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

/** 写作 / 翻译批改：只接受题目 id 与作答文本，提示词由服务端重建，不吃前端传入的 prompt */
export const aiGradeSchema = z.object({
  questionId: z.string().min(1),
  answer: z
    .string()
    .trim()
    .min(10, "作答太短了，至少写 10 个字符再提交批改")
    .max(8000, "作答过长，请精简后再提交"),
});

/* ---------------- v2.3 创作平台 ---------------- */

export const novelOptionsSchema = z.object({
  style: z.enum(["literary", "plain", "teen"]).default("literary"),
  audience: z.enum(["general", "teen", "academic"]).default("general"),
  keepNames: z.boolean().default(true),
  paragraphs: z.number().int().min(1).max(12).default(6),
});

export const videoOptionsSchema = z.object({
  platform: z.enum(["youtube", "tiktok"]).default("youtube"),
  seconds: z.union([z.literal(30), z.literal(60)]).default(30),
  tone: z.enum(["warm", "punchy", "documentary"]).default("warm"),
});

/** 生成请求：kind 决定走哪套提示词与解析器 */
export const createGenSchema = z.object({
  kind: z.enum(["novel", "video"]),
  text: z.string().trim().min(20, "至少写一段再生成").max(6000, "一次最多 6000 字，请分段生成"),
  novel: novelOptionsSchema.optional(),
  video: videoOptionsSchema.optional(),
});

/** 保存作品：output / meta 由前端序列化，服务端只做长度护栏 */
export const creationSchema = z.object({
  kind: z.enum(["novel", "video"]),
  title: z.string().trim().min(1).max(160),
  sourceText: z.string().max(20000).default(""),
  output: z.string().min(2).max(200000),
  meta: z.string().max(4000).optional(),
});
