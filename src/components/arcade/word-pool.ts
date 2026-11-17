"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * 配对四连的共用底座：取词、洗牌、释义收窄、答错回写。
 *
 * 四个游戏（词义消除 / 翻牌配对 / 拼写达人 / 听音辨词）的**玩法**完全不同，
 * 但「从哪拿词、怎么洗、释义显示多长、答错了写不写记忆曲线」是一样的。
 * 这一层收干净，四个组件里就只剩各自的规则，改一处不会漏三处。
 *
 * 取词走后端 /api/vocab/game-pool：生词本优先，不够用词书补。
 * 所以新用户（生词本为空）也能立刻开局 —— 参考站是靠内置 12 关题库做到的，
 * 这里等价物就是词书兜底。
 */

export type PoolWord = {
  /** 生词本 id；词书兜底来的词为 null，答错不写记忆曲线 */
  id: string | null;
  word: string;
  phonetic: string | null;
  definition: string;
  pos: string;
  rank: number | null;
  from: "own" | "book";
};

export const MAX_HEARTS = 3;

/** 洗牌：Fisher-Yates，原地改副本 */
export function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 随机取 n 个不重复元素 */
export function sample<T>(list: T[], n: number): T[] {
  return shuffle(list).slice(0, n);
}

/**
 * 只取第一条（最常用的）释义，不做截断。
 *
 * 打地鼠、贪吃蛇、保卫战这类游戏里，释义是「靶子」而不是牌面：
 * 顶部一行「敲中释义为『政府』的地鼠」，要的是一个**短而准**的词义，
 * 两个义项拼一起反而让玩家在 1.5 秒里抓不住重点。
 */
export function firstSense(word: PoolWord): string {
  const raw = (word.definition || "").replace(POS_PREFIX, "");
  for (const part of raw.split(/[,，;；、]/)) {
    const clean = tidy(part.replace(/\[[^\]]{1,6}\]/g, "").replace(POS_PREFIX, ""));
    if (clean.length >= 2) return clean;
  }
  return tidy(raw) || word.definition || "（释义待补）";
}

/* ---------------- 最佳纪录 ----------------
   参考站把各游戏的最高分放在 localStorage（gscores），这里沿用同一思路：
   最佳纪录是纯本地荣誉，不进数据库 —— 排行榜另有正经数据（生词量、正确率），
   把游戏分数混进去只会污染它的口径。
   Safari 隐私模式下 localStorage 会直接抛错，所有读写都包住。 */

const BEST_KEY = "cet:arcade-best";

type BestMap = Record<string, number>;

function readBest(): BestMap {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as BestMap) : {};
  } catch {
    return {};
  }
}

/** 读某游戏的最佳纪录；没有过记录返回 0 */
export function getBest(game: string): number {
  if (typeof window === "undefined") return 0;
  return readBest()[game] ?? 0;
}

