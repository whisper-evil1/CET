/**
 * 拍照搜题的内置视觉通道（无 Dify 时的零配置降级）。
 *
 * 复用 WF3 DSL 的两步设计：
 *   1. 云模型视觉识别题干（只识别不解答，输出固定 JSON，显式忽略 PII）
 *   2. 题干脱敏后交给云模型解答（结论 + 分步 + 易错点三节 Markdown）
 * 再用 agent-adapter 相同的思路解析成项目 UI 结构。
 *
 * 诚实边界：
 * - 图片以 data URL 直传云模型，不落库、不留存；服务端只经手内存 Buffer。
 * - 低置信度 / 非题目图 → needRecapture=true，答案与步骤一律置空，不猜。
 * - 与原 Dify 通道共用 PhotoSolveData 结构，前端无需区分后端。
 */

import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { CLOUD_ENABLED, CLOUD_PUBLIC_CONFIG } from "./cloud-config";
import { withChunkTimeout } from "./cloud-stream";
import { extractJson } from "./creation";
import { redactText } from "./agent-redact";
import type { PhotoSolveData } from "./agent-adapter";

const CALL_TIMEOUT_MS = 45_000;
const MIME_DATA_URL: Record<string, string> = {
  "image/jpeg": "data:image/jpeg;base64,",
  "image/png": "data:image/png;base64,",
  "image/webp": "data:image/webp;base64,",
};

type VisionModel = ReturnType<typeof createWorkBuddyCloud>["llm"];

function cloudClient() {
  if (!CLOUD_ENABLED || !CLOUD_PUBLIC_CONFIG.endpoint || !CLOUD_PUBLIC_CONFIG.publishableKey) {
    throw new Error("云服务未启用，无法使用内置视觉搜题");
  }
  return createWorkBuddyCloud({
    endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
    publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
  });
}

/** 拼一次流式返回；失败换下一个模型，最多 3 个（优先 flash、支持图片的） */
async function streamText(
  llm: VisionModel,
  messages: Parameters<VisionModel["chat"]["completions"]["create"]>[0]["messages"],
  modelIds: string[],
  temperature: number,
): Promise<string> {
  let lastError: unknown;
  for (const model of modelIds.slice(0, 3)) {
    let acc = "";
    try {
      const stream = (await llm.chat.completions.create({
        model,
        messages: messages as never,
        stream: true,
        temperature,
      } as never)) as AsyncIterable<{ choices: ReadonlyArray<{ delta?: { content?: string | null } }> }>;
      for await (const delta of withChunkTimeout(stream, CALL_TIMEOUT_MS, 15_000)) {
        acc += delta?.choices?.[0]?.delta?.content ?? "";
      }
      if (acc.trim()) return acc;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型未返回正文");
}

/** 挑支持图片的可用模型，flash 优先 */
async function visionModels(llm: VisionModel): Promise<string[]> {
  try {
    const list = await Promise.race([
      llm.models.list(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("模型列表超时")), 8000)),
    ]);
    const usable = (list as Array<{ id?: string; enabled?: boolean; supportsImages?: boolean; disabledMultimodal?: boolean }>)
      .filter((m) => m.id && m.enabled !== false && m.supportsImages === true && m.disabledMultimodal !== true)
      .map((m) => m.id as string)
      .filter((id) => !/^(auto|default|fast-model|balanced-model)$/i.test(id));
    const score = (id: string) =>
      /flash/i.test(id) ? 0 : /deepseek/i.test(id) ? 1 : /glm/i.test(id) ? 2 : 3;
    return usable.sort((a, b) => score(a) - score(b));
  } catch {
    return ["glm-5.3-flash", "deepseek-v4-flash"];
  }
}

const RECOGNIZE_SYSTEM = `你是题目识别助手。只读图识别题干，不解题。只输出合法 JSON，不要解释、前后缀或代码块标记。
字段固定：{"stem":"题干文字","options":["选项A","选项B"],"type":"选择题|填空题|判断题|阅读理解|解答题|其他","confidence":"high|low","need_recapture":false,"pii_notice":""}
规则：
1. 图片里的姓名、学校、准考证号、水印账号、二维码内容一律不要写进 stem 或 options，只在 pii_notice 用类别名提示
2. 看不清、不是题目、题干被裁切 → confidence=low 且 need_recapture=true，stem 写"未能识别完整题干"
3. 公式、表格、选项要区分清楚，选项按原文顺序列出
4. type 只能取给定枚举值
5. 只识别，不解答`;

