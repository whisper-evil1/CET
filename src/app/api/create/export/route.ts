import { Errors, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";
import type { NovelOutput } from "@/lib/creation";

/**
 * POST /api/create/export —— 把英译改编稿导出为 Word(.docx)。
 *
 * 为什么 PDF 不在这里做：服务端生成 PDF 需内嵌 8MB+ 中文字体，包体和部署都重；
 * 前端「打印预览 → 另存 PDF」由浏览器原生渲染，中文完美、零依赖、且天然可预览。
 * docx 只需引用字体名，不需要嵌字体，适合服务端生成。
 */
export const maxDuration = 60;

const exportSchema = z.object({
  format: z.literal("docx"),
  title: z.string().max(200).default("英文改编稿"),
  output: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    paragraphs: z.array(z.object({ zh: z.string(), en: z.string() })),
    glossary: z.array(z.object({ term: z.string(), gloss: z.string() })).optional(),
    notes: z.array(z.string()).optional(),
    wordCount: z.number().optional(),
  }),
});

function safeFileName(name: string): string {
  return (name || "adaptation").replace(/[\\/:*?"<>|]/g, "").slice(0, 40) || "adaptation";
}

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`create-export:${userId}`, { windowMs: 10 * 60_000, max: 30 });
  if (!limited.allowed) {
    return Errors.tooMany(`导出太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, exportSchema);
  const out = body.output as NovelOutput;

  // 动态 import，避免 docx 体积影响主包加载
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import("docx");

  // docx 的 sections.children 接受 (Paragraph | Table)[]，用宽松类型避免标注冲突
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  children.push(
    new Paragraph({
      text: out.title || "Untitled",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }),
  );
  if (out.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: out.subtitle, italics: true, color: "666666" })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
      }),
    );
  }

  children.push(
    new Paragraph({
      children: [new TextRun({ text: "段级对照（中文原文 / 英文改编）", bold: true, size: 24 })],
      spacing: { before: 120, after: 120 },
    }),
  );

  for (let i = 0; i < out.paragraphs.length; i++) {
    const p = out.paragraphs[i];
    if (i > 0) children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `原文 ${i + 1}`, bold: true, size: 18, color: "888888" })],
        spacing: { after: 60 },
      }),
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: p.zh, size: 21 })],
        spacing: { after: 100 },
      }),
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `English ${i + 1}`, bold: true, size: 18, color: "2F5B8F" })],
        spacing: { after: 60 },
      }),
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: p.en || "（未生成英文）", size: 21 })],
        spacing: { after: 160 },
      }),
    );
  }

  if (out.glossary && out.glossary.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "专名表", bold: true, size: 24 })],
        spacing: { before: 240, after: 120 },
      }),
    );
    const rows = out.glossary.map(
      (g) =>
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: g.term, bold: true })] })],
              width: { size: 30, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: g.gloss })] })],
              width: { size: 70, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
    );
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  }

  if (out.notes && out.notes.length > 0) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "改编说明", bold: true, size: 24 })],
        spacing: { before: 240, after: 120 },
      }),
    );
    for (const note of out.notes) {
      children.push(new Paragraph({ text: `· ${note}`, spacing: { after: 60 } }));
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  const buffer = await Packer.toBuffer(doc);
  const fileName = safeFileName(out.title || body.title);

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}.docx`,
      "Cache-Control": "no-store",
    },
  });
});