/** 写入更高分。返回 true 表示刷新了纪录 */
export function saveBest(game: string, score: number): boolean {
  if (typeof window === "undefined" || score <= 0) return false;
  try {
    const all = readBest();
    if (score <= (all[game] ?? 0)) return false;
    all[game] = score;
    window.localStorage.setItem(BEST_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** 读写一个本地进度值（消消乐的关卡解锁数用）；非法/越界值按 0 处理 */
export function localProgress(key: string): number {
  try {
    const value = Number(window.localStorage.getItem(`cet:${key}`));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function saveLocalProgress(key: string, value: number): void {
  try {
    window.localStorage.setItem(`cet:${key}`, String(Math.max(0, Math.floor(value))));
  } catch {
    /* 隐私模式下写不进去就算了：进度只是体验优化，不是数据资产 */
  }
}

/**
 * 取 n 个「牌面互不撞车」的词。
 *
 * 为什么不能直接 sample：词库里存在释义完全相同的词（toward / towards 都是
 * 「向，对于」）。配对游戏里如果这两张中文牌同时在场上，玩家会看到两张一模一样
 * 的牌，而只有点中「自己那一张」才算对 —— 从玩家角度看就是「明明一样却不让我配」。
 * 所以按牌面文案去重，撞了就换一个词。
 */
export function pickDistinct(
  pool: PoolWord[],
  n: number,
  keyOf: (word: PoolWord) => string,
): PoolWord[] {
  const seenKeys = new Set<string>();
  const seenWords = new Set<string>();
  const out: PoolWord[] = [];

  for (const item of shuffle(pool)) {
    const key = keyOf(item);
    const lower = item.word.trim().toLowerCase();
    if (!key || seenKeys.has(key) || seenWords.has(lower)) continue;
    seenKeys.add(key);
    seenWords.add(lower);
    out.push(item);
    if (out.length >= n) break;
  }
  return out;
}

/** 释义里混进来的词性前缀（"a. 早先的" / "vt. 减少"），牌面上不需要 */
const POS_PREFIX = /^(a|ad|adj|adv|n|v|vt|vi|prep|pron|conj|art|num|int|aux)\.\s*/i;

/**
 * 收尾清理：去掉未闭合的括号和尾部标点。
 *
 * 离线词库常有「前面的（previous）」这种带英文原词的补充说明，
 * 截断后就成了「前面的（prev」——半个括号挂在牌面上很难看，也很难读。
 * 这里把没配上的括号整段砍掉，再收掉尾巴上的逗号句号。
 */
function tidy(text: string): string {
  let out = text;
  for (let i = 0; i < 4; i++) {
    const open = Math.max(out.lastIndexOf("（"), out.lastIndexOf("("));
    const close = Math.max(out.lastIndexOf("）"), out.lastIndexOf(")"));
    if (open > close) out = out.slice(0, open);
    else break;
  }
  return out.replace(/[\s,，、;；.。:~]+$/, "").trim();
}

/**
 * 释义收窄到「一眼能扫完」的长度。
 *
 * 离线词库的释义常常一整行，country 甚至会带出「[计] DOS外部命令:用于设定国家代码…」
 * 这种跟四六级无关的义项。配对游戏里 16 个格子各三四行，牌面立刻变成长文，
 * 玩家没法在 90 秒里扫完。所以：
 *   1. 去掉 [经][计][医] 这类领域标记和 a./vt. 这类词性前缀；
 *   2. 按逗号/分号切开，最多留 2 个义项；
 *   3. 超长按整字截断，并砍掉截断处半个括号。
 * 所有牌面走同一套规则（正确项也一样），不影响公平，只是更好读。
 */
export function shortDef(word: { definition?: string }, maxLen = 22): string {
  const raw = (word.definition || "").replace(POS_PREFIX, "");
  const senses: string[] = [];
  for (const part of raw.split(/[,，;；、]/)) {
    const clean = tidy(part.replace(/\[[^\]]{1,6}\]/g, "").replace(POS_PREFIX, ""));
    // 单字义项多半是「放置, 产」这种把长义项切碎的结果（原词条其实是「产卵」被
    // 逗号拆开），留在牌面上读着别扭，还容易和别的词撞；有得选时优先跳过。
    if (!clean || clean.length < 2 || senses.includes(clean)) continue;
    senses.push(clean);
    if (senses.length >= 2) break;
  }

  const text = senses.join("，") || tidy(raw) || "（释义待补）";
  if (text.length <= maxLen) return text;
  const cut = tidy(text.slice(0, maxLen));
  return `${cut || text.slice(0, maxLen)}…`;
}

/** 拼写提示：首字母 + 空格 + 末字母，中间留破折号。长度按原始词形算，别把连字符也算成一个字母 */
export function spellHint(word: string): string {
  const w = word.trim();
  if (w.length <= 2) return w;
  const gap = "_".repeat(Math.max(1, w.length - 2)).split("").join(" ");
  return `${w[0]} ${gap} ${w[w.length - 1]}`;
}

export function starsFor(accuracy: number): number {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  if (accuracy >= 50) return 1;
  return 0;
}

/**
 * 答完一题写回记忆曲线。
 *
 * 只有生词本里的词有 id：词书兜底来的词没进过生词本，谈不上「复习」，
 * 硬写会凭空给它建一条记录，等于偷偷帮用户收藏了词 —— 所以直接跳过。
 * 写回失败不影响本局，下一次进生词本仍按原计划。
 */
export function reviewPoolWord(item: PoolWord | null | undefined, grade: "good" | "again"): void {
  if (!item?.id) return;
  void apiFetch(`/api/vocab/${item.id}/review`, {
    method: "POST",
    body: JSON.stringify({ grade }),
  }).catch(() => {
    /* 忽略：游戏不因落库失败中断 */
  });
}

type PoolPhase = "loading" | "error" | "ready";

export type WordPoolState = {
  phase: PoolPhase;
  items: PoolWord[];
  /** 来自生词本的条数，用来在页面上说明「这几题是你的词」 */
  ownCount: number;
  error: string;
  reload: () => void;
};

/**
 * 拉取词池。size 默认 40：四个游戏最多需要 16 个词面 + 每组 3 个干扰项，
 * 40 个词足够在「不重复出牌」和「干扰项不撞车」之间留出余量。
 */
export function useWordPool(size = 40, level: "cet4" | "cet6" = "cet4"): WordPoolState {
  const [phase, setPhase] = useState<PoolPhase>("loading");
  const [items, setItems] = useState<PoolWord[]>([]);
  const [ownCount, setOwnCount] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    setError("");
    try {
      const data = await apiFetch<{ items: PoolWord[]; ownCount: number; enough: boolean }>(
        `/api/vocab/game-pool?size=${size}&level=${level}`,
      );
      setItems(data.items ?? []);
      setOwnCount(data.ownCount ?? 0);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "词库加载失败");
      setPhase("error");
    }
  }, [size, level]);

  useEffect(() => {
    void load();
  }, [load]);

  return { phase, items, ownCount, error, reload: () => void load() };
}
