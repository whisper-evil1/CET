import { listOfflineEntries } from "./offline-dict";

/**
 * 近义干扰项：在没有同义词词典的前提下，从 1.5 万条离线词库里挑「最像」的释义。
 *
 * 为什么要这么绕：
 *   背单词的四选一如果干扰项随手抓别的词（「节目」旁边放「力量 / 社区 / 比率」），
 *   玩家靠排除法就能选对，考的不是词义。真正难的是「四个都像对」——
 *   减少 / 降低 / 缩减 / 削弱。这层就是用来凑出后一种选项的。
 *
 * 主信号是**连续子串**，不是「共享几个字」：
 *   「赔偿金」和「炼金术」只共享一个「金」，字形像、意思八竿子打不着，
 *   当干扰项只会让人想笑；而「赔偿金」和「损害赔偿」共享连在一起的「赔偿」，
 *   这才是真近义。所以先看最长公共子串，长度 ≥ 2 才算第一档。
 *
 * 子串凑不满时退到「同词尾」：中文复合词的表义字通常压在末尾
 *   （背**痛** / 牙**痛** / 头**痛**），末字相同基本同领域。
 *   只共享首字的（背痛 / 背景）不算 —— 这类凑出来的选项一眼假。
 *
 * 索引只在首次调用时建一次（约 1.5 万条），之后顺序扫一遍即可。
 */

/** 高频功能字：参与相似度只会制造噪声 */
const STOP_CHARS = new Set(
  "的了一是在不有和与及或等为以之其而就都也还又很更最把被对从到向于中上下个这那些么什怎样可以能会要需使让给说表人事物动作行为状态形容名动副介连数量代时候地得着过并将".split(
    "",
  ),
);

/** 反义前缀：这类义项和题面只差一个否定词，当干扰项是在考眼力 */
const ANTONYM_PREFIX = /^[不非无未没反难]/;

/** 释义里带否定字（哪怕在中间，「令人不快乐的」）就基本是反义 */
const NEGATION = /[不非无未没]/;

const POS_ALIAS: Record<string, string> = {
  n: "n",
  v: "v",
  vt: "v",
  vi: "v",
  a: "a",
  adj: "a",
  ad: "adv",
  adv: "adv",
  prep: "prep",
  conj: "conj",
  pron: "pron",
  num: "num",
};

export type SenseEntry = {
  word: string;
  sense: string;
  /** 去副词、去「的/地/得」后的词核，用来比词尾 */
  core: string;
  pos: string;
  chars: Set<string>;
  /** 全部义项（各自取首义），用于找连续子串 */
  senses: string[];
  /** 全部义项拼起来（截断） */
  text: string;
};

let index: SenseEntry[] | null = null;

function normalizePos(pos: string): string {
  const first = (pos || "").split(/[.,，、/]/)[0]?.trim().toLowerCase() ?? "";
  return POS_ALIAS[first] ?? first;
}

const POS_PREFIX = /^(a|ad|adj|adv|n|v|vt|vi|prep|pron|conj|art|num|int|aux|interj)\.\s*/i;

/** 释义的「词核」：去掉程度副词与「的/地/得」，只留真正表义的几个字 */
export function coreSense(sense: string): string {
  return (sense || "")
    .replace(/^[很太更最十分非常相当极]+/, "")
    .replace(/^[使让令把被给对将]+/, "")
    .replace(/[的地得了着过]+$/, "")
    .trim();
}

export function primarySense(zh: string): string {
  const strip = (text: string) =>
    text
      .replace(/\[[^\]]{1,8}\]/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[a-zA-Z]{2,}/g, "")
      // 开头残留的词性缩写与标点（"interj." ". " "vt." ）一律清掉，否则选项里会出现 ". 再会"
      .replace(POS_PREFIX, "")
      .replace(/^[^\u4e00-\u9fa5]+/, "")
      .trim();

  const raw = strip(zh || "");
  for (const part of raw.split(/[,，;；、]/)) {
    const clean = strip(part);
    if (clean.length >= 2) return clean;
  }
  return raw;
}

function senseChars(text: string): Set<string> {
  const out = new Set<string>();
  for (const ch of text) {
    if (/[\u4e00-\u9fa5]/.test(ch) && !STOP_CHARS.has(ch)) out.add(ch);
  }
  return out;
}

function buildIndex(): SenseEntry[] {
  if (index) return index;
  const list: SenseEntry[] = [];
  for (const [word, entry] of listOfflineEntries()) {
    const first = entry.definitions?.[0];
    if (!first?.zh) continue;
    const sense = primarySense(first.zh);
    // 带省略号的释义（「将…减到最少」）放进选项里像残缺数据，直接不进索引
    if (/[.．·]{2,}|…/.test(sense)) continue;
    const chars = senseChars(sense);
    if (sense.length < 2 || chars.size === 0) continue;
    const senses = (entry.definitions ?? [])
      .map((d) => primarySense(d.zh || ""))
      .filter((s) => s && !/[.．·]{2,}|…/.test(s));
    list.push({
      word,
      sense,
      core: coreSense(sense),
      pos: normalizePos(first.pos || ""),
      chars,
      senses,
      text: senses.join("；").slice(0, 80),
    });
  }
  index = list;
  return list;
}

