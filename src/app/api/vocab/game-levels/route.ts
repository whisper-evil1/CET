import { prisma } from "@/lib/prisma";
import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { takeWordbook } from "@/lib/wordbook";
import type { Definition } from "@/lib/types";

/**
 * GET /api/vocab/game-levels?level=cet4
 *
 * 单词消消乐（12 关）的分级词库。移植自参考站的 buildExamLevels：
 * 从语料词里筛掉太容易的，按「词长 + 词频」估难度，切成 12 关 × 10 词，
 * 越往后越生僻。本站的等价物是词书（cet4-core / cet6-core，按 COCA/BNC
 * 词频 rank 排好序），难度分用「词长 + rank 归一化」替代原来的语料词频 ——
 * 词书本身就有 rank，不需要再扫一遍卷库语料。
 *
 * 和 game-pool 的分工：game-pool 服务「随手一局」的随机词，
 * 这里服务**固定分级**的关卡 —— 同一关的词必须稳定，不然「第 3 关没过」
 * 对玩家来说没有意义。所以不掺随机、不掺生词本（生词本只有几十个词，
 * 撑不起 120 词的固定梯度，掺进去还会让关卡内容随用户状态漂移）。
 */

const LEVEL_NAMES = [
  "高频入门",
  "基础热身",
  "稳步提升",
  "渐入佳境",
  "小有挑战",
  "稳步进阶",
  "难度上升",
  "高手试炼",
  "强者对决",
  "精英关卡",
  "大师挑战",
  "词霸巅峰",
];

/** 功能词/超高频词：出现在关卡里只会浪费一格（参考站同款排除表，词形略有增补） */
const EASY_WORDS = new Set(
  ("the a an and or but if of to in on at for with from by as is are was were be been being it its this that these those " +
    "he she they them his her their we you your i not no do does did have has had can could will would should may might " +
    "must more most such other than then there here what which when where who how all any both each few many some own " +
    "same so too very just also about into over after before between during through out up down off again only")
    .split(" "),
);

const PLACEHOLDER_DEF = /测试词|占位|待补|TODO|lorem ipsum|test word|dummy/i;

type LevelWord = {
  word: string;
  phonetic: string | null;
  definition: string;
  pos: string;
};

function firstDef(defs: Definition[] | undefined): { definition: string; pos: string } | null {
  const first = defs?.[0];
  if (!first) return null;
  const zh = (first.zh || "").replace(/\[[^\]]{1,6}\]/g, "").trim();
  if (!zh || PLACEHOLDER_DEF.test(zh) || zh.length < 2) return null;
  return { definition: zh, pos: (first.pos || "").trim() };
}

export const GET = withApi(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const bookId = params.get("level") === "cet6" ? "cet6-core" : "cet4-core";
  const meId = await currentUserId();

  // 已导入进生词本的词做标记（仅提示「这关里有你背过的词」，不影响分级）
  const mineWords = new Set<string>();
  if (meId) {
    const rows = await prisma.vocabWord.findMany({
      where: { userId: meId },
      select: { word: true },
    });
    for (const row of rows) mineWords.add(row.word.trim().toLowerCase());
  }

  const entries = takeWordbook(bookId, 1500);
  const seen = new Set<string>();
  const candidates: { word: LevelWord; diff: number }[] = [];

  for (const entry of entries) {
    const word = entry.word.trim();
    const lower = word.toLowerCase();
    if (seen.has(lower) || word.length < 4 || EASY_WORDS.has(lower)) continue;
    const cleaned = firstDef(entry.definitions);
    if (!cleaned) continue;
    seen.add(lower);
    // 难度 ≈ 词长 + 生僻度。rank 越大越生僻，/60 把 1~1500 压到 0~25 分量级
    const diff = word.length + Math.min(25, entry.rank / 60);
    candidates.push({
      word: {
        word,
        phonetic: entry.phonetic,
        definition: cleaned.definition,
        pos: cleaned.pos,
      },
      diff,
    });
  }

  candidates.sort((a, b) => a.diff - b.diff);

  const levels = LEVEL_NAMES.map((name, index) => {
    const slice = candidates.slice(index * 10, index * 10 + 10);
    return {
      level: index + 1,
      name,
      count: slice.length,
      words: slice.map(({ word }) => ({
        ...word,
        mine: mineWords.has(word.word.toLowerCase()),
      })),
    };
  }).filter((level) => level.count === 10);

  return ok({
    bookId,
    levels,
    enough: levels.length === 12,
  });
});
