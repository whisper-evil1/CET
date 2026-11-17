/**
 * 清理测试运行产生的数据，回到干净种子状态。
 *
 * 为什么要这个：smoke / e2e 脚本里的「再点一次取消收藏」「自己能看到两条」这类断言
 * 依赖初始状态，反复运行会累积数据导致假失败。跑基线前先清一次即可。
 *
 * 只清运行数据与测试账号，不动题库（Paper/Section/Passage/Question/DictionaryEntry）。
 */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const SEED_USERS = ["user-demo", "user-alice"];

(async () => {
  // 按外键依赖顺序清理
  const a = await p.answer.deleteMany({});
  const c = await p.comment.deleteMany({});
  const f = await p.favorite.deleteMany({});
  const v = await p.vocabWord.deleteMany({});
  const ck = await p.checkin.deleteMany({});
  const us = await p.userStats.deleteMany({});
  const ep = await p.experiencePack.deleteMany({});

  // 删掉测试脚本注册的临时账号（保留两个种子账号）
  const users = await p.user.findMany({ select: { id: true, email: true } });
  const extra = users.filter((u) => !SEED_USERS.includes(u.id));
  for (const u of extra) {
    await p.user.delete({ where: { id: u.id } }).catch((e) => {
      console.log("  跳过 " + u.email + ": " + e.message.slice(0, 60));
    });
  }

  console.log("已清理:");
  console.log("  Answer=" + a.count + " Comment=" + c.count + " Favorite=" + f.count);
  console.log("  VocabWord=" + v.count + " Checkin=" + ck.count + " UserStats=" + us.count + " ExperiencePack=" + ep.count);
  console.log("  临时账号删除=" + extra.length + (extra.length ? " (" + extra.map((u) => u.email).join(", ") + ")" : ""));

  const [pu, ps, se, q] = await Promise.all([
    p.paper.count(),
    p.passage.count(),
    p.section.count(),
    p.question.count(),
  ]);
  console.log("\n题库保持:");
  console.log("  Paper=" + pu + " Section=" + se + " Passage=" + ps + " Question=" + q);
  console.log("  用户=" + (await p.user.count()));

  await p.$disconnect();
})().catch(async (e) => {
  console.error("ERR", e.message);
  await p.$disconnect();
  process.exit(1);
});
