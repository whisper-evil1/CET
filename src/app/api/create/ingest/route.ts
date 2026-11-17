import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { ingestDocument, INGEST_MAX_BYTES } from "@/lib/doc-ingest";

/**
 * POST /api/create/ingest —— 上传文档抽取文本（小说英译改编的原文输入）。
 *
 * 支持 .txt/.md/.docx/.pdf/.zip；zip 内递归提取。解析出的文本返回前端填入编辑框，
 * 由用户校对后再生成——不直接送模型，保留项目「可校对、不丢信息」的一贯风格。
 */
export const maxDuration = 60;

const ALLOW = /\.(txt|md|markdown|docx|pdf|zip)$/i;

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`create-ingest:${userId}`, { windowMs: 10 * 60_000, max: 30 });
  if (!limited.allowed) {
    return Errors.tooMany(`上传太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Errors.badRequest("请求格式不对，请用文件上传");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Errors.badRequest("请选择一个文件");
  if (!ALLOW.test(file.name)) {
    return Errors.badRequest("只支持 TXT / Markdown / Word(.docx) / PDF / ZIP 压缩包");
  }
  if (file.size > INGEST_MAX_BYTES) return Errors.badRequest("文件不能超过 20MB");
  if (file.size === 0) return Errors.badRequest("文件是空的");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestDocument(file.name, buffer);
    if (!result.text.trim()) {
      return Errors.badRequest("没有从文件里读出文字。若是扫描版 PDF 或纯图片，请先转成可复制文本再上传");
    }
    return ok(result);
  } catch (error) {
    console.error("[ingest] failed:", error instanceof Error ? error.message : error);
    return Errors.badRequest(
      `文件解析失败：${error instanceof Error ? error.message : "请换个文件试试"}`,
    );
  }
});
