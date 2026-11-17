/**
 * Dify 工作流输出 → 项目 UI 结构的适配器。
 *
 * 为什么需要：四个 DSL 里的 LLM 被要求输出 Markdown（如 WF1 的
 * 「## 英文改编稿 / ## 专名表 / ## 改编说明」），而创作页的 studio 组件
 * 消费的是 NovelOutput / VideoOutput 结构化对象。这层负责把两边对齐，
 * 解析不出来时保留 markdown 原文兜底，不让整条链路崩掉。
 */

import {
  countEnWords,
  splitParagraphs,
  type NovelOutput,
  type VideoOptions,
  type VideoOutput,
  type VideoScene,
} from "./creation";

/** 从 Markdown 里取某个 ## 小节的内容（到下一个 ## 或文末） */
export function mdSection(md: string, title: string): string {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const found: string[] = [];
  let inside = false;
  for (const line of lines) {
    // 只认「## 标题」这种带空格的二级小节；单个 # 开头的行可能是话题标签本身
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (inside) break;
      if (heading[1].indexOf(title) >= 0) {
        inside = true;
        continue;
      }
    }
    if (inside) found.push(line);
  }
  return found.join("\n").trim();
}

/** 去掉行首的 Markdown 列表符号 / 序号 */
function stripBullet(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*\|?\s*/, "")
    .trim();
}

/** WF1 adapted_md → NovelOutput */
export function adaptNovelMarkdown(
  md: string,
  sourceText: string,
  blocked: boolean,
): NovelOutput {
  const body = mdSection(md, "英文改编稿") || md;
  const glossaryMd = mdSection(md, "专名表");
  const notesMd = mdSection(md, "改编说明");
  const sourceParas = splitParagraphs(sourceText, 24);

  const enParas = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && stripBullet(p).length > 0);

  const paragraphs = (enParas.length > 0 ? enParas : [body]).map((en, i) => ({
    zh: sourceParas[i] || (i === 0 ? sourceText : ""),
    en: blocked ? "" : stripBullet(en),
  }));

  const glossary: { term: string; gloss: string }[] = [];
  for (const line of glossaryMd.split(/\r?\n/)) {
    const clean = stripBullet(line);
    if (!clean) continue;
    // 兼容「中文原名（英文）— 说明」与表格「| 中文 | English |」
    const parts = clean.split(/\s*[—–:\-]\s+|\s*\|\s*/).filter(Boolean);
    if (parts.length >= 2) {
      glossary.push({ term: parts[0].trim(), gloss: parts.slice(1).join(" ").trim() });
    }
    if (glossary.length >= 12) break;
  }

  const notes = notesMd
    .split(/\r?\n/)
    .map(stripBullet)
    .filter((n) => n.length > 0)
    .slice(0, 8);

  const enAll = paragraphs.map((p) => p.en).join(" ");
  return {
    title: blocked ? "（已阻断：检出隐私泄漏）" : "Dify 英文改编稿",
    subtitle: `共 ${paragraphs.length} 段 · Agent 工作流产出`,
    paragraphs,
    glossary,
    notes: blocked ? ["出关复扫命中原始 PII，已阻断交付；请脱敏后重试。"] : notes,
    wordCount: blocked ? 0 : countEnWords(enAll),
  };
}

/** WF2 package_md → VideoOutput；captions_vtt 作为字段外的补充，不塞进 UI 结构 */
export function adaptVideoMarkdown(
  md: string,
  options: VideoOptions,
  blocked: boolean,
): VideoOutput {
  const titleSection = mdSection(md, "标题");
  const hooksMd = mdSection(md, "开场钩子");
  const scenesMd = mdSection(md, "分镜");
  const tagsMd = mdSection(md, "话题标签");
  const coverMd = mdSection(md, "封面文案");
  const descMd = mdSection(md, "发布描述");

  const title = stripBullet(titleSection.split(/\r?\n/)[0] || "") || "Dify 短视频发布包";

  const hooks = hooksMd
    .split(/\r?\n/)
    .map(stripBullet)
    .filter((h) => h.length > 0)
    .slice(0, 4);

  const scenes: VideoScene[] = [];
  for (const line of scenesMd.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line
      .replace(/^\s*\|/, "")
      .replace(/\|\s*$/, "")
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !/^[-:]+$/.test(c));
    if (cells.length >= 2) {
      scenes.push({
        sec: cells[0],
        visual: cells[1],
        voiceover: cells[2] || "",
        caption: cells[3] || cells[2] || "",
      });
    }
    if (scenes.length >= 12) break;
  }
  // 表格解析失败时退成「一行一句」的分镜，至少不让 UI 空着
  if (scenes.length === 0 && scenesMd) {
    scenesMd
      .split(/\r?\n/)
      .map(stripBullet)
      .filter(Boolean)
      .slice(0, 8)
      .forEach((line, i) => {
        scenes.push({ sec: `${i * 4}-${(i + 1) * 4}s`, visual: "", voiceover: line, caption: "" });
      });
  }

  const hashtags = tagsMd
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith("#"))
    .slice(0, 8);

  return {
    platform: options.platform,
    title: blocked ? "（已阻断：检出隐私泄漏）" : title,
    hooks: blocked ? [] : hooks,
    scenes: blocked ? [] : scenes,
    hashtags: blocked ? [] : hashtags,
    coverText: blocked ? "" : stripBullet(coverMd.split(/\r?\n/)[0] || ""),
    description: blocked
      ? "出关复扫命中原始 PII，已阻断交付；请脱敏后重试。"
      : descMd.trim(),
  };
}

/** WF3 outputs → 拍照搜题结果（DSL 输出的就是结构化字段，直接归一化） */
export type PhotoSolveData = {
  question: string;
  questionType: string;
  answer: string;
  steps: string[];
  pitfalls: string[];
  confidence: "high" | "low";
  needRecapture: boolean;
  blocked: boolean;
  note: string;
  redactCount: number;
};

export function adaptPhotoOutputs(outputs: Record<string, unknown>): PhotoSolveData {
  const solutionRaw = outputs.solution;
  let solution: Record<string, unknown> = {};
  if (typeof solutionRaw === "string") {
    try {
      const parsed = JSON.parse(solutionRaw) as unknown;
      if (parsed && typeof parsed === "object") solution = parsed as Record<string, unknown>;
    } catch {
      solution = { text: solutionRaw };
    }
  } else if (solutionRaw && typeof solutionRaw === "object") {
    solution = solutionRaw as Record<string, unknown>;
  }

  const asLines = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    if (typeof v === "string" && v.trim()) return v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    return [];
  };

  const confidence = outputs.confidence === "high" ? "high" : "low";
  const needRecapture = Boolean(outputs.need_recapture) || confidence === "low";
  const blocked = Boolean(outputs.blocked) || needRecapture;

  return {
    question: String(outputs.question_text ?? ""),
    questionType: String(outputs.question_type ?? ""),
    answer: blocked ? "" : String(solution.answer ?? solution.text ?? ""),
    steps: blocked ? [] : asLines(solution.steps),
    pitfalls: blocked ? [] : asLines(solution.pitfalls),
    confidence,
    needRecapture,
    blocked,
    note: String(outputs.note ?? ""),
    redactCount: Number(outputs.redact_count ?? 0),
  };
}