const SOLVE_SYSTEM = `你是一位耐心的学科答疑老师。基于已识别并脱敏的题干给出解答。
输出 Markdown，严格三节：
## 答案
## 分步推导
## 易错点
要求：
1. 答案先行，一句话给结论
2. 分步推导写清每一步依据，不跳步
3. 依赖题干缺失信息才能判断时，写"当前题干信息不足，需核实"，禁止猜测
4. 题干已脱敏，占位符（形如 [PHONE_1]）不得补全或改写
5. 不输出与题目无关的内容
6. 若为选择题，答案节写明选项字母并附一句理由`;

function section(md: string, title: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      if (inside) break;
      if (h[1].indexOf(title) >= 0) { inside = true; continue; }
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

function asLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

/**
 * 内置拍照搜题：图片 Buffer + MIME → 识别 → 解答 → PhotoSolveData。
 * 前端传来的补充文字在进入模型前先脱敏。
 */
export async function solvePhotoBuiltin(
  imageBuffer: Buffer,
  mime: string,
  hintText: string,
): Promise<PhotoSolveData> {
  const prefix = MIME_DATA_URL[mime];
  if (!prefix) throw new Error("不支持的图片格式");
  const dataUrl = `${prefix}${imageBuffer.toString("base64")}`;
  const cloud = cloudClient();
  const models = await visionModels(cloud.llm);

  // 1. 视觉识别题干
  const recognizedRaw = await streamText(
    cloud.llm,
    [
      { role: "system", content: RECOGNIZE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          { type: "text", text: `用户补充文字（可能为空）：${hintText || "无"}` },
        ],
      },
    ] as never,
    models,
    0.1,
  );
  const parsed = extractJson(recognizedRaw) as Record<string, unknown> | null;
  if (!parsed) {
    return blockedResult("", "", "未能从图片中识别到题目，请补拍一张清晰的题目照片");
  }

  const stem = String(parsed.stem ?? "");
  const options = Array.isArray(parsed.options) ? parsed.options.map((o) => String(o)) : [];
  const qType = String(parsed.type ?? "其他");
  const confidence = parsed.confidence === "high" ? "high" : "low";
  const needRecapture = Boolean(parsed.need_recapture) || confidence === "low";
  const piiNotice = String(parsed.pii_notice ?? "");

  // 题目文本层二次脱敏（画面里的 PII 已由提示词要求忽略）
  const redacted = redactText(stem);
  const cleanStem = redacted.cleanText;

  const questionText = [cleanStem, ...options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)]
    .filter(Boolean)
    .join("\n");

  if (needRecapture || !cleanStem || cleanStem.indexOf("未能识别") >= 0) {
    return {
      ...blockedResult(questionText, qType, "题干不完整或置信度偏低，请正对题目补拍一张清晰的照片"),
      needRecapture: true,
      redactCount: redacted.redactCount,
    };
  }

  // 2. 生成解答
  const solutionMd = await streamText(
    cloud.llm,
    [
      { role: "system", content: SOLVE_SYSTEM },
      { role: "user", content: `题目（已脱敏）：\n${questionText}` },
    ] as never,
    models,
    0.2,
  );

  const answer = section(solutionMd, "答案");
  const steps = asLines(section(solutionMd, "分步推导"));
  const pitfalls = asLines(section(solutionMd, "易错点"));

  if (!answer && steps.length === 0) {
    return {
      ...blockedResult(questionText, qType, "当前题干信息不足，无法给出可靠解答，请补充题目细节"),
      redactCount: redacted.redactCount,
    };
  }

  const note = piiNotice ? `已忽略图片中的个人信息类别：${piiNotice}` : "";
  return {
    question: questionText,
    questionType: qType,
    answer,
    steps,
    pitfalls,
    confidence: "high",
    needRecapture: false,
    blocked: false,
    note,
    redactCount: redacted.redactCount,
  };
}

function blockedResult(question: string, qType: string, note: string): PhotoSolveData {
  return {
    question,
    questionType: qType,
    answer: "",
    steps: [],
    pitfalls: [],
    confidence: "low",
    needRecapture: true,
    blocked: true,
    note,
    redactCount: 0,
  };
}
