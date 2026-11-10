/**
 * 句子重组的题库。
 *
 * 原样移植自参考站 data.js 的 SENTENCES（12 句四六级语感的常见表达，
 * 句长 8~12 词，适合拆词重排）。没有做任何改写 —— 这批句子的价值就在
 * 「都是真题作文/翻译里出现过的表达」，换句反而丢了语料属性。
 *
 * 12 句能支撑两局多（每局 5 句，随机抽），和参考站同款体量。
 */
export type SentencePuzzle = {
  /** 正确语序的单词序列（判断答案时用 join(" ") 全等比对） */
  en: string[];
  /** 中文句意，作为题面 */
  zh: string;
};

export const SENTENCES: SentencePuzzle[] = [
  {
    en: ["Regular", "exercise", "can", "improve", "both", "physical", "and", "mental", "health"],
    zh: "规律运动能同时改善身体和心理健康。",
  },
  {
    en: ["The", "government", "has", "introduced", "new", "policies", "to", "reduce", "air", "pollution"],
    zh: "政府已出台新政策来减少空气污染。",
  },
  {
    en: ["Many", "young", "people", "prefer", "to", "communicate", "through", "social", "media"],
    zh: "许多年轻人更愿意通过社交媒体交流。",
  },
  {
    en: ["Reading", "widely", "helps", "students", "develop", "a", "broader", "view", "of", "the", "world"],
    zh: "广泛阅读帮助学生形成更开阔的世界观。",
  },
  {
    en: ["The", "company", "promised", "to", "improve", "working", "conditions", "next", "year"],
    zh: "公司承诺明年改善工作条件。",
  },
  {
    en: ["Scientists", "have", "found", "new", "evidence", "of", "water", "on", "the", "red", "planet"],
    zh: "科学家发现了这颗红色行星上存在水的新证据。",
  },
  {
    en: ["Parents", "should", "encourage", "children", "to", "solve", "problems", "by", "themselves"],
    zh: "父母应鼓励孩子独立解决问题。",
  },
  {
    en: ["The", "report", "suggests", "that", "remote", "work", "will", "become", "increasingly", "common"],
    zh: "报告表明远程办公将日益普遍。",
  },
  {
    en: ["Effective", "time", "management", "is", "essential", "for", "academic", "success"],
    zh: "高效的时间管理对学业成功至关重要。",
  },
  {
    en: ["Volunteers", "donated", "thousands", "of", "hours", "to", "the", "community", "center", "last", "year"],
    zh: "志愿者去年为社区中心贡献了数千小时。",
  },
  {
    en: ["Artificial", "intelligence", "is", "reshaping", "the", "way", "people", "learn", "languages"],
    zh: "人工智能正在重塑人们学习语言的方式。",
  },
  {
    en: ["The", "city", "planted", "trees", "along", "the", "streets", "to", "fight", "summer", "heat"],
    zh: "这座城市沿街种树以对抗夏日高温。",
  },
];
