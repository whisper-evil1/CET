/**
 * Dify 自部署工作流客户端（仅服务端引用）。
 *
 * 这是「前端 → 项目网关 /api/agent/* → 本文件 → Dify」链路的最后一段。
 * 密钥只从 process.env 读，绝不进前端包、不进日志、不进响应。
 *
 * ⚠️ 契约以实际 Dify 实例为准：本文件按 Dify 公开 Service API 的通用形态实现
 *   POST {DIFY_BASE_URL}/workflows/run   （response_mode: blocking）
 *   POST {DIFY_BASE_URL}/files/upload    （multipart，供 WF3 图片入参）
 * 若你的实例版本路径/字段名不同，只需改这一个文件，网关与前端无需动。
 *
 * 环境变量（见 .env.example）：
 *   DIFY_BASE_URL   例：https://dify.example.com/v1  （注意含 /v1，末尾不带斜杠）
 *   DIFY_API_KEY    应用 API Key（Bearer）；四个工作流可共用一个「主控/编排」应用 Key，
 *                  也可分别配 DIFY_WF1_KEY / DIFY_WF2_KEY / DIFY_WF3_KEY。
 *   DIFY_TIMEOUT_MS 单工作流超时，默认 60000。
 */

export type DifyWorkflow = "novel" | "video" | "photo" | "main";

export type DifyRunResult = {
  /** Dify end 节点 outputs 原样透出，由网关适配成项目结构 */
  outputs: Record<string, unknown>;
  taskId: string;
  elapsedMs: number;
};

export class DifyError extends Error {
  constructor(
    message: string,
    public readonly kind: "unconfigured" | "timeout" | "upstream" | "blocked" | "invalid",
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DifyError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;

function baseUrl(): string {
  return (process.env.DIFY_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

function keyFor(workflow: DifyWorkflow): string {
  const specific =
    workflow === "novel"
      ? process.env.DIFY_WF1_KEY
      : workflow === "video"
        ? process.env.DIFY_WF2_KEY
        : workflow === "photo"
          ? process.env.DIFY_WF3_KEY
          : process.env.DIFY_MAIN_KEY;
  return (specific || process.env.DIFY_API_KEY || "").trim();
}

/** 网关据此决定走 Dify 还是 builtin 降级；缺配置即视为未启用，不影响原链路。 */
export function difyEnabled(workflow: DifyWorkflow): boolean {
  return Boolean(baseUrl() && keyFor(workflow));
}

function timeoutMs(): number {
  const raw = Number(process.env.DIFY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * 调用一个已发布为 Service API 的 Dify workflow（blocking 模式）。
 * user 传项目内 userId，便于在 Dify 侧按用户隔离会话/日志，不传邮箱等 PII。
 */
export async function runWorkflow(
  workflow: DifyWorkflow,
  inputs: Record<string, unknown>,
  user: string,
): Promise<DifyRunResult> {
  if (!difyEnabled(workflow)) {
    throw new DifyError("Dify 未配置", "unconfigured");
  }
  const url = `${baseUrl()}/workflows/run`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${keyFor(workflow)}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        inputs,
        response_mode: "blocking",
        user,
      }),
    });

    if (!response.ok) {
      // 只回状态码，不回上游 body（可能含内部信息）
      throw new DifyError(`Dify 返回 HTTP ${response.status}`, "upstream", response.status);
    }

    const json = (await response.json()) as {
      task_id?: string;
      data?: {
        status?: string;
        outputs?: Record<string, unknown>;
        error?: string | null;
      };
    };
    const status = json.data?.status;
    if (status && status !== "succeeded") {
      throw new DifyError(json.data?.error || `Dify 工作流状态 ${status}`, "blocked");
    }
    const outputs = json.data?.outputs;
    if (!outputs || typeof outputs !== "object") {
      throw new DifyError("Dify 未返回 outputs", "invalid");
    }

    return {
      outputs,
      taskId: json.task_id ?? "",
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof DifyError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DifyError("Dify 工作流超时", "timeout");
    }
    throw new DifyError(
      `Dify 调用失败：${error instanceof Error ? error.message : "未知错误"}`,
      "upstream",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WF3 拍照搜题：先把图片上传到 Dify，拿到 upload_file_id 再作为 file 变量传入。
 * 入参是 Web 标准 File（Next 路由从 formData 拿到），直接用 FormData 转发，
 * 让 Dify 侧解析 boundary；不手动设 Content-Type。
 */
export async function uploadImage(file: File, user: string): Promise<string> {
  if (!difyEnabled("photo")) {
    throw new DifyError("Dify 未配置", "unconfigured");
  }
  const url = `${baseUrl()}/files/upload`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const form = new FormData();
    form.append("file", file, file.name || "question.jpg");
    form.append("user", user);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${keyFor("photo")}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DifyError(`Dify 文件上传返回 HTTP ${response.status}`, "upstream", response.status);
    }
    const json = (await response.json()) as { id?: string };
    if (!json.id) throw new DifyError("Dify 文件上传未返回 id", "invalid");
    return json.id;
  } catch (error) {
    if (error instanceof DifyError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DifyError("Dify 文件上传超时", "timeout");
    }
    throw new DifyError(
      `Dify 文件上传失败：${error instanceof Error ? error.message : "未知错误"}`,
      "upstream",
    );
  } finally {
    clearTimeout(timer);
  }
}
