import {
  definitionSchema,
  exampleSchema,
  optionSchema,
  paragraphSchema,
  type Definition,
  type Example,
  type OptionAnalysis,
  type Paragraph,
  type QuestionOption,
} from "./types";

/**
 * SQLite 没有 Json 原生类型，JSON 字段以文本落库。
 * 所有进出库的转换都收敛在这里，业务代码永远拿到强类型对象。
 * 任何解析失败都退回安全默认值，绝不让脏数据把页面搞白屏。
 */

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function parseParagraphs(raw: string | null): Paragraph[] {
  const data = parseJson(raw);
  const list = Array.isArray(data) ? data : [];
  const out: Paragraph[] = [];
  for (const item of list) {
    const parsed = paragraphSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseOptions(raw: string | null): QuestionOption[] {
  const data = parseJson(raw);
  const list = Array.isArray(data) ? data : [];
  const out: QuestionOption[] = [];
  for (const item of list) {
    const parsed = optionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseDefinitions(raw: string | null): Definition[] {
  const data = parseJson(raw);
  const list = Array.isArray(data) ? data : [];
  const out: Definition[] = [];
  for (const item of list) {
    // 兼容 [{pos, zh}] 与 ["释义"] 两种历史形态
    if (typeof item === "string") {
      out.push({ pos: "", zh: item });
      continue;
    }
    const parsed = definitionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseExamples(raw: string | null): Example[] {
  const data = parseJson(raw);
  const list = Array.isArray(data) ? data : [];
  const out: Example[] = [];
  for (const item of list) {
    const parsed = exampleSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseOptionAnalysis(raw: string | null): OptionAnalysis | null {
  const data = parseJson(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const out: OptionAnalysis = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** 写库前把对象序列化，undefined 存 null */
export function toJsonText(value: unknown): string {
  return JSON.stringify(value ?? null);
}

