import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { probeVideo, VIDEO_MAX_BYTES } from "@/lib/video-probe";

/**
 * POST /api/create/video-probe —— 上传视频，读元数据并抽关键帧供预览。
 *
 * 本轮最小闭环：视频只用于抽帧预览与时长，改编仍以用户手填的中文口播稿为准。
 * 不做语音识别、不生成英文配音（当前环境无 ASR/TTS）。视频用完即删，不落库。
 */
export const maxDuration = 90;

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`video-probe:${userId}`, { windowMs: 10 * 60_000, max: 20 });
  if (!limited.allowed) {
    return Errors.tooMany(`上传太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Errors.badRequest("请求格式不对，请用文件上传");
  }
  const file = form.get("video");
  if (!(file instanceof File)) return Errors.badRequest("请选择一个视频文件");
  if (file.size > VIDEO_MAX_BYTES) return Errors.badRequest("视频不能超过 100MB");
  if (file.size === 0) return Errors.badRequest("文件是空的");

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = await probeVideo(file.name, buffer, 4);
    return ok(meta);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    console.error("[video-probe] failed:", detail || error);
    // 缺 ffmpeg / 跑不起来，都不是用户的文件有问题，别让用户反复换文件试
    if (/ffmpeg/i.test(detail)) {
      return Errors.server(
        "视频处理组件还没就绪（服务端 ffmpeg 无法执行），正在自动修复，请稍后重试",
      );
    }
    return Errors.badRequest(`视频读取失败：${detail || "请换个文件试试"}`);
  }
});
