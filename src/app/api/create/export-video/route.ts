import { Errors, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import { VIDEO_PLATFORM_LABEL } from "@/lib/creation";

/**
 * POST /api/create/export-video —— 短视频出海发布包导出为 Word(.docx)。
 *
 * 报告含：需求摘要、视频元信息、发布包（标题/钩子/分镜/字幕/标签/封面/描述）。
 * docx 只引用字体名不嵌字体，中文正常；PDF 仍走前端「预览→打印」。
 */
export const maxDuration = 60;

const schema = z.object({
  output: z.object({
    platform: z.enum(["youtube", "tiktok"]),
    title: z.string(),
    hooks: z.array(z.string()).optional(),
    scenes: z.array(z.object({
      sec: z.string(), visual: z.string(), voiceover: z.string(), caption: z.string(),
    })).optional(),
    hashtags: z.array(z.string()).optional(),
    coverText: z.string().optional(),
    description: z.string().optional(),
  }),
  needText: z.string().max(2000).optional().default(""),
  videoMeta: z.object({
    durationSec: z.number(), width: z.number(), height: z.number(), format: z.string(),
  }).optional(),
});

function safeFileName(name: string): string {
  return (name || "video-package").replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "video-package";
}

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`create-export-video:${userId}`, { windowMs: 10 * 60_000, max: 30 });
  if (!limited.allowed) {
    return Errors.tooMany(`导出太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, schema);
  const out = body.output;

  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
  } = await import("docx");

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  children.push(new Paragraph({
    text: out.title || "Untitled Short",
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `短视频出海发布包 · ${VIDEO_PLATFORM_LABEL[out.platform]}`, color: "2F5B8F", size: 22 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }));

  if (body.videoMeta) {
    const m = body.videoMeta;
    children.push(new Paragraph({
      children: [new TextRun({
        text: `原视频：${m.format.toUpperCase()} · ${m.width}×${m.height} · ${m.durationSec}s`,
        color: "888888", size: 18,
      })],
      alignment: AlignmentType.CENTER, spacing: { after: 80 },
    }));
  }
  if (body.needText.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "需求描述", bold: true, size: 24 })], spacing: { before: 160, after: 80 },
    }));
    children.push(new Paragraph({ text: body.needText.trim(), spacing: { after: 160 } }));
  }

  if (out.hooks && out.hooks.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "开场钩子", bold: true, size: 24 })], spacing: { before: 160, after: 80 },
    }));
    out.hooks.forEach((h, i) => children.push(new Paragraph({ text: `${i + 1}. ${h}`, spacing: { after: 40 } })));
  }

  if (out.scenes && out.scenes.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "分镜脚本", bold: true, size: 24 })], spacing: { before: 200, after: 100 },
    }));
    const rows = out.scenes.map((s) => new TableRow({
      children: [
        new TableCell({ children: [new Paragraph(s.sec)], width: { size: 12, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph(s.visual)], width: { size: 30, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph(s.voiceover)], width: { size: 33, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph(s.caption)], width: { size: 25, type: WidthType.PERCENTAGE } }),
      ],
    }));
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  const simpleField = (label: string, value: string) => {
    if (!value) return;
    children.push(new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 24 })], spacing: { before: 200, after: 80 },
    }));
    children.push(new Paragraph({ text: value, spacing: { after: 120 } }));
  };
  simpleField("话题标签", (out.hashtags ?? []).join(" "));
  simpleField("封面文案", out.coverText ?? "");
  simpleField("发布描述", out.description ?? "");

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buffer = await Packer.toBuffer(doc);
  const fileName = safeFileName(out.title || "video-package");

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.docx`,
      "Cache-Control": "no-store",
    },
  });
});
