// 演示数据初始化：只灌试卷与题目，不含任何账号信息。
// 用法：node scripts/seed-demo.mjs
// 幂等：每次先清掉旧试卷再写入，重复运行不留脏数据；不会动 User 表。
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 固定 id，方便 upsert 做幂等
const PAPER4 = "paper_cet4_demo";
const PAPER6 = "paper_cet6_demo";
const PASS4 = "pass_cet4_demo";
const PASS6 = "pass_cet6_demo";

const cet4Passage = {
  title: "The Quiet Return of the Letter",
  paragraphs: [
    {
      label: "A",
      text: "For a decade, messaging apps seemed to have killed the personal letter entirely. Why wait days for an envelope when a text arrives in seconds? Yet something odd has happened in the last three years: stationery sales have risen sharply, and postage for small parcels is up across college towns. The letter, it turns out, did not die so much as go quiet, waiting for a generation tired of instant replies.",
    },
    {
      label: "B",
      text: "The revival is driven less by nostalgia than by frustration. A text message demands an immediate answer; a letter does not. Psychologists note that asynchronous communication — where the recipient chooses when to respond — lowers anxiety in ways that always-on chat cannot. Students who write letters report feeling that their words carry more weight, precisely because they cannot be edited a second after sending.",
    },
    {
      label: "C",
      text: "There is also a material pleasure that screens cannot offer. The weight of the paper, the slight bleed of ink, the fold that suggests someone touched it — these are signals of effort. In a culture saturated with frictionless content, effort itself has become a form of gift. A two-page letter says, in effect, I gave this thirty minutes that I will never get back.",
    },
    {
      label: "D",
      text: "Critics argue the trend is confined to a small, educated minority and will fade once the novelty wears off. They may be right. But the lesson of the letter's return is not that old technologies always come back. It is that each new medium creates a vacuum, and something older, slower, and more deliberate often rushes in to fill it.",
    },
  ],
  questions: [
    {
      number: 1,
      stem: "What does the author say has happened in the last three years?",
      options: [
        { key: "A", text: "Messaging apps have replaced most personal letters." },
        { key: "B", text: "Sales of writing materials and parcel postage have gone up." },
        { key: "C", text: "College students have stopped using text messages." },
        { key: "D", text: "Psychologists have begun studying instant communication." },
      ],
      answer: "B",
      analysis: "第一段明确指出：近三年文具销量大幅上升，大学城的小包裹邮费也在涨。B 项与之对应。",
      optionAnalysis: {
        A: "这是过去十年的背景，不是近三年的新现象。",
        C: "原文只说短信让人疲倦，并未说学生不用短信。",
        D: "心理学家研究异步沟通是第二段内容，且与销量无关。",
      },
      evidencePara: "A",
      evidenceText:
        "stationery sales have risen sharply, and postage for small parcels is up across college towns.",
      type: "细节题",
    },
    {
      number: 2,
      stem: "According to psychologists, why do letters lower anxiety compared with texts?",
      options: [
        { key: "A", text: "They are delivered more slowly than texts." },
        { key: "B", text: "They let the recipient decide when to reply." },
        { key: "C", text: "They are usually shorter than text messages." },
        { key: "D", text: "They cost less to send than instant messages." },
      ],
      answer: "B",
      analysis: "第二段指出：异步沟通让收信人自己决定何时回复，从而降低焦虑。B 项同义转述。",
      optionAnalysis: {
        A: "投递慢是表象，并非降低焦虑的核心原因。",
        C: "原文未比较信件和短信的长短。",
        D: "原文未提及费用比较。",
      },
      evidencePara: "B",
      evidenceText:
        "asynchronous communication — where the recipient chooses when to respond — lowers anxiety",
      type: "细节题",
    },
    {
      number: 3,
      stem: "What can be inferred about students who write letters?",
      options: [
        { key: "A", text: "They are mostly unable to use smartphones." },
        { key: "B", text: "They believe their words matter more in writing." },
        { key: "C", text: "They prefer to edit messages right after sending." },
        { key: "D", text: "They write letters mainly to save money." },
      ],
      answer: "B",
      analysis: "第二段末句：写信的学生觉得自己的话更有分量，正是因为信不能像短信那样发完即改。可推断他们重视文字的分量。",
      optionAnalysis: {
        A: "与原文相反，他们恰恰是厌倦了即时回复的人，并非不会用手机。",
        C: "原文说信不能发后即改，并非他们喜欢改短信。",
        D: "原文未把省钱作为动机。",
      },
      evidencePara: "B",
      evidenceText:
        "Students who write letters report feeling that their words carry more weight, precisely because they cannot be edited a second after sending.",
      type: "推断题",
    },
    {
      number: 4,
      stem: "The word \"frictionless\" in Paragraph C is closest in meaning to ___.",
      options: [
        { key: "A", text: "rough and slow" },
        { key: "B", text: "smooth and effortless" },
        { key: "C", text: "expensive and rare" },
        { key: "D", text: "formal and serious" },
      ],
      answer: "B",
      analysis: "frictionless 本意\"无摩擦的\"。原文语境：在一个充斥着 frictionless content（无摩擦内容=随手可得、毫不费力的内容）的文化里，费力本身成了一种礼物。可见它指\"顺畅、不费力\"。",
      optionAnalysis: {
        A: "与原义相反。",
        C: "原文未涉及成本。",
        D: "frictionless 与\"正式严肃\"无关。",
      },
      evidencePara: "C",
      evidenceText: "In a culture saturated with frictionless content, effort itself has become a form of gift.",
      type: "词义题",
    },
    {
      number: 5,
      stem: "What is the main idea of the passage?",
      options: [
        { key: "A", text: "Letter writing will eventually replace texting among students." },
        { key: "B", text: "New fast media often leave room for older, slower forms." },
        { key: "C", text: "Stationery businesses are the biggest winners of the trend." },
        { key: "D", text: "Psychologists disagree on whether letters reduce anxiety." },
      ],
      answer: "B",
      analysis: "末段作者点题：信件回归的启示不是旧技术总会复兴，而是每种新媒体都会制造一个真空，让更慢、更审慎的旧形式涌入填补。B 项最贴近这一主旨。",
      optionAnalysis: {
        A: "过度推断，原文只说回升，未说取代。",
        C: "文具商只是表象，非主旨。",
        D: "原文未呈现心理学家的分歧。",
      },
      evidencePara: "D",
      evidenceText:
        "each new medium creates a vacuum, and something older, slower, and more deliberate often rushes in to fill it.",
      type: "主旨题",
    },
  ],
};

