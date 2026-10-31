import { prisma } from "./prisma";
import { parseDefinitions, parseExamples, toJsonText } from "./db-mappers";
import { aiConfig } from "./ai";
import { BUILTIN_DICT } from "@/data/builtin-dict";
import type { Definition, Example, WordEntry } from "./types";

/**
 * 查词三级链路（每级命中都会写回 DictionaryEntry 缓存，尽量只查一次）：
 *   1. 本地缓存表 DictionaryEntry
 *   2. 内置离线词库（覆盖种子文章词汇 + 四六级核心词，无网也能查）
 *   3. AI 生成中文释义（配置了 Key 才会启用）
 * 全部失败返回 null，接口层给友好提示，不让前端白屏。
 */

const WORD_CLEAN = /^[a-zA-Z][a-zA-Z'-]*$/;

export function normalizeWord(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z']+$/g, "");
}

/**
 * 词形还原：对单词做后缀剥离，生成所有可能的原形候选。
 * 递归两层，处理复合变形如 researchers → researcher → research；
 * 处理双写辅音的 -ed/-ing，如 admitted → admit、running → run。
 */
export function candidatesFor(word: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (w: string) => {
    if (w.length > 2 && !seen.has(w)) {
      seen.add(w);
      ordered.push(w);
    }
  };

  add(word);
  // 第一层后缀剥离
  for (const stem of simpleStems(word)) {
    add(stem);
    // 第二层：对第一层结果再剥一次（researchers → researcher → research）
    for (const stem2 of simpleStems(stem)) add(stem2);
  }
  return ordered;
}

/** 双写辅音字母集合：英语中 CVC 模式变 -ed/-ing 时会双写 */
const DOUBLE_CONSONANTS = new Set("bcdfghjklmnprstz".split(""));
const VOWELS = new Set("aeiou".split(""));

/**
 * 对单个词做一轮后缀剥离，返回所有可能的原形（不含原词本身）。
 * 处理 -ies/-ied/-es/-s/-ed/-ing/-ly/-er/-est，并兼顾双写辅音还原。
 */
function simpleStems(w: string): string[] {
  const out: string[] = [];
  const push = (x: string) => {
    if (x.length > 2) out.push(x);
  };

  if (w.endsWith("ies")) push(w.slice(0, -3) + "y");
  if (w.endsWith("ied")) push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) push(w.slice(0, -1));

  if (w.endsWith("ed")) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
    // 双写辅音：admitted → 去 ed 得 admitt，末尾双 t 且前为元音 → 再去一 t 得 admit
    const deEd = w.slice(0, -2);
    if (looksLikeDoubled(deEd)) push(deEd.slice(0, -1));
  }
  if (w.endsWith("ing")) {
    push(w.slice(0, -3));
    push(w.slice(0, -3) + "e");
    // 双写辅音：running → 去 ing 得 runn，末尾双 n 且前为元音 → 再去一 n 得 run
    const deIng = w.slice(0, -3);
    if (looksLikeDoubled(deIng)) push(deIng.slice(0, -1));
  }
  if (w.endsWith("ly")) push(w.slice(0, -2));
  if (w.endsWith("est")) push(w.slice(0, -3));
  if (w.endsWith("er") && !w.endsWith("eer")) push(w.slice(0, -2));

  return out;
}

/** 判断去后缀后的词尾是否符合"双写辅音"模式：末两位相同辅音，且其前一位是元音 */
function looksLikeDoubled(stem: string): boolean {
  if (stem.length < 4) return false;
  const last2 = stem.slice(-2);
  if (last2[0] !== last2[1]) return false;
  if (!DOUBLE_CONSONANTS.has(last2[0])) return false;
  // 双写辅音前一位必须是元音（CVC 模式），否则是自然双写如 feed/letter
  // 注：自然双写的词原形本身就在词库里，误生成候选不影响命中
  return VOWELS.has(stem[stem.length - 3]);
}

