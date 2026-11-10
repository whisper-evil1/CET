/**
 * 选词填空词库化（纯函数，无副作用）。
 *
 * 四六级 Section A 是「一篇短文挖 10 个空 + 一个 A–O 十五词词库」，考生从同一个词库里
 * 给每个空挑词。正文 JSON 允许按「每空四选一」写（更好写，也不容易写错词性），
 * 由这里统一升级成词库形态：
 *
 *   1. 10 个空各自的正确词 = 词库里的 10 个必用词；
 *   2. 从各空原有干扰项里挑 5 个最常出现的词，补足 15 词；
 *   3. 15 个词按字母序编号 A–O（字母序避免「答案顺序即题号顺序」这种泄题规律）；
 *   4. 每道题的选项换成同一个词库，answer 按词重映射成新字母；
 *   5. 正文末尾补一段「词库」，用 label=词库，读原文时就能看到。
 *
 * 已经是词库形态的正文原样返回（幂等）。
 */

const BANK_SIZE = 15;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const text = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * @param {any} passage 选词填空篇章（会被就地修改）
 * @returns {{ok: boolean, changed: boolean, reason?: string, bank?: string[]}}
 */
export function normalizeBankedCloze(passage) {
  const questions = Array.isArray(passage?.questions) ? passage.questions : [];
  if (questions.length !== 10) return { ok: false, changed: false, reason: `题数 ${questions.length} ≠ 10` };

  const sigs = questions.map((q) => (q.options ?? []).map((o) => `${o.key}:${text(o.text)}`).join("|"));
  const uniform = sigs.every((s) => s === sigs[0]);
  const alreadyBank = uniform && (questions[0].options ?? []).length === BANK_SIZE;

  const answerWords = [];
  for (const q of questions) {
    const hit = (q.options ?? []).find((o) => o.key === q.answer);
    if (!hit) return { ok: false, changed: false, reason: `第 ${q.number} 题答案不在选项内` };
    answerWords.push(text(hit.text));
  }
  const uniqueAnswers = [...new Set(answerWords)];
  if (uniqueAnswers.length !== 10) {
    return { ok: false, changed: false, reason: `正确词去重后只剩 ${uniqueAnswers.length} 个` };
  }
  if (alreadyBank) return { ok: true, changed: false, reason: "已是词库形态" };

  // 干扰词按「出现在多少个空的选项里」排序，取前 5 个，尽量贴合词性语境
  const freq = new Map();
  for (const q of questions) {
    for (const o of q.options ?? []) {
      const word = text(o.text);
      if (!word || uniqueAnswers.includes(word)) continue;
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }
  const need = BANK_SIZE - uniqueAnswers.length;
  const distractors = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, need)
    .map(([w]) => w);
  if (distractors.length < need) return { ok: false, changed: false, reason: `干扰词不够（${distractors.length}/${need}）` };

  const bank = [...uniqueAnswers, ...distractors].sort((a, b) => a.localeCompare(b));
  const keyOf = new Map(bank.map((w, i) => [w, LETTERS[i]]));
  const options = bank.map((w, i) => ({ key: LETTERS[i], text: w }));

  for (const q of questions) {
    const word = text(q.options.find((o) => o.key === q.answer).text);
    q.answer = keyOf.get(word);
    q.options = options.map((o) => ({ ...o }));
  }

  const paragraphs = Array.isArray(passage.paragraphs) ? passage.paragraphs : [];
  if (!paragraphs.some((p) => p.label === "词库")) {
    paragraphs.push({ label: "词库", text: options.map((o) => `${o.key}) ${o.text}`).join("   ") });
    passage.paragraphs = paragraphs;
  }

  return { ok: true, changed: true, bank };
}