const cet6Passage = {
  title: "When Algorithms Choose Your News",
  paragraphs: [
    {
      label: "A",
      text: "A typical adult now encounters several hundred headlines a day, almost none of them chosen by a human editor. Instead, ranking systems decide what surfaces on a feed, using signals learned from billions of prior clicks. The promise was personalization: each reader sees what matters to them. The reality, researchers now argue, is more uneven — and more consequential — than the slogan suggests.",
    },
    {
      label: "B",
      text: "The core mechanism is engagement prediction. For any candidate story, the system estimates how likely a given user is to click, dwell, and share. Stories predicted to trigger strong reactions are boosted; those deemed merely informative are demoted. Over time, this creates a feedback loop in which the surprising and the outraging crowd out the important but unexciting.",
    },
    {
      label: "C",
      text: "This is not a conspiracy of bad actors. It is the predictable outcome of optimizing for a single metric. When engagement is the only signal a system can see, it will behave like a host who serves only dessert because that is what guests reach for first. The guests may even be satisfied, briefly, while their nutrition quietly collapses.",
    },
    {
      label: "D",
      text: "Several platforms have begun experimenting with \"slower\" signals: time spent returning to a story days later, whether a reader sought follow-up reading, and explicit topic preferences stated by the user. Early results are mixed. Such signals are noisier and harder to collect, but they correlate more strongly with what users later describe as \"worth their time\" rather than merely \"hard to look away from.\"",
    },
    {
      label: "E",
      text: "The deeper question is whether we want news to be chosen for us at all. Even a perfectly tuned algorithm reflects the preferences of our past selves, not the citizens we might wish to become. A news diet optimized for who we are is comfortable; one shaped for who we could be is harder, and unlikely to emerge from engagement alone.",
    },
  ],
  questions: [
    {
      number: 1,
      stem: "According to Paragraph A, what mostly decides which headlines a reader sees today?",
      options: [
        { key: "A", text: "Human editors at major news organizations." },
        { key: "B", text: "Ranking systems trained on past user behavior." },
        { key: "C", text: "The reader's explicitly stated topic preferences." },
        { key: "D", text: "The order in which stories are submitted by reporters." },
      ],
      answer: "B",
      analysis: "第一段明确：如今几乎没有标题由人类编辑挑选，而是由基于过往数十亿次点击训练出的排序系统决定。B 项与之对应。",
      optionAnalysis: {
        A: "与原文相反（almost none of them chosen by a human editor）。",
        C: "显式偏好是第四段提到的实验性新信号，非当前主流。",
        D: "原文未提及记者投稿顺序。",
      },
      evidencePara: "A",
      evidenceText:
        "almost none of them chosen by a human editor. Instead, ranking systems decide what surfaces on a feed, using signals learned from billions of prior clicks.",
      type: "细节题",
    },
    {
      number: 2,
      stem: "What does the feedback loop described in Paragraph B tend to produce?",
      options: [
        { key: "A", text: "A wider variety of informative stories." },
        { key: "B", text: "More stories that provoke strong reactions." },
        { key: "C", text: "Fewer stories about surprising events." },
        { key: "D", text: "Stories that are important but unexciting." },
      ],
      answer: "B",
      analysis: "第二段末句：预测会引发强反应的故事被推升，久而久之，令人惊讶和令人愤怒的内容挤掉了重要但不刺激的内容。可见反馈循环产出的是\"引发强反应\"的故事。",
      optionAnalysis: {
        A: "与原文相反，信息性故事反而被降权。",
        C: "原文说 surprising 被推升，而非减少。",
        D: "这是被挤掉的内容，而非产出。",
      },
      evidencePara: "B",
      evidenceText:
        "the surprising and the outraging crowd out the important but unexciting.",
      type: "细节题",
    },
    {
      number: 3,
      stem: "The \"host who serves only dessert\" analogy in Paragraph C is used to illustrate that ___.",
      options: [
        { key: "A", text: "platforms deliberately harm users for profit" },
        { key: "B", text: "optimizing a single metric leads to unbalanced outcomes" },
        { key: "C", text: "users are fully responsible for their own choices" },
        { key: "D", text: "engagement is the best available signal for ranking" },
      ],
      answer: "B",
      analysis: "第三段明确指出：这不是阴谋，而是只优化单一指标的可预见结果。主人只上甜点是因为那是客人先伸手拿的——单一目标优化导致营养失衡。该类比正是为了说明\"单一指标优化导致失衡\"。",
      optionAnalysis: {
        A: "原文明说 This is not a conspiracy。",
        C: "类比指向系统优化逻辑，非用户责任。",
        D: "与原文相悖，作者恰在批评单一 engagement 指标的局限。",
      },
      evidencePara: "C",
      evidenceText:
        "It is the predictable outcome of optimizing for a single metric.",
      type: "推断题",
    },
    {
      number: 4,
      stem: "What can be learned about the \"slower\" signals mentioned in Paragraph D?",
      options: [
        { key: "A", text: "They are easier to collect than engagement signals." },
        { key: "B", text: "They correlate better with what users later find worthwhile." },
        { key: "C", text: "They have already replaced engagement as the main ranking metric." },
        { key: "D", text: "They were abandoned because early results were disappointing." },
      ],
      answer: "B",
      analysis: "第四段末句：这类信号更嘈杂、更难收集，但它们与用户事后评价\"值得花时间\"的相关性更强。B 项同义转述。",
      optionAnalysis: {
        A: "与原文相反（noisier and harder to collect）。",
        C: "原文只说 experimenting，未取代。",
        D: "原文说 mixed，未说放弃。",
      },
      evidencePara: "D",
      evidenceText:
        "they correlate more strongly with what users later describe as \"worth their time\"",
      type: "细节题",
    },
    {
      number: 5,
      stem: "What is the author's ultimate concern about algorithmically chosen news?",
      options: [
        { key: "A", text: "It is too expensive for platforms to maintain." },
        { key: "B", text: "It reflects who we are rather than who we could become." },
        { key: "C", text: "It ignores engagement signals entirely." },
        { key: "D", text: "It is controlled by a small group of bad actors." },
      ],
      answer: "B",
      analysis: "末段点题：即使完美的算法也只反映过去的我们，而非我们想成为的公民；为\"我们是谁\"优化的新闻饮食是舒适的，而为\"我们能成为谁\"塑造的更难，也难以仅靠参与度涌现。作者终极关切正是 B。",
      optionAnalysis: {
        A: "原文未讨论成本。",
        C: "与原文相反，算法正是基于 engagement。",
        D: "第三段已否定阴谋论。",
      },
      evidencePara: "E",
      evidenceText:
        "Even a perfectly tuned algorithm reflects the preferences of our past selves, not the citizens we might wish to become.",
      type: "主旨题",
    },
  ],
};

