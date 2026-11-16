import { Errors, fail, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { redactText, redactForLog } from "@/lib/agent-redact";
import { DifyError, difyEnabled, runWorkflow, uploadImage } from "@/lib/dify-agent";
import { adaptPhotoOutputs, type PhotoSolveData } from "@/lib/agent-adapter";
import { solvePhotoBuiltin } from "@/lib/agent-photo-builtin";

/**
 * POST /api/agent/solver/photo —— 拍照搜题网关（multipart/form-data）。
 *
 * 前端 apiFetch 已修 FormData 兼容（不再强加 Content-Type，boundary 交给浏览器）。
 * 链路：登录 → 限流 → 图片白名单/体积校验 → 补充文字脱敏 → 上传 Dify → WF3 → 适配。
 *
 * 双后端：配了 Dify WF3 走 Dify；未配置时用云模型视觉能力的内置通道
 * （视觉识别题干 → 脱敏 → 分步解答），零配置即可用。两者共用结果结构。
 * 低置信度 / 非题目图一律引导补拍，**不返回猜测答案**。
 */
export const maxDuration = 90;

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type PhotoData = PhotoSolveData & { job_id: string; mode: "dify" | "builtin"; elapsed_ms: number };

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`agent-photo:${userId}`, { windowMs: 10 * 60_000, max: 15 });
  if (!limited.allowed) {
    return Errors.tooMany(`搜题太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Errors.badRequest("请求格式不对，请用拍照上传");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.indexOf("multipart/form-data") < 0) {
    return Errors.badRequest("请用 multipart/form-data 上传图片");
  }

  const image = form.get("image");
  if (!(image instanceof File)) return Errors.badRequest("请先拍一张题目标题照");
  if (!ALLOWED_MIME.has(image.type)) {
    return Errors.badRequest("只支持 JPG / PNG / WebP 格式的图片");
  }
  if (image.size > MAX_BYTES) return Errors.badRequest("图片不能超过 8MB");
  if (image.size === 0) return Errors.badRequest("图片是空的，请重新拍摄");

  const hintText = typeof form.get("hint_text") === "string" ? (form.get("hint_text") as string) : "";
  const clientRequestId =
    typeof form.get("client_request_id") === "string"
      ? (form.get("client_request_id") as string).slice(0, 80)
      : "";
  const redacted = redactText(hintText);
  console.info("[agent] photo inbound", { user: userId, job: clientRequestId || "-", ...redactForLog(redacted) });

  const started = Date.now();

  // 后端一：Dify WF3（配了就用它）
  if (difyEnabled("photo")) {
    try {
      const uploadFileId = await uploadImage(image, userId);
      const run = await runWorkflow(
        "photo",
        {
          image: { upload_file_id: uploadFileId, type: "image" },
          hint_text: redacted.cleanText,
        },
        userId,
      );
      const data = adaptPhotoOutputs(run.outputs);
      const payload: PhotoData = {
        ...data,
        job_id: clientRequestId || run.taskId || `photo_${Date.now().toString(36)}`,
        mode: "dify",
        elapsed_ms: Date.now() - started,
      };
      return ok(payload); // blocked/needRecapture 时前端按引导补拍，不展示猜测答案
    } catch (error) {
      if (!(error instanceof DifyError && error.kind === "unconfigured")) {
        console.warn("[agent] dify photo failed, fallback to builtin:", error instanceof Error ? error.message : error);
      }
    }
  }

  // 后端二：内置视觉通道（云模型识图 + 解答），零配置可用
  try {
    const buffer = Buffer.from(await image.arrayBuffer());
    const data = await solvePhotoBuiltin(buffer, image.type, redacted.cleanText);
    const payload: PhotoData = {
      ...data,
      job_id: clientRequestId || `photo_${Date.now().toString(36)}`,
      mode: "builtin",
      elapsed_ms: Date.now() - started,
    };
    return ok(payload);
  } catch (error) {
    console.error("[agent] photo builtin failed:", error instanceof Error ? error.message : error);
    return fail(5001, "搜题服务暂时不可用，请稍后重试", 502);
  }
});