async function fromCache(word: string): Promise<WordEntry | null> {
  const row = await prisma.dictionaryEntry.findUnique({ where: { word } });
  if (!row) return null;
  const definitions = parseDefinitions(row.definitions);
  if (!definitions.length) return null;
  return {
    word: row.word,
    phonetic: row.phonetic,
    definitions,
    examples: parseExamples(row.examples),
    source: "cache",
  };
}

async function saveCache(entry: WordEntry): Promise<void> {
  try {
    await prisma.dictionaryEntry.upsert({
      where: { word: entry.word },
      create: {
        word: entry.word,
        phonetic: entry.phonetic,
        definitions: toJsonText(entry.definitions),
        examples: toJsonText(entry.examples),
        source: entry.source,
      },
      update: {
        phonetic: entry.phonetic,
        definitions: toJsonText(entry.definitions),
        examples: toJsonText(entry.examples),
        source: entry.source,
      },
    });
  } catch (error) {
    // 并发查同一个词会撞唯一约束，这里静默即可，不影响返回结果
    console.warn("[dict] cache write skipped:", (error as Error).message);
  }
}

function fromBuiltin(word: string): WordEntry | null {
  for (const candidate of candidatesFor(word)) {
    const hit = BUILTIN_DICT[candidate];
    if (!hit) continue;
    return {
      word: candidate,
      phonetic: hit.phonetic ?? null,
      definitions: hit.defs.map<Definition>((zh, i) => ({
        pos: Array.isArray(hit.pos) ? (hit.pos[i] ?? hit.pos[0] ?? "") : (hit.pos ?? ""),
        zh,
      })),
      examples: hit.ex ? [{ en: hit.ex, zh: hit.exZh }] as Example[] : [],
      source: "builtin",
    };
  }
  return null;
}

type AiLookupPayload = {
  phonetic?: string;
  definitions?: { pos?: string; zh?: string }[];
  examples?: { en?: string; zh?: string }[];
};

async function fromAi(word: string, context?: string): Promise<WordEntry | null> {
  const config = aiConfig();
  if (!config.enabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

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
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "你是四六级词典。只输出 JSON，不要任何解释文字。格式：{\"phonetic\":\"/.../\",\"definitions\":[{\"pos\":\"n.\",\"zh\":\"中文释义\"}],\"examples\":[{\"en\":\"英文例句\",\"zh\":\"中文翻译\"}]}。definitions 给 1-3 条最常用的中文义项，按常用度排序；不要超过 3 条。",
          },
          {
            role: "user",
            content: context
              ? `单词：${word}\n它出现在这个句子里：${context}\n请按该语境给出释义。`
              : `单词：${word}`,
          },
        ],
      }),
    });

    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const payload = JSON.parse(match[0]) as AiLookupPayload;
    const definitions = (payload.definitions ?? [])
      .filter((d) => typeof d.zh === "string" && d.zh.trim())
      .slice(0, 3)
      .map<Definition>((d) => ({ pos: d.pos?.trim() ?? "", zh: d.zh!.trim() }));

    if (!definitions.length) return null;

    return {
      word,
      phonetic: payload.phonetic?.trim() || null,
      definitions,
      examples: (payload.examples ?? [])
        .filter((e) => typeof e.en === "string" && e.en.trim())
        .slice(0, 2)
        .map<Example>((e) => ({ en: e.en!.trim(), zh: e.zh?.trim() })),
      source: "ai",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupWord(raw: string, context?: string): Promise<WordEntry | null> {
  const word = normalizeWord(raw);
  if (!word || !WORD_CLEAN.test(word)) return null;

  for (const candidate of candidatesFor(word)) {
    const cached = await fromCache(candidate);
    if (cached) return { ...cached, word };
  }

  const builtin = fromBuiltin(word);
  if (builtin) {
    await saveCache(builtin);
    return { ...builtin, word };
  }

  const ai = await fromAi(word, context);
  if (ai) {
    await saveCache(ai);
    return ai;
  }

  return null;
}
