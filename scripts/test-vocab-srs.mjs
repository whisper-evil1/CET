#!/usr/bin/env node
/**
 * 单词优先级 + 间隔重复算法的断言测试（纯函数，不打服务）。
 *
 * 全部用显式 now 控制时间，不依赖真实时钟，所以任何时间跑结果都一样。
 *
 * 覆盖：
 *   优先级 —— 考纲、词频、紧迫度、薄弱度、真题语境、已掌握抑制、取值范围、理由文案
 *   调度   —— known 间隔序列 1/2/4/7/15/30、again 回到 10 分钟、ease 升降、
 *             hard/easy 分支、365 天封顶、掌握判定
 *   队列   —— 到期过滤、已掌握默认排除、limit、同输入顺序稳定
 *   文案   —— describeInterval / describeDue
 *
 * 用法：先编译再跑
 *   npx tsc src/lib/vocab-srs.ts --target es2020 --module es2020 --outDir .build/srs --skipLibCheck
 *   node scripts/test-vocab-srs.mjs
 */
import {
  computePriority,
  describeDue,
  describeInterval,
  examWeight,
  freqScore,
  nextInterval,
  rankQueue,
  scheduleReview,
} from "../.build/srs/vocab-srs.js";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? `  ⟶  ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);

const base = {
  word: "research",
  examRank: 362,
  examTags: "cet4,cet6",
  source: "wordbook",
  hasContext: false,
  status: "learning",
  reviewCount: 0,
  correctStreak: 0,
  lapses: 0,
  intervalDays: 0,
  dueAt: null,
  now: NOW,
};

console.log("\n【优先级】");

const c4 = computePriority({ ...base, examTags: "cet4" }).score;
const c6 = computePriority({ ...base, examTags: "cet6" }).score;
const none = computePriority({ ...base, examTags: null }).score;
check("四级词优先级高于六级词", c4 > c6, `${c4} > ${c6}`);
check("六级词优先级高于无考纲标签", c6 > none, `${c6} > ${none}`);

const highFreq = computePriority({ ...base, examRank: 300 }).score;
const lowFreq = computePriority({ ...base, examRank: 12000 }).score;
check("高频词优先级高于低频词", highFreq > lowFreq, `${highFreq} > ${lowFreq}`);

const overdue = computePriority({
  ...base,
  reviewCount: 3,
  correctStreak: 3,
  intervalDays: 7,
  dueAt: NOW - 5 * DAY,
}).score;
const justDone = computePriority({
  ...base,
  reviewCount: 3,
  correctStreak: 3,
  intervalDays: 15,
  dueAt: NOW + 14 * DAY,
}).score;
check("逾期 5 天的词优先级高于刚背过的词", overdue > justDone, `${overdue} > ${justDone}`);

const withLapses = computePriority({ ...base, reviewCount: 4, lapses: 3 }).score;
const clean = computePriority({ ...base, reviewCount: 4, lapses: 0 }).score;
check("老出错的词优先级更高", withLapses > clean, `${withLapses} > ${clean}`);

const withCtx = computePriority({ ...base, hasContext: true }).score;
const noCtx = computePriority({ ...base, hasContext: false }).score;
check("真题语境加成 +3", Math.abs(withCtx - noCtx - 3) < 0.05, `${noCtx} → ${withCtx}`);

const mastered = computePriority({ ...base, status: "mastered", reviewCount: 5, correctStreak: 5, intervalDays: 30 }).score;
const learning = computePriority({ ...base, status: "learning", reviewCount: 5, correctStreak: 5, intervalDays: 30 }).score;
check("已掌握的词被压到更低优先级", mastered < learning, `${mastered} < ${learning}`);

const everyScore = [
  computePriority(base).score,
  computePriority({ ...base, examRank: 1, lapses: 9 }).score,
  computePriority({ ...base, examRank: 99999, status: "mastered", dueAt: NOW - 90 * DAY, reviewCount: 3 }).score,
];
check("分数始终落在 0-100", everyScore.every((s) => s >= 0 && s <= 100), everyScore.join(", "));

const reason = computePriority({ ...base, hasContext: true }).reason;
check("理由包含考纲与词频", reason.includes("四级考纲词") && reason.includes("词频第 362 位"), reason);

check("examWeight 单调：cet4 ≥ cet6 ≥ 无标签", examWeight("cet4") >= examWeight("cet6") && examWeight("cet6") > examWeight(null));
check("freqScore 单调递减", freqScore(100) > freqScore(1000) && freqScore(1000) > freqScore(9000));
check("无词频数据取中性值 0.5", freqScore(null) === 0.5);

console.log("\n【间隔序列】");
check("0 天 → 1 天", nextInterval(0, 2.5) === 1);
check("1 天 → 2 天", nextInterval(1, 2.5) === 2);
check("2 天 → 4 天", nextInterval(2, 2.5) === 4);
check("4 天 → 7 天", nextInterval(4, 2.5) === 7);
check("7 天 → 15 天", nextInterval(7, 2.5) === 15);
check("15 天 → 30 天", nextInterval(15, 2.5) === 30);
check("30 天起按 ease 增长（2.5 → 75）", nextInterval(30, 2.5) === 75, String(nextInterval(30, 2.5)));

console.log("\n【调度】");

const fresh = { reviewCount: 0, correctStreak: 0, lapses: 0, intervalDays: 0, ease: 2.5, status: "learning", dueAt: null };

const k1 = scheduleReview(fresh, "good", NOW);
check("首次答对：间隔 1 天", k1.intervalDays === 1, String(k1.intervalDays));
check("首次答对：到期时间为 24 小时后", Math.abs(k1.dueAt.getTime() - (NOW + DAY)) < 1000);
check("首次答对：未掌握", k1.status === "learning");
check("首次答对：不认识次数不涨", k1.reviewCount === 1, String(k1.reviewCount));
check("首次答对：提示文案为「1 天后」", k1.nextLabel === "1 天后", k1.nextLabel);

const k2 = scheduleReview({ ...fresh, reviewCount: 1, correctStreak: 1, intervalDays: 1 }, "good", NOW);
check("第二次答对：间隔 2 天", k2.intervalDays === 2, String(k2.intervalDays));

const k3 = scheduleReview({ ...fresh, reviewCount: 2, correctStreak: 2, intervalDays: 2 }, "good", NOW);
check("第三次答对：间隔 4 天", k3.intervalDays === 4, String(k3.intervalDays));
check("第三次答对：移入已掌握", k3.status === "mastered");
check("第三次答对：标记 justMastered", k3.justMastered === true);

const again = scheduleReview({ ...fresh, reviewCount: 1, correctStreak: 1, intervalDays: 1, ease: 2.5 }, "again", NOW);
check("答错：间隔归零", again.intervalDays === 0);
check("答错：10 分钟后重来", Math.abs(again.dueAt.getTime() - (NOW + 10 * 60000)) < 1000, again.nextLabel);
check("答错：lapses +1", again.lapses === 1);
check("答错：连对归零", again.correctStreak === 0);
check("答错：ease 下调", again.ease < 2.5, String(again.ease));
check("答错：回到学习中", again.status === "learning");
check("答错：不认识不增加认识次数", again.reviewCount === 1);

const hard = scheduleReview({ ...fresh, intervalDays: 7, reviewCount: 2 }, "hard", NOW);
check("hard：间隔按 1.2 倍推进（7 → 8）", hard.intervalDays === 8, String(hard.intervalDays));
check("hard：连对归零", hard.correctStreak === 0);

const easy = scheduleReview({ ...fresh, intervalDays: 4, reviewCount: 2, ease: 2.5 }, "easy", NOW);
check("easy：间隔按 ease×1.3 放大（4 → 13）", easy.intervalDays === 13, String(easy.intervalDays));
check("easy：ease 上调", easy.ease > 2.5, String(easy.ease));

const capped = scheduleReview({ ...fresh, intervalDays: 300, reviewCount: 9, ease: 3.2 }, "easy", NOW);
check("间隔封顶 365 天", capped.intervalDays === 365, String(capped.intervalDays));

const lowEase = scheduleReview({ ...fresh, intervalDays: 10, ease: 1.3 }, "again", NOW);
check("ease 下限 1.3", lowEase.ease >= 1.3, String(lowEase.ease));

console.log("\n【文案】");
check("describeInterval：10 分钟", describeInterval(10 * 60000) === "10 分钟后", describeInterval(10 * 60000));
check("describeInterval：3 天", describeInterval(3 * DAY) === "3 天后", describeInterval(3 * DAY));
check("describeInterval：0", describeInterval(0) === "今天");
check("describeDue：新词", describeDue(null, 0, NOW).label === "新词");
check("describeDue：逾期", describeDue(new Date(NOW - 3 * DAY), 3, NOW).label === "逾期 3 天", describeDue(new Date(NOW - 3 * DAY), 3, NOW).label);
check("describeDue：未来", describeDue(new Date(NOW + 5 * DAY), 3, NOW).label === "5 天后", describeDue(new Date(NOW + 5 * DAY), 3, NOW).label);
check("describeDue：逾期标记为 true", describeDue(new Date(NOW - 3 * DAY), 3, NOW).overdue === true);

console.log("\n【队列】");

const queueInput = [
  { ...base, word: "alpha", examRank: 200, reviewCount: 0 },
  { ...base, word: "beta", examRank: 5000, reviewCount: 0 },
  { ...base, word: "gamma", examRank: 300, reviewCount: 2, dueAt: new Date(NOW - 2 * DAY), intervalDays: 4 },
  { ...base, word: "delta", examRank: 300, reviewCount: 2, dueAt: new Date(NOW + 5 * DAY), intervalDays: 15 },
  { ...base, word: "epsilon", examRank: 100, reviewCount: 6, status: "mastered", intervalDays: 40, dueAt: new Date(NOW - DAY) },
];

const ranked = rankQueue(queueInput, { now: NOW });
const rankedWords = ranked.map((hit) => hit.item.word);
check("未到期的词不进队列", rankedWords.indexOf("delta") === -1, rankedWords.join(", "));
check("已掌握的词默认不进队列", rankedWords.indexOf("epsilon") === -1, rankedWords.join(", "));
check("新词与到期词都在队列里", rankedWords.indexOf("alpha") >= 0 && rankedWords.indexOf("gamma") >= 0, rankedWords.join(", "));

const withMastered = rankQueue(queueInput, { now: NOW, includeMastered: true });
check("includeMastered 时已掌握词可出现", withMastered.some((hit) => hit.item.word === "epsilon"));

const limited = rankQueue(queueInput, { now: NOW, limit: 1 });
check("limit 生效", limited.length === 1, String(limited.length));

const again1 = rankQueue(queueInput, { now: NOW }).map((hit) => hit.item.word).join(",");
const again2 = rankQueue(queueInput, { now: NOW }).map((hit) => hit.item.word).join(",");
check("同输入两次排序完全一致", again1 === again2, again1);

const higherFirst = rankQueue(
  [
    { ...base, word: "low", examRank: 15000, examTags: null },
    { ...base, word: "high", examRank: 200, examTags: "cet4" },
  ],
  { now: NOW },
);
check("优先级高的排在前", higherFirst[0].item.word === "high", higherFirst.map((h) => `${h.item.word}:${h.score}`).join(" > "));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
