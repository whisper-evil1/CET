/**
 * 听写判分的单元测试：判分是纯函数，错一个词不许影响后文，这是最容易回归的地方。
 * 跑法：npx tsx scripts/test-dictation-judge.ts
 */
import { judge, normalizeSentence } from "../src/components/arcade/dictation-game";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const t = "Students who ask questions in class tend to remember more.";

const exact = judge(t, t);
check("原句全对得 100%", exact.score === 1 && exact.matched === exact.total, `${exact.matched}/${exact.total}`);

const casePunct = judge(t, "students who ask questions in class tend to remember more");
check("大小写与句末标点不计分", casePunct.score === 1, `${Math.round(casePunct.score * 100)}%`);

const typo = judge(t, "Students who askk questions in class tend to remember more.");
check(
  "中间一个词拼错只扣一个词",
  typo.matched === 9 && typo.tokens.some((x) => x.state === "bad" && x.word === "ask"),
  `${typo.matched}/${typo.total}`,
);

const missing = judge(t, "Students who questions in class tend to remember more.");
check(
  "漏写一个词记为 miss",
  missing.matched === 9 && missing.tokens.some((x) => x.state === "miss" && x.word === "ask"),
  `${missing.matched}/${missing.total}`,
);

const extra = judge(t, "Students who ask questions today in class tend to remember more.");
check(
  "多写一个词记为 extra 且不扣正确词",
  extra.matched === 10 && extra.tokens.some((x) => x.state === "extra" && x.word === "today"),
  `${extra.matched}/${extra.total}`,
);

const empty = judge(t, "");
check("全空得 0%", empty.score === 0 && empty.matched === 0);

const half = judge("the library stays open until midnight", "the library stays open");
check("只写一半得一半分", Math.round(half.score * 100) === 67, `${half.matched}/${half.total}`);

check("标点归一化", normalizeSentence("Hello, world! It's fine.") === "hello world its fine");

console.log(failed === 0 ? "\n判分单测：全部通过" : `\n判分单测：${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
