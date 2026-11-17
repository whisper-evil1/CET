#!/usr/bin/env node
/**
 * 中文加粗渲染的回归测试。
 *
 * 用 react-markdown 内部同一个解析器（mdast-util-from-markdown）验证：
 *   - 修复前：`**书法（calligraphy）**的` 解析不出 strong 节点，星号原样显示
 *   - 修复后：经过 prepareMarkdown，能解析出 strong
 *
 * 用法：node scripts/test-markdown-cjk.mjs
 */
import { fromMarkdown } from "mdast-util-from-markdown";

const raw = await import("../.build/md/markdown.js").catch(() => null);
if (!raw) {
  console.error("缺少 .build/md/markdown.js，先跑：npx tsc src/lib/markdown.ts --target es2020 --module es2020 --outDir .build/md --skipLibCheck");
  process.exit(2);
}
const { prepareMarkdown } = raw;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? `  ⟶  ${detail}` : ""}`);
};

/** 收集所有 strong 节点的文本 */
function strongTexts(md) {
  const found = [];
  const walk = (node) => {
    if (node.type === "strong") {
      found.push(
        (node.children ?? [])
          .map((c) => c.value ?? (c.children ?? []).map((x) => x.value ?? "").join(""))
          .join(""),
      );
      return;
    }
    for (const c of node.children ?? []) walk(c);
  };
  walk(fromMarkdown(md));
  return found;
}

/** 文本里还残留多少星号（不该有） */
function literalStars(md) {
  return (md.match(/\*\*/g) ?? []).length;
}

/* ---------- 用例 ---------- */
const cases = [
  {
    name: "全角括号 + 后接汉字（截图里的失败形态）",
    input: "本题原文是关于**书法（calligraphy）**的。",
    expect: "书法（calligraphy）",
  },
  {
    name: "纯中文加粗",
    input: "**字数严重不足**：只有 55 词。",
    expect: "字数严重不足",
  },
  {
    name: "中文加粗后接全角冒号",
    input: "**总评**：属于中高分段。",
    expect: "总评",
  },
  {
    name: "英文加粗（不应被改坏）",
    input: "consider **however** instead.",
    expect: "however",
  },
  {
    name: "中文加粗内含英文",
    input: "用了**连接词 however** 之后。",
    expect: "连接词 however",
  },
  {
    name: "多处加粗",
    input: "**第一点**很重要，**第二点**也重要。",
    expect: "第一点",
  },
];

/* ---------- 先证明缺陷确实存在（否则后面的修复没有意义） ---------- */
const BROKEN = "本题原文是关于**书法（calligraphy）**的。";
const brokenStrong = strongTexts(BROKEN);
check(
  "前提：未处理时该句确实解析不出加粗（复现原缺陷）",
  brokenStrong.length === 0,
  `strong=${brokenStrong.length}，字面星号 ${literalStars(BROKEN)} 个`,
);

for (const c of cases) {
  const after = strongTexts(prepareMarkdown(c.input));
  check(`${c.name}：修复后解析出加粗`, after.length > 0, `strong=${JSON.stringify(after)}`);
  check(
    `${c.name}：加粗内容正确`,
    after.some((t) => t.replace(/\u200b/g, "") === c.expect),
    JSON.stringify(after),
  );
}

/* ---------- 回归：本来合法的写法不能被「修」坏 ---------- */
// 闭合标记前是引号（标点）、后是全角逗号（标点）：满足 CommonMark 2b 分支，本来就合法。
// 上一版实现在闭标记后也补了零宽空格，把「后面是标点」变成「后面不是标点」，反而判失败。
const punctPair = '逗号是**中文标点"，"**，四六级考试会扣分。';
const punctOut = prepareMarkdown(punctPair);
check("闭标记前后都是标点时原样保留（不补零宽空格）", punctOut === punctPair, JSON.stringify(punctOut));
check("上述写法能解析出加粗", strongTexts(punctOut).length === 1, JSON.stringify(strongTexts(punctOut)));

// 开标记后面紧跟全角引号（标点）、前面是汉字：left-flanking 不成立，必须补。
const openQuote = "他说**「引号开头」**然后继续。";
const openOut = prepareMarkdown(openQuote);
check("开标记后紧跟全角引号时能解析出加粗", strongTexts(openOut).length === 1, JSON.stringify(strongTexts(openOut)));

/* ---------- 兜底：未成对的星号要被清掉 ---------- */
const dangling = "这里有**没闭合的加粗";
check(
  "未成对的 ** 会被清掉，不甩给用户",
  !prepareMarkdown(dangling).includes("**"),
  JSON.stringify(prepareMarkdown(dangling)),
);

/* ---------- 跨空行的「假成对」：全局偶数但每段奇数 ---------- */
const acrossBlank = "**开头有个加粗\n\n中间隔了空行\n\n结尾才闭合**";
const acrossOut = prepareMarkdown(acrossBlank);
check(
  "跨空行的假成对星号会被清掉（CommonMark 强调不跨空行）",
  !acrossOut.includes("**") && strongTexts(acrossOut).length === 0,
  JSON.stringify(acrossOut),
);

/* ---------- 各段独立成对：必须都保留 ---------- */
const perBlock = "第一段**加粗甲**结束\n\n第二段**加粗乙**结束";
const perOut = prepareMarkdown(perBlock);
const perStrong = strongTexts(perOut);
check(
  "各段分别成对的加粗都保留",
  perStrong.length === 2 && perOut.includes("**"),
  JSON.stringify(perStrong),
);

/* ---------- 不能引入可见字符 ---------- */
const sample = "本题原文是关于**书法（calligraphy）**的。";
const prepared = prepareMarkdown(sample);
check(
  "只增加零宽字符，可见文本不变",
  prepared.replace(/\u200b/g, "") === sample,
  JSON.stringify(prepared),
);

/* ---------- 整体统计 ---------- */
const failed = results.filter((r) => !r.ok);
console.log(`\n合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
if (failed.length) {
  console.log("失败项：\n" + failed.map((f) => "  - " + f.name).join("\n"));
  process.exit(1);
}
