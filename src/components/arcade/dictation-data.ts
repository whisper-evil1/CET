/**
 * 听写句子库：CET 4/6 常见句式，长度 8–16 词，读完约 4–8 秒。
 * 只放「听一遍能记住主干、写下来能看出错在哪」的句子——太长的句子听写只会全错，
 * 练不到辨音，反而劝退。
 */
export type DictationSentence = {
  text: string;
  /** 中文提示：不给提示就变成纯默写，给了才知道该往哪个方向听 */
  hint: string;
  level: "CET4" | "CET6";
};

export const DICTATION_SENTENCES: DictationSentence[] = [
  { text: "The library stays open until midnight during the exam week.", hint: "考试周图书馆开到午夜", level: "CET4" },
  { text: "Most students prefer to study in small groups rather than alone.", hint: "多数学生喜欢小组学习", level: "CET4" },
  { text: "She missed the train because the bus was twenty minutes late.", hint: "公交车晚点导致错过火车", level: "CET4" },
  { text: "The company plans to hire thirty engineers next year.", hint: "公司明年招三十名工程师", level: "CET4" },
  { text: "Walking to work every day has improved his health a lot.", hint: "每天步行上班改善了健康", level: "CET4" },
  { text: "We need to finish the report before Friday afternoon.", hint: "周五下午前完成报告", level: "CET4" },
  { text: "The museum is free on the first Sunday of every month.", hint: "每月第一个周日免费", level: "CET4" },
  { text: "He decided to take a gap year before going to university.", hint: "上大学前休学一年", level: "CET4" },
  { text: "Fresh vegetables from local farms are sold in this market.", hint: "本地农场的新鲜蔬菜", level: "CET4" },
  { text: "The noise from the street made it hard to concentrate.", hint: "街上的噪音让人难以集中", level: "CET4" },
  { text: "Please turn off your phone before the meeting begins.", hint: "会议开始前关手机", level: "CET4" },
  { text: "The new bicycle lane has reduced traffic on the main road.", hint: "自行车道减少了主干道车流", level: "CET4" },
  { text: "Researchers found that sleep helps the brain store new information.", hint: "睡眠帮助大脑储存信息", level: "CET4" },
  { text: "The café on the corner is closing because the rent went up.", hint: "街角咖啡馆因涨租关门", level: "CET4" },
  { text: "Students who ask questions in class tend to remember more.", hint: "课上提问的学生记得更多", level: "CET4" },
  { text: "The flight was delayed for two hours because of heavy snow.", hint: "大雪导致航班延误两小时", level: "CET4" },
  { text: "Many young people now choose to rent rather than buy a flat.", hint: "年轻人选择租房而非买房", level: "CET4" },
  { text: "The course combines online lectures with weekly discussion groups.", hint: "网课加每周讨论", level: "CET4" },
  { text: "It takes about forty minutes to get there by subway.", hint: "坐地铁约四十分钟", level: "CET4" },
  { text: "The government will invest more money in rural schools.", hint: "政府加大对乡村学校投入", level: "CET4" },
  { text: "Although the task was difficult, the team finished it on time.", hint: "任务难但按时完成", level: "CET6" },
  { text: "The report suggests that remote work reduces office costs significantly.", hint: "远程办公显著降低办公成本", level: "CET6" },
  { text: "Consumers are increasingly concerned about how their data is used.", hint: "消费者关心数据用途", level: "CET6" },
  { text: "The professor encouraged us to question the assumptions behind the theory.", hint: "教授鼓励质疑理论假设", level: "CET6" },
  { text: "Efforts to reduce food waste have produced measurable results.", hint: "减少食物浪费初见成效", level: "CET6" },
  { text: "The city has invested heavily in public transport over the past decade.", hint: "过去十年大力投入公共交通", level: "CET6" },
  { text: "His argument is convincing, but the evidence remains rather limited.", hint: "论点有说服力但证据有限", level: "CET6" },
  { text: "Volunteers repaired the old station and turned it into a community centre.", hint: "志愿者把老车站改成社区中心", level: "CET6" },
  { text: "A growing number of firms allow employees to choose their working hours.", hint: "越来越多公司允许弹性工时", level: "CET6" },
  { text: "The study followed two thousand children for more than ten years.", hint: "跟踪两千名儿童十余年", level: "CET6" },
];
