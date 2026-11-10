import { prisma } from "@/lib/prisma";
import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { takeWordbook } from "@/lib/wordbook";
import type { Definition } from "@/lib/types";

/**
 * GET /api/vocab/game-pool?size=40&level=cet4
 *
 * 配对四连（词义消除 / 翻牌配对 / 拼写达人 / 听音辨词）共用的取词口。
 *
 * 为什么要单独开一个接口，而不是复用心 /api/vocab/queue：
 *   1. queue 只给「现在最该背的词」，新用户生词本是空的，返回 0 条 —— 游戏直接开不了局。
 *      这里做兜底：生词本不够就从词书（四级/六级高频）里补，保证任何时候都有 40 个词可玩。
 *   2. queue 按记忆曲线排序，游戏不需要这个顺序，它需要的是「一把能打乱的词」。
 *   3. queue 给的是完整 VocabItem（含 dueAt、ease 等一堆前端用不到的字段），
 *      四个游戏只用得到 word / phonetic / 一条短释义，返小对象省流量。
 *
 * 返回里带 id 的词（来自生词本）答错时会回写 /api/vocab/:id/review，
 * 词书兜底来的词 id 为 null，只参与游戏、不写记忆曲线 —— 没进生词本的词谈不上复习。
 */

const PLACEHOLDER_DEF = /测试词|占位|待补|TODO|lorem ipsum|test word|dummy/i;

type PoolWord = {
  /** 生词本里的 id；词书兜底来的词为 null */
  id: string | null;
  word: string;
  phonetic: string | null;
  /** 第一条释义的中文，已去掉 [经][计] 这类领域标记 */
  definition: string;
  pos: string;
  /** 词频排名，越小越高频；词书兜底时用来做难度参考 */
  rank: number | null;
  from: "own" | "book";
};

/** 一条释义够不够当题面：太短、带占位字样、或者根本不是中文，都不要 */
function cleanDefinition(defs: Definition[] | undefined): { definition: string; pos: string } | null {
  const first = defs?.[0];
  if (!first) return null;
  const zh = (first.zh || "").replace(/\[[^\]]{1,6}\]/g, "").trim();
  if (!zh || PLACEHOLDER_DEF.test(zh) || zh.length < 2) return null;
  return { definition: zh, pos: (first.pos || "").trim() };
}

/** 词形是否像真词（和闯关页 isPlayable 同一套判定，放宽处理宁可漏判） */
function playableWord(word: string): boolean {
  const w = word.trim();
  if (!/^[a-z][a-z'’\- ]*$/i.test(w)) return false;
  if (/([a-z])\1{2,}/i.test(w)) return false;
  return w.replace(/[\s'’\-]/g, "").length <= 24;
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const GET = withApi(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const sizeRaw = Number(params.get("size"));
  const size = Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.min(60, Math.max(8, Math.floor(sizeRaw))) : 40;
  const bookId = params.get("level") === "cet6" ? "cet6-core" : "cet4-core";

  const meId = await currentUserId();

  const own: PoolWord[] = [];
  if (meId) {
    const rows = await prisma.vocabWord.findMany({
      where: { userId: meId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 240,
    });
    const seen = new Set<string>();
    for (const row of rows) {
      const word = row.word.trim();
      const lower = word.toLowerCase();
      if (seen.has(lower) || !playableWord(word)) continue;
      let defs: Definition[] = [];
      try {
        defs = JSON.parse(row.definitions) as Definition[];
      } catch {
        defs = [];
      }
      const cleaned = cleanDefinition(defs);
      if (!cleaned) continue;
      seen.add(lower);
      own.push({
        id: row.id,
        word,
        phonetic: row.phonetic,
        definition: cleaned.definition,
        pos: cleaned.pos,
        rank: row.examRank,
        from: "own",
      });
      if (own.length >= size * 2) break;
    }
  }

  // 不够就从词书补。补的时候避开生词本里已有的词，免得同一个词出现两次
  const pool = shuffle(own).slice(0, size);
  if (pool.length < size) {
    const taken = new Set(pool.map((p) => p.word.toLowerCase()));
    for (const entry of shuffle(takeWordbook(bookId, 500))) {
      if (pool.length >= size) break;
      const lower = entry.word.toLowerCase();
      if (taken.has(lower) || !playableWord(entry.word)) continue;
      const cleaned = cleanDefinition(entry.definitions);
      if (!cleaned) continue;
      taken.add(lower);
      pool.push({
        id: null,
        word: entry.word,
        phonetic: entry.phonetic,
        definition: cleaned.definition,
        pos: cleaned.pos,
        rank: entry.rank,
        from: "book",
      });
    }
  }

  return ok({
    items: shuffle(pool),
    ownCount: own.length,
    bookId,
    /** 词池总量不足以开局时（词书文件缺失才会发生），前端据此提示 */
    enough: pool.length >= 8,
  });
});
