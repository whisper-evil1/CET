"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { matchRegexOf } from "@/lib/word-match";

/**
 * 真题再现卡：显示一个词在本站真题题库里的出现频次与原句出处。
 *
 * 两个形态：
 * - compact：一行频次摘要（刷词卡常驻；只给次数/占比/词频排名，不给例句，
 *   免得「先判认不认识」的环节被句子内容泄义）
 * - full：完整卡（真题例句 + 出处），在释义已经可见的地方出现。
 *
 * 证据走 /api/vocab/word-exam，模块级缓存 + 预取：刷词一轮 6 个词开局就预取，
 * 换卡时同步命中缓存，不会在揭晓的一瞬间还在转圈。
 */

export type ExamExample = {
  en: string;
  level: string;
  year: number | null;
  month: number | null;
  setNo: number | null;
  section: string;
  cite: string;
};

export type ExamEvidence = {
  total: number;
  listening: number;
  written: number;
  paperCount: number;
  yearMin: number | null;
  yearMax: number | null;
  corpusPapers: number;
  examples: ExamExample[];
};

const cache = new Map<string, ExamEvidence | null>();

async function fetchEvidence(rawWord: string): Promise<ExamEvidence | null> {
  const key = rawWord.trim().toLowerCase();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const data = await apiFetch<{ evidence: ExamEvidence | null }>(
      `/api/vocab/word-exam?word=${encodeURIComponent(key)}`,
    );
    const evidence = data?.evidence ?? null;
    cache.set(key, evidence);
    return evidence;
  } catch {
    /* 失败不写缓存：下张卡回来还能再试 */
    return null;
  }
}

/** 开局预取：把这一轮要见的词一次取回来（失败静默，组件挂载时会兜底再取） */
export function prefetchExamEvidence(words: string[]) {
  for (const word of words) {
    const key = word.trim().toLowerCase();
    if (key && !cache.has(key)) void fetchEvidence(key);
  }
}

/** 例句里把命中的词形高亮 */
function highlight(en: string, word: string): ReactNode[] {
  const re = matchRegexOf(word);
  if (!re) return [en];
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(en)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (m.index > last) parts.push(en.slice(last, m.index));
    parts.push(
      <mark key={`h${k++}`} className="rounded-[3px] bg-mark px-[1px] text-ink">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < en.length) parts.push(en.slice(last));
  return parts;
}

function statsLine(e: ExamEvidence): { headline: string; detail: string } {
  const listenPct = e.total > 0 ? Math.round((e.listening / e.total) * 100) : 0;
  const span = e.yearMin && e.yearMax && e.yearMin !== e.yearMax ? `${e.yearMin}–${e.yearMax}` : e.yearMin ? `${e.yearMin}` : "";
  const headline =
    e.total > 0
      ? `${span ? `${span} 年真题` : "本站真题"}出现 ${e.total} 句次`
      : "题库暂未收录该词";
  const detail = e.total > 0 ? `分布在 ${e.paperCount} 套卷 · ${listenPct}% 在听力` : "";
  return { headline, detail };
}

export function ExamEvidence({
  word,
  rank,
  variant = "full",
}: {
  word: string;
  /** COCA/BNC 综合词频排名（词书数据），没有就不显示 */
  rank?: number | null;
  variant?: "compact" | "full";
}) {
  const [evidence, setEvidence] = useState<ExamEvidence | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setEvidence(null);
    const cached = cache.get(word.trim().toLowerCase());
    if (cached !== undefined) {
      setEvidence(cached);
      setReady(true);
      return () => {
        alive = false;
      };
    }
    void fetchEvidence(word).then((e) => {
      if (!alive) return;
      setEvidence(e);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [word]);

  if (!ready) {
    return variant === "compact" ? (
      <p className="mt-1 text-[12.5px] text-ink-mute">真题检索中…</p>
    ) : (
      <div className="rounded-[12px] border border-line-soft bg-paper-deep px-4 py-3 text-[11.5px] text-ink-mute">
        真题检索中…
      </div>
    );
  }

  const { headline, detail } = evidence
    ? statsLine(evidence)
    : { headline: "题库暂未收录该词真题例句", detail: "" };

  if (variant === "compact") {
    if (!evidence && !rank) return null;
    return (
      <p className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-mute">
        <span className="mr-1.5 rounded-full bg-accent-soft px-2 py-[3px] text-[11px] font-medium text-accent">
          真题再现
        </span>
        {evidence ? (
          <>
            {headline}
            {detail ? ` · ${detail}` : ""}
          </>
        ) : (
          "题库暂无该词"
        )}
        {rank ? <span className="ml-1 font-mono">· 词频 #{rank}</span> : null}
      </p>
    );
  }

  return (
    <div className="rounded-[12px] border border-line bg-[#fdfaf3] px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full bg-accent px-2.5 py-[3px] text-[10.5px] font-medium tracking-[0.08em] text-white">
          真题再现
        </span>
        <p className="text-[12px] text-ink-soft">
          {headline}
          {detail ? `，${detail}` : ""}
        </p>
        {rank ? (
          <span className="ml-auto rounded-full bg-paper-deep px-2 py-[2px] font-mono text-[10.5px] text-ink-mute">
            COCA/BNC 词频 #{rank}
          </span>
        ) : null}
      </div>

      {evidence && evidence.examples.length > 0 ? (
        <ul className="mt-3 space-y-2.5">
          {evidence.examples.map((ex, i) => (
            <li key={`${ex.cite}-${i}`} className="border-t border-line-soft pt-2.5 first:border-t-0 first:pt-0">
              <p className="font-serif text-[13px] leading-[1.8] text-ink">{highlight(ex.en, word)}</p>
              <p className="mt-1 text-[10.5px] text-accent">{ex.cite}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-[11.5px] leading-[1.7] text-ink-mute">
          本站 2021–2026 年真题里还没有这个词的原句命中，先记住释义即可。
        </p>
      )}
    </div>
  );
}
