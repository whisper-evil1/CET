/**
 * 签到彩蛋文案。
 *
 * 为什么放服务端：彩蛋按「日期 + 用户」固定，同一天重复打开弹窗必须看到同一句，
 * 否则会像随机抽奖。编号由日期哈希得出，文案表只在服务端持有，
 * 客户端只拿结果，避免有人翻前端代码提前知道所有彩蛋。
 */
export type SignInEgg = {
  title: string;
  en: string;
  zh: string;
};

export const SIGN_IN_EGGS: SignInEgg[] = [
  { title: "彩蛋 · 积少成多", en: "Little by little, one travels far.", zh: "积跬步，至千里。" },
  { title: "彩蛋 · 手感", en: "Repetition is the mother of skill.", zh: "重复是手艺之母。" },
  { title: "彩蛋 · 允许出错", en: "Mistakes are proof that you are trying.", zh: "会错，说明你真的在试。" },
  { title: "彩蛋 · 慢即是快", en: "Slow is smooth, smooth is fast.", zh: "先顺，再快。" },
  { title: "彩蛋 · 先完成", en: "Done is better than perfect.", zh: "先完成，再完美。" },
  { title: "彩蛋 · 词感", en: "Words are the bricks of thought.", zh: "词汇是思想的砖。" },
  { title: "彩蛋 · 长线", en: "Rome wasn't built in a day.", zh: "罗马不是一天建成的。" },
  { title: "彩蛋 · 好奇", en: "Stay curious, stay young.", zh: "保持好奇，就一直在长。" },
];

/** 同一天固定同一颗彩蛋：FNV-1a 哈希日期串，取模到文案表长度 */
export function eggIndexForDay(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i += 1) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % SIGN_IN_EGGS.length;
}