function toPassageData(p, order, passId) {
  // 嵌套在 paper.passages.create 里时，paperId 由 Prisma 自动从父关系推断，不能显式传
  return {
    id: passId,
    order,
    title: p.title,
    paragraphs: JSON.stringify(p.paragraphs),
    questions: {
      create: p.questions.map((q, i) => ({
        order: i,
        number: q.number,
        stem: q.stem,
        options: JSON.stringify(q.options),
        answer: q.answer,
        analysis: q.analysis,
        optionAnalysis: JSON.stringify(q.optionAnalysis),
        evidencePara: q.evidencePara,
        evidenceText: q.evidenceText,
        type: q.type,
      })),
    },
  };
}

async function main() {
  // 只清试卷相关数据，User 等账号数据保持不动
  await prisma.paper.deleteMany({});
  console.log("[seed-demo] cleared papers");

  await prisma.paper.upsert({
    where: { id: PAPER4 },
    create: {
      id: PAPER4,
      title: "2023 年 6 月大学英语四级（阅读演示卷）",
      level: "CET4",
      year: 2023,
      month: 6,
      sort: 1,
      passages: { create: [toPassageData(cet4Passage, 0, PASS4)] },
    },
    update: {},
  });
  console.log("[seed-demo] CET4 paper ready");

  await prisma.paper.upsert({
    where: { id: PAPER6 },
    create: {
      id: PAPER6,
      title: "2023 年 6 月大学英语六级（阅读演示卷）",
      level: "CET6",
      year: 2023,
      month: 6,
      sort: 2,
      passages: { create: [toPassageData(cet6Passage, 1, PASS6)] },
    },
    update: {},
  });
  console.log("[seed-demo] CET6 paper ready");

  const count = await prisma.passage.count();
  console.log(`[seed-demo] done. passages in db: ${count}`);
}

main()
  .catch((e) => {
    console.error("[seed-demo] failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