/** 最长公共子串长度：中文近义最靠谱的字面信号 */
function commonRunLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : 0;
      if ((cur[j] ?? 0) > best) best = cur[j] ?? 0;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return best;
}

/** 把一条释义拆成所有义项：「vt. 减少，降低；缩小」→ 减少 / 降低 / 缩小 */
function splitSenses(zh: string): string[] {
  const out: string[] = [];
  for (const part of (zh || "").split(/[,，;；、]/)) {
    const clean = part
      .replace(/\[[^\]]{1,8}\]/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[a-zA-Z]{2,}/g, "")
      .replace(POS_PREFIX, "")
      .replace(/^[^\u4e00-\u9fa5]+/, "")
      .trim();
    // 带省略号的（「将…减到最少」）放进选项像残缺数据，直接不要
    if (clean.length >= 2 && !/[.．·]{2,}|…/.test(clean)) out.push(clean);
  }
  return out;
}

/**
 * 给一条释义找 n 个「近义」干扰项。
 *
 * 题面的**全部**义项都参与比对，不只看第一条：
 * 「vt. 减少，降低；缩小」如果只记「减少」，另一个词的「降低」就匹配不上，
 * 明明是真近义却被丢掉，最后只能退到同词性乱凑。
 *
 * @param definition 正确项的中文释义（原始整条即可，内部会拆义项再比）
 * @param pos 正确项词性（n / v / a / adv …），同词性是硬门，不同词性直接排除
 * @param exclude 需要排除的词（题面本身及其变形）
 */
export function pickNearSynonyms(
  definition: string,
  pos: string,
  exclude: string[] = [],
  count = 3,
): string[] {
  const targets = splitSenses(definition);
  if (!targets.length) return [];

  const targetCores = targets.map(coreSense).filter((core) => core.length > 0);
  if (!targetCores.length) return [];

  const targetChars = new Set<string>();
  for (const target of targets) for (const ch of senseChars(target)) targetChars.add(ch);
  if (targetChars.size === 0) return [];

  const targetPos = normalizePos(pos);
  const head = (targetCores[0] ?? "").slice(-1);
  const takesAntonym = targetCores.some((core) => ANTONYM_PREFIX.test(core));
  const banned = new Set(exclude.map((word) => word.trim().toLowerCase()));
  const taken = new Set<string>(targets);

  type Row = { sense: string; bucket: number; score: number };
  const rows: Row[] = [];

  for (const entry of buildIndex()) {
    if (banned.has(entry.word)) continue;
    // 词性不同基本不构成「近义」（important 是形容词，重音/重击是名词）
    if (targetPos && entry.pos && targetPos !== entry.pos) continue;

    let overlap = 0;
    for (const ch of entry.chars) if (targetChars.has(ch)) overlap += 1;
    if (overlap === 0) continue;

    // 在它的全部义项里找与「任一」目标义项的最长公共子串。
    // 命中的可能是第二条义项，那就把命中的那条当选项显示，
    // 否则选项和它自己的词对不上，看着像乱塞的。
    let run = 0;
    let shown = entry.sense;
    let candCore = entry.core;
    for (const sense of entry.senses) {
      const cand = coreSense(sense);
      if (!cand || cand.length > 8) continue;
      // 反义项靠一个「不 / 非 / 无」撑起来，考的是眼力不是词义
      if (NEGATION.test(cand) && !takesAntonym) continue;
      // 是目标释义的碎片（「快乐」对「快」），不是近义：这种选项一眼假
      if (targetCores.some((target) => target.length > cand.length && target.includes(cand))) continue;

      let local = 0;
      for (const target of targetCores) {
        const hit = commonRunLength(target, cand);
        if (hit > local) local = hit;
      }
      if (local > run) {
        run = local;
        shown = sense;
        candCore = cand;
      }
    }
    if (!candCore) continue;
    // 一条义项都没命中时 candCore 还是它的首义，这里再兜一次否定过滤，
    // 否则 unhappy 会以「不快乐的」混进「快乐」的选项里 —— 那是反义，不是近义
    if (NEGATION.test(candCore) && !takesAntonym) continue;

    let bucket: number;
    if (run >= 2) {
      bucket = 0;
    } else if (head && candCore.endsWith(head) && entry.pos && entry.pos === targetPos) {
      // 同词尾：周围环境 / 逆境 / 困境、厚颜无耻 / 羞耻 —— 中文词的表义字在末尾，
      // 末字相同基本同领域，这类选项真的会犹豫。同词性是硬条件，否则名词题会混进动词。
      bucket = 1;
    } else if (overlap >= 2) {
      bucket = 2;
    } else {
      // 凑不出像样的近义就少给几个，交给调用方用同词书的词补齐
      continue;
    }

    const lengthGap = Math.abs(candCore.length - (targetCores[0] ?? "").length);
    rows.push({
      sense: shown,
      bucket,
      score: run * 40 + overlap * 10 + (entry.pos && entry.pos === targetPos ? 10 : 0) - lengthGap * 4,
    });
  }

  rows.sort((a, b) => a.bucket - b.bucket || b.score - a.score || a.sense.length - b.sense.length);

  const out: string[] = [];
  for (const row of rows) {
    if (out.length >= count) break;
    if (taken.has(row.sense)) continue;
    taken.add(row.sense);
    out.push(row.sense);
  }
  return out;
}
