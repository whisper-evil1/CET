import { createRequire } from "node:module";

/**
 * 文档文本抽取（仅服务端）。
 *
 * 支持：.txt / .md / .docx / .pdf / .zip（压缩包内递归提取上述类型）。
 * 用途：小说英译改编页上传中文原稿 → 抽出文本填入编辑框，用户校对后再生成。
 *
 * 依赖都在服务端 node_modules，不进浏览器包；pdf-parse 直接引核心文件，
 * 绕开它入口文件里 `!module.parent` 时读测试 PDF 的 debug 坑。
 */
const require = createRequire(import.meta.url);

export const INGEST_MAX_BYTES = 20 * 1024 * 1024; // 单文件 20MB
export const INGEST_TOTAL_CHARS = 60000; // 累计抽取文本上限（编辑框 6000 字，留足余量）

export type IngestResult = {
  text: string;
  files: string[];
  skipped: string[];
  truncated: boolean;
};

type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;

function loadPdfParse(): PdfParseFn {
  return require("pdf-parse/lib/pdf-parse.js") as PdfParseFn;
}

async function extractOne(name: string, buf: Buffer): Promise<string> {
  const lower = name.toLowerCase();
  if (/\.(txt|md|markdown)$/.test(lower)) {
    return buf.toString("utf8");
  }
  if (/\.docx$/.test(lower)) {
    const mammoth = require("mammoth") as {
      extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value ?? "";
  }
  if (/\.pdf$/.test(lower)) {
    const parse = loadPdfParse();
    const result = await parse(buf);
    return result.text ?? "";
  }
  return "";
}

function isSupported(name: string): boolean {
  return /\.(txt|md|markdown|docx|pdf)$/i.test(name);
}

/**
 * 从上传文件抽取纯文本。zip 用 jszip 解压后递归处理内部文件
 * （只取支持的文本类型，跳过图片/字体/二进制，避免把噪声塞进编辑框）。
 */
export async function ingestDocument(name: string, buf: Buffer): Promise<IngestResult> {
  const lower = name.toLowerCase();
  const files: string[] = [];
  const skipped: string[] = [];
  let text = "";

  if (/\.zip$/.test(lower)) {
    const JSZip = require("jszip") as new () => {
      loadAsync: (data: Buffer) => Promise<{
        files: Record<string, { dir: boolean; async: (type: string) => Promise<Buffer> }>;
      }>;
    };
    const zip = await new JSZip().loadAsync(buf);
    // 按文件名稳定排序，保证多次抽取顺序一致
    const named = Object.entries(zip.files)
      .filter(([, f]) => !f.dir)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [entryName, file] of named) {
      // 跳过隐藏文件与 __MACOSX 之类元数据
      if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(entryName)) continue;
      if (!isSupported(entryName)) {
        skipped.push(entryName);
        continue;
      }
      try {
        const content = await file.async("nodebuffer");
        const part = await extractOne(entryName, content);
        if (part.trim()) {
          text += `\n\n${part.trim()}`;
          files.push(entryName);
        }
      } catch (error) {
        skipped.push(`${entryName}（解析失败：${error instanceof Error ? error.message : "未知"}）`);
      }
    }
  } else if (isSupported(name)) {
    text = await extractOne(name, buf);
    files.push(name);
  } else {
    throw new Error(`不支持的文件类型：${name}`);
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  let truncated = false;
  if (text.length > INGEST_TOTAL_CHARS) {
    text = text.slice(0, INGEST_TOTAL_CHARS);
    truncated = true;
  }
  return { text, files, skipped, truncated };
}
