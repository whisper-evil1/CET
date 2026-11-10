/**
 * 清理词库里的假词 / 占位词。
 *
 * 背景：`e2e-vocab-import.mjs` 会往 user-demo 写入形如 `zzzzipitrddjka` 的测试词，
 * 释义写成「测试词一/二/三」。脚本末尾虽有清理，但如果中途断言抛错就跳过了清理，
 * 于是这些词留在了演示账号里 —— 用户进闯关页，题面和三个干扰项全是测试词。
 *
 * 这个脚本只做两件事：找出「占位释义」或「词形不像词」的条目，按需删除。
 * 默认 dry-run，只有带 --apply 才真的删。
 *
 * 用法：
 *   node scripts/clean-junk-vocab.mjs            # 只列出
 *   node scripts/clean-junk-vocab.mjs --apply    # 执行删除
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** 占位/测试释义：出现这些字样的一定不是真实释义 */
const PLACEHOLDER = /测试词|占位|待补|TODO|lorem ipsum|test word|dummy/i;

/**
 * 词形检查 —— 只在明显不像词时才判脏，宁可漏判也不误删：
 *   1. 只允许字母，可带空格 / 连字符 / 撇号（短语如 take into account 要留下）
 *   2. 连续 3 个相同字母（zzzz）不是英语词
 *   3. 去掉空格后超过 24 个字母基本是乱敲
 */
function looksFake(word) {
  const w = (word || "").trim();
  if (!w) return true;
  if (!/^[a-z][a-z'’\- ]*$/i.test(w)) return true;
  if (/([a-z])\1{2,}/i.test(w)) return true;
  if (w.replace(/[\s'’\-]/g, "").length > 24) return true;
  return false;
}

const rows = await prisma.vocabWord.findMany({
  select: { id: true, userId: true, word: true, definitions: true },
});

const junk = rows.filter((r) => PLACEHOLDER.test(r.definitions || "") || looksFake(r.word));

console.log(`词条总数 ${rows.length}，判定为脏数据 ${junk.length} 条\n`);
for (const r of junk) {
  const reason = PLACEHOLDER.test(r.definitions || "") ? "占位释义" : "词形不像词";
  console.log(`  [${reason}] ${r.userId.slice(0, 12)} · ${r.word} · ${(r.definitions || "").slice(0, 48)}`);
}

if (junk.length === 0) {
  console.log("\n没有需要清理的条目。");
} else if (!APPLY) {
  console.log("\n这是 dry-run，未删除。确认无误后加 --apply 执行。");
} else {
  const ids = junk.map((r) => r.id);
  // 流水表没有外键约束，先把对应的复习记录删掉，避免留下孤儿行影响统计
  const logs = await prisma.vocabReview.deleteMany({ where: { wordId: { in: ids } } });
  const del = await prisma.vocabWord.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n已删除词条 ${del.count} 条、复习流水 ${logs.count} 条。`);
}

await prisma.$disconnect();
