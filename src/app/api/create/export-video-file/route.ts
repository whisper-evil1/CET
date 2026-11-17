import { Errors, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { VIDEO_MAX_BYTES } from "@/lib/video-probe";
import { burnEnglishSubtitles, muxEnglishSubtitles } from "@/lib/video-export";
import { dubEnglishVideo } from "@/lib/video-dub";

/**
 * POST /api/create/export-video-file —— 原视频 + 英文字幕 → MP4。
 *
 * mode=burn（默认）：字幕烧录进画面，保留原声。
 * mode=soft：只封装 mov_text 软字幕轨，无损、更快，供需要开关字幕的场景。
 * mode=dub：英文字幕逐句合成语音替换原中文音轨，字幕按真实配音时长对齐（服务端 msedge-tts，无 Python 依赖）。
 * 输入：multipart，video + lines(JSON 数组) + durationSec + title + 可选 height/mode。
 * 输出：MP4 下载。原视频用完即删，不落库。
 */
export const maxDuration = 600;

function safeFileName(name: string): string {
  return (name || "video-package").replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "video-package";
}

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  // 一次导出 3–10 秒出片，用户常常连点两三次换效果；5 次/10 分钟太紧，
  // 会把「重试一下」直接变成 429。放开到 10 次，仍能挡住脚本刷。
  const limited = rateLimit(`create-export-video-file:${userId}`, { windowMs: 10 * 60_000, max: 10 });
  if (!limited.allowed) {
    return Errors.tooMany(`导出太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Errors.badRequest("请求格式不对，请用文件上传");
  }

  const file = form.get("video");
  if (!(file instanceof File)) return Errors.badRequest("请重新上传视频原件");
  if (file.size === 0) return Errors.badRequest("视频文件是空的");
  if (file.size > VIDEO_MAX_BYTES) return Errors.badRequest("视频不能超过 100MB");

  let lines: string[];
  let durationSec: number;
  try {
    const parsed = JSON.parse(String(form.get("lines") ?? "[]"));
    if (!Array.isArray(parsed) || parsed.some((l) => typeof l !== "string")) {
      throw new Error("字幕格式不对");
    }
    lines = parsed as string[];
    durationSec = Number(form.get("durationSec"));
  } catch {
    return Errors.badRequest("字幕或时长参数不对，请重新生成发布包");
  }
  if (lines.length === 0) return Errors.badRequest("没有可封装的字幕，请先生成发布包");
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3600) {
    return Errors.badRequest("视频时长不合法");
  }

  const modeParam = String(form.get("mode") ?? "burn");
  const mode = modeParam === "dub" || modeParam === "soft" ? modeParam : "burn";
  const height = Number(form.get("height") ?? 360);
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 360;

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = mode === "dub"
      ? await dubEnglishVideo(file.name, bytes, lines, durationSec, safeHeight)
      : mode === "soft"
        ? await muxEnglishSubtitles(file.name, bytes, lines, durationSec)
        : await burnEnglishSubtitles(file.name, bytes, lines, durationSec, safeHeight);
    const suffix = mode === "dub" ? "en-dubbed" : mode === "soft" ? "with-en-subs" : "en-burned";
    const fileName = `${safeFileName(String(form.get("title") ?? ""))}.${suffix}.mp4`;
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Subtitle-Mode": result.mode,
      },
    });
  } catch (error) {
    console.error("[export-video-file] failed:", error instanceof Error ? error.message : error);
    const detail = error instanceof Error ? error.message : "请换个视频重试";
    if (mode === "dub") {
      // 配音现在走服务端 msedge-tts（与听力音频同一条链路），失败通常是网络抖动或
      // 音色接口限流，不再有「缺 Python 包」这种环境问题。提示要指向能自救的动作。
      return Errors.badRequest(
        `英文配音失败：${detail}。可以直接再点一次重试；如果一直失败，先导出「字幕视频 MP4」，配音稍后再试。`,
      );
    }
    return Errors.badRequest(`视频封装失败：${detail}`);
  }
});
