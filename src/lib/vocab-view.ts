import type { VocabWord } from "@prisma/client";
import { parseDefinitions } from "./db-mappers";
import { computePriority, describeDue } from "./vocab-srs";
import type { VocabItem } from "./types";

/**
 * 数据库行 → 前端词条。
 *
 * 优先级与到期状态一律现算，不读库里的 priority 快照：
 * 时间在走，昨天存下的分数今天就不准了。快照列只用于「按优先级粗排」这种场景。
 */
export function toVocabItem(row: VocabWord, now = Date.now()): VocabItem {
  const due = describeDue(row.dueAt, row.reviewCount, now);
  const hasContext = Boolean(row.sourceContext && row.sourceContext.trim());
  const breakdown = computePriority({
    word: row.word,
    examRank: row.examRank,
    examTags: row.examTags,
    source: row.source,
    hasContext,
    status: row.status,
    reviewCount: row.reviewCount,
    correctStreak: row.correctStreak,
    lapses: row.lapses,
    intervalDays: row.intervalDays,
    dueAt: row.dueAt,
    now,
  });

  return {
    id: row.id,
    word: row.word,
    phonetic: row.phonetic,
    definitions: parseDefinitions(row.definitions),
    example: row.example,
    exampleZh: row.exampleZh,
    sourceContext: row.sourceContext,
    reviewCount: row.reviewCount,
    status: row.status === "mastered" ? "mastered" : "learning",
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    dueLabel: due.label,
    overdue: due.overdue,
    intervalDays: row.intervalDays,
    ease: row.ease,
    lapses: row.lapses,
    priority: breakdown.score,
    reason: breakdown.reason,
    examRank: row.examRank,
    examTags: row.examTags,
    source: row.source === "wordbook" ? "wordbook" : row.source === "import" ? "import" : "lookup",
    wordbookId: row.wordbookId,
  };
}

/** 入库时补齐考纲标签与词频排名——优先级算法的两个输入项，缺了就只能吃默认值 */
export function metaFor(word: string, offlineTags?: string[] | null, rank?: number | null) {
  return {
    examTags: offlineTags && offlineTags.length > 0 ? offlineTags.join(",") : null,
    examRank: typeof rank === "number" && rank > 0 ? rank : null,
  };
}
