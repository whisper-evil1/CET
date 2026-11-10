/**
 * AI 输出的 Markdown 预处理。
 *
 * 为什么需要：CommonMark 的强调（emphasis）判定基于 delimiter run 的「左翼 / 右翼」规则，
 * 而这条规则对中文不友好。例如模型常写：
 *
 *     本题原文是关于**书法（calligraphy）**的。
 *
 * 闭合的 `**` 前面是全角括号「）」（Unicode 标点），后面是汉字「的」
 * （既不是空白也不是标点）。按规则它不构成 right-flanking run，于是无法闭合，
 * 整对星号就被当成普通字符原样显示——用户看到的就是裸露的 `**`。
 *
 * 解法：紧贴定界符补一个零宽空格（U+200B）。它属 Cf 类，既不算空白也不算标点，
 * 正好能把缺失的条件补齐。
 *
 * 但**补在哪一侧、要不要补，必须按开标记与闭标记各自的判定来**：
 *   - 开标记需要满足 left-flanking：后一个字符不是空白，且（不是标点，或前一个是空白/标点）
 *   - 闭标记需要满足 right-flanking：前一个字符不是空白，且（不是标点，或后一个是空白/标点）
 * 曾经的做法是「相邻是中文就两侧都补」，结果把本来合法的写法改坏：
 *   `**中文标点"，"**，` 的闭标记前是引号、后是全角逗号，本来满足 2b 分支，
 *   在闭标记后补了零宽空格后「后面不再是标点」，反而判定失败，星号照样露出来。
 * 所以这里先算出左右邻字符、判断该角色是否已合格，**只在不合格时**往内侧补。
 *
 * 代价：文本里会带上零宽字符（复制时可见为空），换来稳定渲染，可以接受。
 */

const ZWSP = "\u200b";

/** CommonMark 的「Unicode 标点」：Pc Pd Pe Pf Pi Po Ps（不含符号类 S） */
const PUNCT = /[\p{P}]/u;
const WS = /\s/;

const isPunct = (ch: string) => ch !== "" && PUNCT.test(ch);
const isWs = (ch: string) => ch === "" ? false : WS.test(ch);

/**
 * 修正中文语境下的加粗定界。
 * 按出现顺序配对：奇数个视为开标记，偶数个视为闭标记；多余的落单标记直接移除。
 */
export function normalizeCjkEmphasis(input: string): string {
  if (!input || !input.includes("**")) return input;

  let out = "";
  let open = false;
  /** 记录当前开标记在 out 中的位置，用于最后摘掉落单标记 */
  let openAt = -1;
  let i = 0;

  while (i < input.length) {
    if (input[i] === "*" && input[i + 1] === "*") {
      const prev = out.slice(-1); // 已输出内容的最后一个字符（可能含补进去的零宽空格）
      const next = input[i + 2] ?? "";

      if (!open) {
        // —— 开标记：需要 left-flanking ——
        const ok = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
        openAt = out.length;
        out += "**";
        if (!ok) out += ZWSP; // 往内侧补，使「后一个字符」变成零宽空格
        open = true;
      } else {
        // —— 闭标记：需要 right-flanking ——
        const ok = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
        if (!ok) out += ZWSP; // 往内侧补，使「前一个字符」变成零宽空格
        out += "**";
        open = false;
      }
      i += 2;
      continue;
    }
    out += input[i];
    i += 1;
  }

  // 落单的开标记：连标记带刚补的零宽空格一起摘掉，避免裸露
  if (open && openAt >= 0) {
    const tail = out.slice(openAt);
    const cut = tail.startsWith("**" + ZWSP) ? 4 : 2;
    out = out.slice(0, openAt) + out.slice(openAt + cut);
  }

  return out;
}

/**
 * 兜底：清掉「不可能被解析成加粗」的星号。
 *
 * CommonMark 的强调**不能跨空行**。所以不能只看全文字号总数是否为偶数——
 * 模型写「**开头……（空行）……结尾**」时全局是 4 个（偶数），但每一段各自只有 2 个且无法配对，
 * 结果两个空行前后的星号全被当字面量显示。
 *
 * 因此按空行切块，逐块检查：块内星号数为奇数说明这一段不可能配对，直接清掉该块的标记。
 * 同一个段落内跨单换行的加粗是合法的，会落在同一个块里，不受影响。
 */
export function stripDanglingEmphasis(input: string): string {
  if (!input || !input.includes("**")) return input;
  return input
    .split(/(\n[ \t]*\n)/)
    .map((block) => {
      if (!block.includes("**")) return block;
      const count = (block.match(/\*\*/g) ?? []).length;
      return count % 2 === 0 ? block : block.replace(/\*\*/g, "");
    })
    .join("");
}

/** 渲染前统一走一遍 */
export function prepareMarkdown(input: string): string {
  return stripDanglingEmphasis(normalizeCjkEmphasis(input));
}
