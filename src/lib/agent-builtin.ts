/**
 * Agent 网关的 builtin 后端。
 *
 * 当 Dify 未配置 / 调用失败时，用项目现有的 AI 链路（aiConfig → OpenAI 兼容
 * chat/completions）跑同一套「脱敏 + 适配 + 出关复扫」，让创作中心在没有 Dify
 * 实例的情况下也能验证 Agent 通道。它的产物结构与 Dify 通道一致，前端无需区分。
 *
 * 诚实边界：
 * - builtin 的「规划」是按 kind 生成的确定性步骤表，不是 LLM 自主规划；
 *   mode 会如实标为 builtin，UI 不得冒充 Dify Agent。
 * - builtin 只有文本模型，没有视觉能力，拍照搜题必须走 Dify WF3；
 *   这里不读图、不猜答案。
 */

import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { aiConfig, type ChatMessage } from "./ai";
import { CLOUD_ENABLED, CLOUD_PUBLIC_CONFIG } from "./cloud-config";
import { rankModels, withChunkTimeout } from "./cloud-stream";
import {
  buildNovelPrompt,
  buildVideoPrompt,
  parseNovelOutput,
  parseVideoOutput,
  type NovelOptions,
  type NovelOutput,
  type VideoOptions,
  type VideoOutput,
} from "./creation";

export type PlanStep = { seq: number; action: string; tool: string };

export type BuiltinResult<T> = {
  output: T;
  plan: PlanStep[];
  note: string;
};

const CALL_TIMEOUT_MS = 45_000;

/** 确定性规划：如实反映这一步做了什么，不假装是 LLM 思考出来的 */
export function buildPlan(kind: "novel" | "video"): PlanStep[] {
  const common: PlanStep[] = [
    { seq: 1, action: "入关脱敏：PII 替换为占位符", tool: "redact" },
    { seq: 2, action: "按文体/平台规则生成英文发布稿", tool: kind === "novel" ? "novel_adapt" : "video_package" },
    { seq: 3, action: "出关复扫：检查生成稿是否带回原值", tool: "outbound_rescan" },
  ];
  return kind === "video"
    ? [
        ...common.slice(0, 2),
        { seq: 3, action: "平台硬规则预检（标题/标签/字幕）", tool: "compliance" },
        common[2],
      ].map((s, i) => ({ ...s, seq: i + 1 }))
    : common;
}

/**
 * 模型调用优先级（服务端）：
 *   1. WorkBuddy 云模型 SDK —— 实测服务端可用（按 publishableKey 鉴权，流式），
 *      本项目主力通道，无需 AI_API_KEY；
 *   2. AI_API_KEY 的 OpenAI 兼容接口 —— 用户自备 key 时的兜底；
 * 两者都不可用才抛错，由网关返回明确提示。
 */
async function chat(messages: ChatMessage[]): Promise<string> {
  if (CLOUD_ENABLED && CLOUD_PUBLIC_CONFIG.endpoint && CLOUD_PUBLIC_CONFIG.publishableKey) {
    try {
      return await chatViaCloud(messages);
    } catch (error) {
      console.warn("[agent-builtin] cloud chat failed, try AI_API_KEY:", error instanceof Error ? error.message : error);
    }
  }
  return chatViaKey(messages);
}

async function chatViaCloud(messages: ChatMessage[]): Promise<string> {
  const cloud = createWorkBuddyCloud({
    endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
    publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
  });
  const list = await withTimeout(cloud.llm.models.list(), 8000, "云模型列表超时");
  const models = rankModels(list);
  const useModels = models.length > 0 ? models : ["auto"];
  const factory = (model: string, msgs: ChatMessage[]) =>
    cloud.llm.chat.completions.create({
      model,
      messages: msgs as { role: "system" | "user" | "assistant"; content: string }[],
      stream: true,
      temperature: 0.65,
    }) as AsyncIterable<{ choices: ReadonlyArray<{ delta?: { content?: string | null } }> }>;

  let lastError: unknown;
  for (const model of useModels.slice(0, 3)) {
    let acc = "";
    try {
      for await (const delta of withChunkTimeout(
        factory(model, messages),
        CALL_TIMEOUT_MS,
        15_000,
      )) {
        acc += delta?.choices?.[0]?.delta?.content ?? "";
      }
      if (acc.trim()) return acc;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("云模型未返回正文");
}

async function chatViaKey(messages: ChatMessage[]): Promise<string> {
  const config = aiConfig();
  if (!config.enabled) throw new Error("没有可用的模型（云服务不可用，且未配置 AI_API_KEY）");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: 0.65,
        max_tokens: 2600,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`模型返回 HTTP ${response.status}：${detail.slice(0, 120)}`);
    }
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("模型未返回正文");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    task.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function builtinNovel(
  cleanText: string,
  options: NovelOptions,
): Promise<BuiltinResult<NovelOutput>> {
  const prompt = buildNovelPrompt(cleanText, options);
  const raw = await chat([
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ]);
  const parsed = parseNovelOutput(raw, cleanText);
  if (!parsed) throw new Error("模型返回格式无法解析，请重试");
  return { output: parsed, plan: buildPlan("novel"), note: "" };
}

export async function builtinVideo(
  cleanText: string,
  options: VideoOptions,
): Promise<BuiltinResult<VideoOutput>> {
  const prompt = buildVideoPrompt(cleanText, options);
  const raw = await chat([
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user },
  ]);
  const parsed = parseVideoOutput(raw, options);
  if (!parsed) throw new Error("模型返回格式无法解析，请重试");
  return { output: parsed, plan: buildPlan("video"), note: "" };
}
