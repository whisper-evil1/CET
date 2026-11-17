import { Errors, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

/**
 * POST /api/create/export-subs —— 英文字幕文件导出（SRT / VTT）。
 *
 * 时间码按用户上传视频的真实时长均匀分配到每条字幕。这是自动均分，
 * 不是逐句对齐，界面须提示「按实际剪辑校对」。生成后直接下载文件。
 */
export const maxDuration = 30;

const schema = z.object({
  format: z.enum(["srt", "vtt"]),
  lines: z.array(z.string().max(300)).min(1).max(60),
  durationSec: z.number().min(1).max(3600),
  title: z.string().max(120).optional(),
});

function stamp(sec: number, sep: "," | "."): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms).padStart(3, "0")}`;
}

function safeFileName(name: string): string {
  return (name || "captions").replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "captions";
}

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`create-export-subs:${userId}`, { windowMs: 10 * 60_000, max: 40 });
  if (!limited.allowed) {
    return Errors.tooMany(`导出太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, schema);
  const lines = body.lines.map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return Errors.badRequest("没有可导出的字幕行");

  const each = body.durationSec / lines.length;
  let content: string;

  if (body.format === "srt") {
    const blocks: string[] = [];
    lines.forEach((line, i) => {
      const start = i * each;
      const end = Math.min(body.durationSec, (i + 1) * each);
      blocks.push(`${i + 1}\n${stamp(start, ",")} --> ${stamp(end, ",")}\n${line}`);
    });
    content = blocks.join("\n\n");
  } else {
    const blocks: string[] = ["WEBVTT", ""];
    lines.forEach((line, i) => {
      const start = i * each;
      const end = Math.min(body.durationSec, (i + 1) * each);
      blocks.push(`${stamp(start, ".")} --> ${stamp(end, ".")}\n${line}`);
    });
    content = blocks.join("\n");
  }

  const fileName = safeFileName(body.title || "captions");
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": body.format === "srt" ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.${body.format}`,
      "Cache-Control": "no-store",
    },
  });
});
