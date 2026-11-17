/**
 * 长篇阅读匹配（Section B）选项归一化。
 *
 * 四级 Section B 的答题形态是「10 个陈述句 → 各自找一个段落字母」，
 * 正确项本质上是**段落字母**，不是「第几个选项」。
 *
 * 但正文 JSON 为了好写，把选项存成了 `A) Paragraph C / B) Paragraph A …` 这种
 * 打乱顺序的占位：answer 记的是**选项键**（B），真正的段落是选项文本里的 C。
 * 于是用户在界面上点段落字母 C，提交上来的是 "C"，和库里的 "B" 一比就判错 ——
 * 这是「段落匹配答不起」的根因。
 *
 * 这里统一改成「选项键 = 段落字母」：
 *   - options 重写成 A–H 全段落，文本固定 `Paragraph X`；
 *   - answer 直接记段落字母；优先取 evidencePara（写作时标注的证据段），
 *     它比被打乱的选项键可靠；只有 evidencePara 缺失/越界时才回退到选项文本。
 *
 * 幂等：已经是「键 = 文本字母」形态的篇章原样返回。
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const text = (v) => (typeof v === "string" ? v.trim() : "");
const PARAGRAPH_TEXT = /^paragraph\s+([A-Z])$/i;

function isMatchingPassage(passage) {
  const title = text(passage?.title);
  if (/匹配|matching/i.test(title)) return true;
  const first = passage?.questions?.[0];
  return (first?.options ?? []).every((o) => PARAGRAPH_TEXT.test(text(o.text)));
}

function paragraphLetters(passage) {
  const labels = (passage.paragraphs ?? [])
    .map((p) => text(p.label))
    .filter((l) => /^[A-Z]$/.test(l));
  return [...new Set(labels)].sort();
}

/**
 * @param {any} passage 匹配篇章（会被就地修改）
 * @returns {{ok: boolean, changed: boolean, reason?: string}}
 */
export function normalizeMatching(passage) {
  if (!passage || !isMatchingPassage(passage)) return { ok: true, changed: false, reason: "非匹配题" };
  const questions = Array.isArray(passage.questions) ? passage.questions : [];
  if (!questions.length) return { ok: false, changed: false, reason: "没有题目" };

  const letters = paragraphLetters(passage);
  if (letters.length < 4) return { ok: false, changed: false, reason: `段落字母不足（${letters.join("") || "空"}）` };

  const options = letters.map((letter) => ({ key: letter, text: `Paragraph ${letter}` }));
  let changed = false;

  for (const q of questions) {
    const chosen = (q.options ?? []).find((o) => o.key === q.answer);
    const fromOption = PARAGRAPH_TEXT.exec(text(chosen?.text))?.[1]?.toUpperCase() ?? "";
    const evidence = text(q.evidencePara).toUpperCase();
    // 证据段可信度更高：选项键是打乱后的位置，evidencePara 是作者标注的真实段落
    const target = letters.includes(evidence) ? evidence : fromOption;
    if (!letters.includes(target)) {
      return { ok: false, changed: false, reason: `第 ${q.number} 题找不到段落（answer=${q.answer} evidence=${evidence}）` };
    }
    if (q.answer !== target) changed = true;
    q.answer = target;
    q.options = options.map((o) => ({ ...o }));
  }

  return { ok: true, changed, reason: changed ? "已改成段落字母" : "已是段落字母形态" };
}
