import { aiConfig } from "./ai";
import type { ExperiencePack } from "./types";

/**
 * AI 经验包生成。
 * - 配了 AI Key：让模型基于「题干 + 选项 + 正确答案 + 官方解析 + 逐项分析 + 公开讨论」归纳经验包。
 * - 没配 Key 或调用失败：用 rule-based 本地归纳兜底，保证卡片永远有内容可展示（不白屏）。
 *
 * 它讲的是「大多数人为什么错」，不是官方解析的复述。
 */

export type ExperienceInput = {
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
  analysis: string;
  optionAnalysis: Record<string, string> | null;
  comments: string[];
};

/** 落库前的草稿（不含 basedOnCommentCount / generatedAt，那两项由路由层补） */
export type ExperienceDraft = {
  pitfall: string;
  correctApproach: string;
  commonMistakes: string[];
  keyVocab: string[];
};

export function buildExperiencePrompt(input: ExperienceInput): string {
  const options = input.options.map((o) => `${o.key}. ${o.text}`).join("\n");
  const perOption = input.optionAnalysis
    ? Object.entries(input.optionAnalysis)
        .map(([k, v]) => `${k}. ${v}`)
        .join("\n")
    : "（无逐项分析）";
  const discussion = input.comments.length
    ? input.comments
        .slice(0, 30)
        .map((c, i) => `${i + 1}. ${c}`)
        .join("\n")
    : "（暂无公开讨论）";

  return `你是四六级阅读教研老师。请基于下面这道题，归纳一份"经验包"，帮助后来者少踩坑。
只输出一个 JSON 对象，不要任何解释文字、不要代码块标记。
输出格式：
{"pitfall":"一句话点出这题最容易错的地方","correctApproach":"分步骤的正确思路，用 1. 2. 3. 编号","commonMistakes":["常见错误原因1","常见错误原因2"],"keyVocab":["关键生词1","关键生词2"]}

【题干】${input.stem}
【选项】
${options}
【正确答案】${input.answer}
【官方解析】${input.analysis}
【逐项分析】
${perOption}
【学生公开讨论（最近 30 条）】
${discussion}`;
}

/* ---------------- AI 调用（非流式，拿一次性 JSON） ---------------- */

type AiDraftPayload = {
  pitfall?: unknown;
  correctApproach?: unknown;
  commonMistakes?: unknown;
  keyVocab?: unknown;
};

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

async function draftFromProvider(input: ExperienceInput): Promise<ExperienceDraft | null> {
  const config = aiConfig();
  if (!config.enabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        max_tokens: 700,
        messages: [{ role: "user", content: buildExperiencePrompt(input) }],
      }),
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const payload = JSON.parse(match[0]) as AiDraftPayload;
    if (typeof payload.pitfall !== "string" || !payload.pitfall.trim()) return null;

    return {
      pitfall: payload.pitfall.trim(),
      correctApproach:
        typeof payload.correctApproach === "string" ? payload.correctApproach.trim() : "",
      commonMistakes: toStringArray(payload.commonMistakes, 6),
      keyVocab: toStringArray(payload.keyVocab, 8),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 本地规则兜底 ---------------- */

const STOP_WORDS = new Set([
  "which", "their", "there", "these", "those", "about", "would", "could", "should",
  "while", "where", "after", "before", "because", "through", "between", "being",
  "other", "under", "still", "every", "might", "shall", "according", "passage",
  "author", "following", "question", "answer", "statement", "best", "title",
]);

function extractKeyVocab(text: string, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z'-]+/)) {
    const w = raw.replace(/^[^a-z]+|[^a-z']+$/g, "");
    if (w.length < 6 || STOP_WORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^[^。.!?]+[。.!?]?/);
  return (m?.[0] ?? cleaned).slice(0, 120);
}

export function localDraft(input: ExperienceInput): ExperienceDraft {
  const pitfall = input.analysis
    ? firstSentence(input.analysis)
    : "当心选项对原文的主语、范围或程度做了细微改动。";

  const correctApproach = [
    "1. 先读题干，圈出人名、时间、专有名词等定位词。",
    "2. 回到原文找到同一段落的那句话，只以原句为准。",
    `3. 正确答案是 ${input.answer || "（见官方解析）"}，其余选项逐条与原文比对，凡有出入即可排除。`,
  ].join("\n");

  const commonMistakes = input.optionAnalysis
    ? Object.entries(input.optionAnalysis)
        .filter(([key]) => key !== input.answer)
        .map(([key, why]) => `选 ${key}：${why}`)
        .slice(0, 4)
    : ["凭印象作答，没有回到原文核对", "被绝对化或夸大表述带偏"];

  const keyVocab = extractKeyVocab(
    [input.stem, ...input.options.map((o) => o.text), input.analysis].join(" "),
    6,
  );

  return { pitfall, correctApproach, commonMistakes, keyVocab };
}

/* ---------------- 对外：生成（AI 优先，失败兜底） ---------------- */

export async function generateExperience(input: ExperienceInput): Promise<ExperienceDraft> {
  const ai = await draftFromProvider(input);
  return ai ?? localDraft(input);
}

export type { ExperiencePack };
