/**
 * Agent 网关的浏览器侧客户端。
 *
 * 复用项目现有 apiFetch（自动解 {code,message,data} + sharecode + 平台拦截识别），
 * 不另造请求层。创作页通过它调用 /api/agent/*，拿到 Agent 的规划/脱敏计数/产物。
 */

import { apiFetch, postJson } from "./api-client";
import type { NovelOptions, NovelOutput, VideoOptions, VideoOutput } from "./creation";

export type AgentMode = "dify" | "builtin";
export type PlanStep = { seq: number; action: string; tool: string };

export type AgentCreationResult = {
  job_id: string;
  mode: AgentMode;
  route: "novel" | "video";
  status: "done" | "blocked";
  output: NovelOutput | VideoOutput;
  plan: PlanStep[];
  redact_count: number;
  note: string;
  elapsed_ms: number;
};

export type PhotoSolveResult = {
  job_id: string;
  mode: "dify" | "builtin";
  question: string;
  questionType: string;
  answer: string;
  steps: string[];
  pitfalls: string[];
  confidence: "high" | "low";
  needRecapture: boolean;
  blocked: boolean;
  note: string;
  redactCount: number;
  elapsed_ms: number;
};

/** 是否启用 Agent 通道：构建期开关，默认关闭，保持原三级降级链路不变 */
export const AGENT_ENABLED = process.env.NEXT_PUBLIC_AGENT_MODE === "1";

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function submitAgentCreation(body: {
  kind: "novel" | "video";
  text: string;
  novel?: NovelOptions;
  video?: VideoOptions;
  source?: "import" | "write";
  target_platform?: string;
}): Promise<AgentCreationResult> {
  return postJson<AgentCreationResult>("/api/agent/creation", {
    ...body,
    client_request_id: requestId(),
  });
}

/** 拍照搜题：multipart，不要手动设 Content-Type（apiFetch 已修 FormData 兼容） */
export function solveByPhoto(image: File, hintText?: string): Promise<PhotoSolveResult> {
  const form = new FormData();
  form.append("image", image, image.name || "question.jpg");
  if (hintText) form.append("hint_text", hintText);
  form.append("client_request_id", requestId());
  return apiFetch<PhotoSolveResult>("/api/agent/solver/photo", {
    method: "POST",
    body: form,
  });
}
