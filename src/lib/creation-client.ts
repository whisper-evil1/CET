import { cloud, cloudReady } from "./cloud";
import { describeCloudError, rankModels, streamCloudText, type StreamFactory } from "./cloud-stream";
import { withSharecode, isPlatformBlock } from "./share-code";
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

/**
 * 创作平台的生成通道（浏览器侧）。
 *
 * 优先级：
 *   1. WorkBuddy 云模型（cloud.llm）—— 线上主力，首字快，不占 Node 连接；
 *   2. POST /api/create/generate —— 云不可用（本地开发、凭证域名不匹配）时兜底，
 *      服务端配了 AI_API_KEY 就是真模型，没有就是「离线骨架」；
 *   3. 服务端也失败 → 抛错，由 UI 提示重试，绝不静默返回半截内容。
 *
 * 三条路的返回都带 mode，UI 必须如实标注当前用的是哪条 —— 骨架不能当译文展示。
 */

export type GenMode = "cloud" | "server" | "offline";

export type GenResult<T> = {
  mode: GenMode;
  output: T;
  /** 兜底原因，UI 用小字提示，不弹窗 */
  note: string;
};

/** 模型列表取一次就够，页面内多次生成复用 */
let cachedModels: string[] | null = null;
let modelsFailed = false;

/** 模型列表只探一次：本地开发 / 域名不匹配时云接口会挂住，
 *  不给超时的话每次生成都要白等十几秒才落到服务端通道。 */
const MODEL_PROBE_MS = 4_000;

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function ensureModels(): Promise<string[]> {
  if (cachedModels !== null) return cachedModels;
  if (modelsFailed) return [];
  if (!cloudReady || !cloud) {
    modelsFailed = true;
    return [];
  }
  try {
    const list = await withTimeout(cloud.llm.models.list(), MODEL_PROBE_MS, "CLOUD_PROBE_TIMEOUT");
    cachedModels = rankModels(list);
    return cachedModels;
  } catch {
    modelsFailed = true;
    return [];
  }
}

/** 进工作台就先探一次云，别等到点「生成」才等这 6 秒 */
export function warmUpCloud(): void {
  void ensureModels();
}

const SYSTEM_ROLE = "system" as const;
const USER_ROLE = "user" as const;

type Messages = { role: "system" | "user"; content: string }[];

async function streamCloud(messages: Messages, signal: AbortSignal): Promise<string> {
  const models = await ensureModels();
  if (models.length === 0) throw new Error("CLOUD_UNAVAILABLE");

  const factory: StreamFactory = (model, msgs) =>
    cloud!.llm.chat.completions.create({
      model,
      messages: msgs as { role: "system" | "user" | "assistant"; content: string }[],
      stream: true,
      temperature: 0.65,
      signal,
    }) as AsyncIterable<{ choices: ReadonlyArray<{ delta?: { content?: string | null } }> }>;

  let acc = "";
  for await (const delta of streamCloudText(factory, { models, messages })) {
    acc += delta;
  }
  return acc;
}

type ServerPayload = {
  mode?: string;
  output?: unknown;
  note?: string;
};

async function callServer(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ServerPayload> {
  const response = await fetch(withSharecode("/api/create/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });

  if (isPlatformBlock(response, response.headers.get("content-type"))) {
    throw new Error("分享链接不完整，请从群里的分享链接重新进入本页");
  }
  const payload = (await response.json().catch(() => null)) as
    | { code?: number; message?: string; data?: ServerPayload }
    | null;
  if (!response.ok || !payload || payload.code !== 0 || !payload.data) {
    throw new Error(payload?.message ?? `生成失败（HTTP ${response.status}）`);
  }
  return payload.data;
}

function modeOf(value: string | undefined): GenMode {
  if (value === "server") return "server";
  if (value === "cloud") return "cloud";
  return "offline";
}

/* ---------------- 小说英译改编 ---------------- */

export async function generateNovel(
  text: string,
  options: NovelOptions,
  onProgress?: (chars: number) => void,
): Promise<GenResult<NovelOutput>> {
  const prompt = buildNovelPrompt(text, options);
  const messages: Messages = [
    { role: SYSTEM_ROLE, content: prompt.system },
    { role: USER_ROLE, content: prompt.user },
  ];

  let cloudNote = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const raw = await streamCloud(messages, controller.signal);
    onProgress?.(raw.length);
    const parsed = parseNovelOutput(raw, text);
    if (parsed) return { mode: "cloud", output: parsed, note: "" };
    cloudNote = "云模型返回格式异常，已改用服务端通道";
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("生成超时，请重试");
    cloudNote = describeCloudError(error, "服务端通道");
  } finally {
    clearTimeout(timer);
  }

  const data = await callServer(
    { kind: "novel", text, novel: options },
    new AbortController().signal,
  );
  const fallback = parseNovelOutput(JSON.stringify(data.output ?? null), text);
  if (fallback) {
    return { mode: modeOf(data.mode), output: fallback, note: data.note || cloudNote };
  }
  if (data.output && typeof data.output === "object") {
    return {
      mode: modeOf(data.mode),
      output: data.output as NovelOutput,
      note: data.note || cloudNote,
    };
  }
  throw new Error("生成结果无法解析，请重试");
}

/* ---------------- 短视频出海 ---------------- */

export async function generateVideo(
  text: string,
  options: VideoOptions,
  onProgress?: (chars: number) => void,
): Promise<GenResult<VideoOutput>> {
  const prompt = buildVideoPrompt(text, options);
  const messages: Messages = [
    { role: SYSTEM_ROLE, content: prompt.system },
    { role: USER_ROLE, content: prompt.user },
  ];

  let cloudNote = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const raw = await streamCloud(messages, controller.signal);
    onProgress?.(raw.length);
    const parsed = parseVideoOutput(raw, options);
    if (parsed) return { mode: "cloud", output: parsed, note: "" };
    cloudNote = "云模型返回格式异常，已改用服务端通道";
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new Error("生成超时，请重试");
    cloudNote = describeCloudError(error, "服务端通道");
  } finally {
    clearTimeout(timer);
  }

  const data = await callServer(
    { kind: "video", text, video: options },
    new AbortController().signal,
  );
  const fallback = parseVideoOutput(JSON.stringify(data.output ?? null), options);
  if (fallback) {
    return { mode: modeOf(data.mode), output: fallback, note: data.note || cloudNote };
  }
  if (data.output && typeof data.output === "object") {
    return {
      mode: modeOf(data.mode),
      output: data.output as VideoOutput,
      note: data.note || cloudNote,
    };
  }
  throw new Error("生成结果无法解析，请重试");
}

export const MODE_LABEL: Record<GenMode, string> = {
  cloud: "云模型",
  server: "服务端模型",
  offline: "离线骨架",
};
