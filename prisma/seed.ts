/**
 * 种子数据：
 *   - CET4 / CET6 各一套阅读（各 5 题），解析与逐项分析按真实教辅的写法来
 *   - 两个演示账号，方便验证「私密留言换账号不可见」
 *
 * 运行：npm run db:seed
 * 幂等：按固定 id upsert，重复运行不会产生脏数据
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type SeedQuestion = {
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
  analysis: string;
  optionAnalysis: Record<string, string>;
  evidencePara: string;
  evidenceText: string;
  type: string;
};

type SeedPassage = {
  title: string;
  paragraphs: { label: string; text: string }[];
  questions: SeedQuestion[];
};

/** 听力原文逐句结构 */
type SeedTranscriptLine = { id: number; start: number; end: number; text: string };

/** 听力题目（带证据句） */
type SeedListeningQuestion = {
  number: number;
  stem: string;
  options: { key: string; text: string }[];
  answer: string;
  analysis: string;
  evidenceSentences: number[];
};

/** 写作/翻译题目（只有题干，无选项） */
type SeedWritingQuestion = {
  number: number;
  stem: string;
  directions: string;
  /** 参考范文/参考译文，展示在"参考要点"里 */
  reference: string;
};

/* ============================ CET4 ============================ */

/* --- CET4 听力：短篇新闻（公开授权素材风格，audioUrl 占位） --- */
const cet4ListeningTranscript: SeedTranscriptLine[] = [
  { id: 1, start: 0.0, end: 4.5, text: "Welcome to BBC Learning English." },
  { id: 2, start: 4.5, end: 9.2, text: "Today we're talking about why handwriting still matters in a digital age." },
  { id: 3, start: 9.2, end: 14.8, text: "Researchers at Princeton University found that students who take notes by hand remember more than those who type." },
  { id: 4, start: 14.8, end: 20.1, text: "The study involved 67 students divided into two groups." },
  { id: 5, start: 20.1, end: 25.6, text: "Both groups watched the same fifteen-minute lecture." },
  { id: 6, start: 25.6, end: 31.0, text: "The handwriting group scored significantly higher on conceptual questions." },
  { id: 7, start: 31.0, end: 36.4, text: "Professor Mueller explained that typing encourages word-for-word transcription." },
  { id: 8, start: 36.4, end: 42.0, text: "Handwriting forces the brain to process and summarize information in real time." },
  { id: 9, start: 42.0, end: 47.5, text: "This finding has important implications for classroom technology policies." },
  { id: 10, start: 47.5, end: 52.0, text: "Next week, we'll look at how this research is being applied in schools." },
];

const cet4ListeningQuestions: SeedListeningQuestion[] = [
  {
    number: 1,
    stem: "What is the main topic of the news report?",
    options: [
      { key: "A", text: "The decline of handwriting in modern schools." },
      { key: "B", text: "A study comparing handwriting and typing for note-taking." },
      { key: "C", text: "How to improve typing speed in lectures." },
      { key: "D", text: "The history of BBC Learning English programs." },
    ],
    answer: "B",
    analysis: "新闻开头即点明主题：talking about why handwriting still matters，接着介绍 Princeton 大学的研究比较手写和打字笔记的效果。B 概括了全文主旨。",
    evidenceSentences: [1, 2],
  },
  {
    number: 2,
    stem: "How many students participated in the study?",
    options: [
      { key: "A", text: "15 students." },
      { key: "B", text: "67 students." },
      { key: "C", text: "Two groups of unspecified size." },
      { key: "D", text: "Over 100 students." },
    ],
    answer: "B",
    analysis: "原文第 4 句明确说 The study involved 67 students divided into two groups。",
    evidenceSentences: [4],
  },
  {
    number: 3,
    stem: "According to Professor Mueller, why do handwriting students perform better?",
    options: [
      { key: "A", text: "Because they write faster than typists." },
      { key: "B", text: "Because handwriting forces the brain to process and summarize." },
      { key: "C", text: "Because they have better pens than laptops." },
      { key: "D", text: "Because they don't use technology at all." },
    ],
    answer: "B",
    analysis: "第 7-8 句：Professor Mueller explained that typing encourages word-for-word transcription. Handwriting forces the brain to process and summarize information in real time。B 是第 8 句的同义表述。",
    evidenceSentences: [7, 8],
  },
];

/* --- CET4 写作 --- */
const cet4WritingQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to write a short essay on the importance of handwriting. You should write at least 120 words but no more than 180 words.",
    directions: "In this section, you will write an essay based on the following outline:\n1. 手写笔记在数字时代仍然重要\n2. 分析原因（至少两点）\n3. 你的结论",
    reference:
      "【参考范文】\nThe Importance of Handwriting in the Digital Age\n\nIn an era dominated by smartphones and laptops, handwriting may seem outdated. However, it remains an essential skill that we should not abandon.\n\nThere are two main reasons why handwriting still matters. First, it enhances memory and learning. Research shows that students who take notes by hand retain information better than those who type, because writing forces the brain to process content more deeply. Second, handwriting is a form of personal expression. A handwritten letter or note carries warmth and individuality that a typed message can never match.\n\nIn conclusion, despite the convenience of digital devices, handwriting continues to play a valuable role in our lives. We should make time to practice it regularly.\n\n（约 150 词）",
  },
];

/* --- CET4 翻译 --- */
const cet4TranslationQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to translate the following passage into English.",
    directions: "在中国，书法（calligraphy）自古以来被视为一种高雅的艺术形式。许多人认为，练习书法不仅能培养耐心，还能提高专注力。尽管现代人更多地使用电脑和手机打字，但仍有不少人坚持每天手写。他们相信，手写是一种与内心对话的方式，有助于在快节奏的生活中找到平静。",
    reference:
      "【参考译文】\nIn China, calligraphy has been regarded as an elegant art form since ancient times. Many people believe that practicing calligraphy not only cultivates patience but also improves concentration. Although modern people more often type on computers and mobile phones, a considerable number still insist on writing by hand every day. They believe that handwriting is a way to converse with one's inner self and helps find peace in a fast-paced life.\n\n【要点提示】\n- 自古以来：since ancient times\n- 高雅的艺术形式：an elegant art form\n- 培养耐心：cultivate patience\n- 提高专注力：improve concentration / enhance focus\n- 与内心对话：converse with one's inner self",
  },
];

const cet4Passage: SeedPassage = {
  title: "Why the Paper Notebook Refuses to Die",
  paragraphs: [
    {
      label: "A",
      text: "Every September, laptops open in lecture halls across the country, yet the stationery aisle tells a different story. Notebook sales have climbed for four straight years, and the most popular models are the cheapest: plain, unlined, forty pages. Students who type faster than they can write still queue up for them. The obvious explanation — nostalgia — does not survive contact with the numbers. Something more practical is going on.",
    },
    {
      label: "B",
      text: "Research on note-taking offers a clue. In a widely cited study, students who took notes by hand outperformed typists on questions that required them to explain ideas in their own words, even though the typists recorded more information. The researchers suggested a reason: handwriting is slow, so the writer must decide, sentence by sentence, what matters. A laptop invites transcription; a pen invites judgment. The handwritten notes were shorter, messier, and considerably more useful.",
    },
    {
      label: "C",
      text: "Speed, in other words, is not always an advantage. This runs against the way most study tools are sold. Software promises to capture everything — every slide, every word, every pause — and it delivers. What it cannot deliver is the act of choosing. When a machine records a lecture perfectly, the student is freed from the very task that builds understanding. Convenience, in this case, quietly removes the work that learning requires.",
    },
    {
      label: "D",
      text: "There is also the matter of attention. Screens are built to interrupt: a message arrives, a tab opens, a notification slides in. A paper notebook, dull as it is, does nothing at all. Teachers who have banned laptops from their classrooms report longer discussions rather than shorter ones, and students who initially complained often admit, a term later, that they remembered more. Boredom, it turns out, is sometimes the price of concentration.",
    },
    {
      label: "E",
      text: "None of this means paper is superior in every case. For a three-hundred-page report or a shared project, digital tools win without argument. The point is narrower and more useful: when the goal is to understand rather than to store, the slower, more deliberate tool may be the better one. Students seem to have reached this conclusion on their own, one cheap notebook at a time.",
    },
  ],
  questions: [
    {
      number: 46,
      stem: "What does the author say about notebook sales in recent years?",
      options: [
        { key: "A", text: "They have been falling as laptops become common in classrooms." },
        { key: "B", text: "They have risen for four straight years, with cheap models selling best." },
        { key: "C", text: "They are driven mainly by students who dislike typing." },
        { key: "D", text: "They are highest among students who own laptops." },
      ],
      answer: "B",
      analysis:
        "细节题，定位首段第二句：Notebook sales have climbed for four straight years, and the most popular models are the cheapest。B 是这句话的同义改写（climbed → risen，the most popular models are the cheapest → cheap models selling best）。",
      optionAnalysis: {
        A: "与原文方向相反。原文说销量连续四年上升，而不是下降。",
        B: "正确。对应首段第二句，只是把 climbed 换成 risen。",
        C: "把「打字更快的人也排队买」曲解成「不爱打字的人才是主力」，文中没有这个因果。",
        D: "原文只说拥有电脑的学生也照样买，并未比较有电脑和没电脑两组的购买量，属于无依据比较。",
      },
      evidencePara: "A",
      evidenceText:
        "Notebook sales have climbed for four straight years, and the most popular models are the cheapest",
      type: "细节题",
    },
    {
      number: 47,
      stem: "According to the note-taking study, why did handwriting lead to better understanding?",
      options: [
        { key: "A", text: "Handwritten notes contained more information than typed ones." },
        { key: "B", text: "Writers could review their notes more quickly before exams." },
        { key: "C", text: "Writing slowly forced students to decide what mattered." },
        { key: "D", text: "Typists were less familiar with the content of the lecture." },
      ],
      answer: "C",
      analysis:
        "细节题。B 段破折号后的解释句就是答案：handwriting is slow, so the writer must decide, sentence by sentence, what matters。C 项与这句几乎一一对应（forced ≈ must；what mattered ≈ what matters）。",
      optionAnalysis: {
        A: "与原文正相反：「even though the typists recorded more information」，记录更多信息的是打字者。",
        B: "复习速度在原文中从未提及，属于常识性干扰项。",
        C: "正确。对应「handwriting is slow, so the writer must decide... what matters」。",
        D: "原文没有讨论两组学生对讲座内容的熟悉程度。",
      },
      evidencePara: "B",
      evidenceText:
        "handwriting is slow, so the writer must decide, sentence by sentence, what matters",
      type: "细节题",
    },
    {
      number: 48,
      stem: "What does \"the act of choosing\" (Paragraph C) most probably refer to?",
      options: [
        { key: "A", text: "Deciding which parts of a lecture are worth recording." },
        { key: "B", text: "Choosing which note-taking software to install." },
        { key: "C", text: "Selecting a notebook with the right number of pages." },
        { key: "D", text: "Choosing whether to attend a lecture or not." },
      ],
      answer: "A",
      analysis:
        "词义题。C 段先说软件能 capture everything，接着说「What it cannot deliver is the act of choosing」，紧接着解释「the student is freed from the very task that builds understanding」。所以「选择」指的是判断哪些内容值得记，与你用什么软件、买几页本子无关。",
      optionAnalysis: {
        A: "正确。与上一段的「decide... what matters」以及本段「freed from the task that builds understanding」呼应。",
        B: "把 choosing 误解成选软件。本段讨论的不是工具选择，而是记录时的取舍。",
        C: "利用第一段「forty pages」设置的干扰项，与 C 段语境无关。",
        D: "与上下文毫无关系，本段讨论的是课堂记录方式。",
      },
      evidencePara: "C",
      evidenceText: "What it cannot deliver is the act of choosing.",
      type: "词义题",
    },
    {
      number: 49,
      stem: "What can be inferred from teachers' experience with banning laptops?",
      options: [
        { key: "A", text: "Class discussions became shorter but more focused." },
        { key: "B", text: "Students' attention and memory improved over the term." },
        { key: "C", text: "Most students refused to attend classes without laptops." },
        { key: "D", text: "Teachers had to print notes for every student." },
      ],
      answer: "B",
      analysis:
        "推断题。D 段说禁掉电脑后讨论变长（longer discussions rather than shorter ones），学生一学期后承认记得更多（a term later, that they remembered more）。「讨论变长」指向注意力，「记得更多」指向记忆，合起来就是 B。",
      optionAnalysis: {
        A: "原文是 longer discussions，与 shorter 方向相反，这是最常见的反义干扰。",
        B: "正确。由「longer discussions」+「remembered more」+「the price of concentration」三点推出。",
        C: "原文只说学生 initially complained（最初抱怨），并没有说拒绝上课。",
        D: "打印讲义原文未提，属于凭空补细节。",
      },
      evidencePara: "D",
      evidenceText:
        "Teachers who have banned laptops from their classrooms report longer discussions rather than shorter ones",
      type: "推断题",
    },
    {
      number: 50,
      stem: "What is the author's main point?",
      options: [
        { key: "A", text: "Paper notebooks should replace digital tools in all study situations." },
        { key: "B", text: "Handwriting is a skill that modern students are losing." },
        { key: "C", text: "When the goal is understanding, a slower tool may work better." },
        { key: "D", text: "Note-taking research has been widely misunderstood." },
      ],
      answer: "C",
      analysis:
        "主旨题。答案在末段主题句：when the goal is to understand rather than to store, the slower, more deliberate tool may be the better one。全文先给数据，再给研究，最后收窄论点，结构非常典型。",
      optionAnalysis: {
        A: "过度绝对化。原文明确说 None of this means paper is superior in every case，A 与作者立场冲突。",
        B: "「书写能力流失」全文未提，属于延伸过度。",
        C: "正确。末段主题句的原文复现，注意 may be 的委婉语气。",
        D: "研究是否被误解不是本文重点，本文是用研究来支撑自己的判断。",
      },
      evidencePara: "E",
      evidenceText:
        "when the goal is to understand rather than to store, the slower, more deliberate tool may be the better one",
      type: "主旨题",
    },
  ],
};

/* --- CET4 阅读第二篇：社交媒体与心理健康 --- */
const cet4Passage2: SeedPassage = {
  title: "The Double-Edged Sword of Social Media",
  paragraphs: [
    {
      label: "A",
      text: "Social media has become an inseparable part of daily life for billions of people around the world. Platforms such as WeChat, TikTok, and Instagram allow users to share moments, stay connected with friends, and access information instantly. For many young people, checking social media is the first thing they do in the morning and the last thing before sleep.",
    },
    {
      label: "B",
      text: "However, a growing body of research suggests that excessive use of social media may harm mental health. A 2023 study published in the Journal of Youth and Adolescence found that teenagers who spent more than three hours a day on social media were 60% more likely to report symptoms of anxiety and depression. The constant comparison with others' seemingly perfect lives often leads to feelings of inadequacy and low self-esteem.",
    },
    {
      label: "C",
      text: "Moreover, social media can disrupt sleep patterns. The blue light emitted by screens suppresses the production of melatonin, a hormone that regulates sleep. Many users admit to losing sleep because they cannot stop scrolling through their feeds, which in turn affects their academic performance and mood the next day.",
    },
    {
      label: "D",
      text: "On the positive side, social media provides valuable support networks. People facing rare illnesses or social isolation can find communities that offer emotional support and practical advice. It also serves as a powerful tool for education and social activism, raising awareness about important issues.",
    },
    {
      label: "E",
      text: "Experts argue that the key is not to abandon social media entirely but to use it mindfully. Setting time limits, curating one's feed to include positive content, and taking regular digital breaks can help reduce the negative effects. As with many technologies, the impact of social media depends largely on how we choose to use it.",
    },
  ],
  questions: [
    {
      number: 51,
      stem: "What is the main idea of the passage?",
      options: [
        { key: "A", text: "Social media should be banned among teenagers." },
        { key: "B", text: "Social media has both benefits and drawbacks that depend on usage." },
        { key: "C", text: "Social media is the leading cause of mental illness." },
        { key: "D", text: "Social media has improved global communication beyond measure." },
      ],
      answer: "B",
      analysis: "主旨题。文章既讲社交媒体的危害（B、C段），又讲好处（D段），末段E总结关键在于 mindful use。B 准确概括了'双刃剑'主旨。",
      optionAnalysis: {
        A: "作者从未主张全面禁止，属于过度推断。",
        B: "正确。对应全文结构：危害 + 好处 + 合理使用建议。",
        C: "leading cause 言过其实，原文说 may harm，不是主因。",
        D: "只讲好处，以偏概全。",
      },
      evidencePara: "E",
      evidenceText: "the impact of social media depends largely on how we choose to use it",
      type: "主旨题",
    },
    {
      number: 52,
      stem: "According to the 2023 study, what increases the risk of anxiety among teenagers?",
      options: [
        { key: "A", text: "Using social media for more than three hours daily." },
        { key: "B", text: "Sharing personal photos online." },
        { key: "C", text: "Having fewer than 100 followers." },
        { key: "D", text: "Reading news on social media." },
      ],
      answer: "A",
      analysis: "细节题。B 段第三句：teenagers who spent more than three hours a day on social media were 60% more likely to report symptoms of anxiety and depression。A 直接对应。",
      optionAnalysis: {
        A: "正确。对应「more than three hours a day」。",
        B: "发照片原文未提。",
        C: "粉丝数原文未提。",
        D: "看新闻原文未提。",
      },
      evidencePara: "B",
      evidenceText: "teenagers who spent more than three hours a day on social media were 60% more likely to report symptoms of anxiety",
      type: "细节题",
    },
    {
      number: 53,
      stem: "Why does social media affect sleep according to the passage?",
      options: [
        { key: "A", text: "Because it makes users feel hungry." },
        { key: "B", text: "Because blue light reduces melatonin production." },
        { key: "C", text: "Because the noise from notifications is too loud." },
        { key: "D", text: "Because users exercise less during the day." },
      ],
      answer: "B",
      analysis: "细节题。C 段第二句：The blue light emitted by screens suppresses the production of melatonin, a hormone that regulates sleep。B 是原句改写。",
      optionAnalysis: {
        A: "饥饿与睡眠无关，原文未提。",
        B: "正确。蓝光抑制褪黑素。",
        C: "通知噪音原文未提。",
        D: "运动少不是文中给出的原因。",
      },
      evidencePara: "C",
      evidenceText: "The blue light emitted by screens suppresses the production of melatonin",
      type: "细节题",
    },
    {
      number: 54,
      stem: "What positive role does social media play according to Paragraph D?",
      options: [
        { key: "A", text: "It helps users earn money online." },
        { key: "B", text: "It provides support communities and educational value." },
        { key: "C", text: "It replaces traditional doctors and therapists." },
        { key: "D", text: "It guarantees a good night's sleep." },
      ],
      answer: "B",
      analysis: "细节题。D 段提到 support networks、communities、education and social activism。B 概括了这些正面作用。",
      optionAnalysis: {
        A: "赚钱原文未提。",
        B: "正确。对应 support networks + education and social activism。",
        C: "取代医生过度推断，原文只说提供情感支持。",
        D: "与 C 段相反，社交媒体影响睡眠。",
      },
      evidencePara: "D",
      evidenceText: "social media provides valuable support networks... It also serves as a powerful tool for education and social activism",
      type: "细节题",
    },
    {
      number: 55,
      stem: "What suggestion do experts give about using social media?",
      options: [
        { key: "A", text: "Stop using all social media platforms." },
        { key: "B", text: "Use it only for academic purposes." },
        { key: "C", text: "Use it mindfully with time limits and digital breaks." },
        { key: "D", text: "Increase the number of followers gradually." },
      ],
      answer: "C",
      analysis: "细节题。E 段：the key is not to abandon social media entirely but to use it mindfully. Setting time limits... taking regular digital breaks。C 完整对应。",
      optionAnalysis: {
        A: "与原文 not to abandon entirely 相反。",
        B: "only for academic 原文未提。",
        C: "正确。mindfully + time limits + digital breaks。",
        D: "粉丝数原文未提。",
      },
      evidencePara: "E",
      evidenceText: "the key is not to abandon social media entirely but to use it mindfully. Setting time limits... taking regular digital breaks",
      type: "细节题",
    },
  ],
};

/* ============================ CET6 ============================ */

/* 六级听力：长对话风格，素材为公开授权教育内容 */
const cet6ListeningTranscript: SeedTranscriptLine[] = [
  { id: 1, start: 0.0, end: 5.2, text: "In today's program, we're looking at how artificial intelligence is changing education." },
  { id: 2, start: 5.2, end: 10.8, text: "Dr. Sarah Chen from Stanford University has been studying this trend for three years." },
  { id: 3, start: 10.8, end: 16.5, text: "Her research shows that AI tutoring systems can improve test scores by up to twenty percent." },
  { id: 4, start: 16.5, end: 22.0, text: "However, she warns that technology alone cannot replace good teaching." },
  { id: 5, start: 22.0, end: 28.3, text: "The most successful programs combine AI tools with human instructors who provide emotional support." },
  { id: 6, start: 28.3, end: 34.0, text: "Interestingly, students from lower-income backgrounds benefited the most from AI assistance." },
  { id: 7, start: 34.0, end: 39.7, text: "Dr. Chen attributes this to the fact that these students often lack access to private tutors." },
  { id: 8, start: 39.7, end: 45.5, text: "The AI system essentially democratizes access to personalized learning." },
  { id: 9, start: 45.5, end: 51.2, text: "But privacy concerns remain, as these platforms collect vast amounts of student data." },
  { id: 10, start: 51.2, end: 56.0, text: "Dr. Chen calls for stricter regulations to protect vulnerable learners." },
];

const cet6ListeningQuestions: SeedListeningQuestion[] = [
  {
    number: 1,
    stem: "What is Dr. Chen's main finding about AI in education?",
    options: [
      { key: "A", text: "AI can completely replace human teachers in all subjects." },
      { key: "B", text: "AI tutoring systems can improve test scores by up to 20%." },
      { key: "C", text: "AI is more effective in teaching math than languages." },
      { key: "D", text: "AI tutoring only works for college students." },
    ],
    answer: "B",
    analysis: "第 3 句直接给出了数据：AI tutoring systems can improve test scores by up to twenty percent。B 是这句话的同义表述。",
    evidenceSentences: [3],
  },
  {
    number: 2,
    stem: "Which group of students benefits most from AI tutoring?",
    options: [
      { key: "A", text: "Students from wealthy families who already have private tutors." },
      { key: "B", text: "College students studying computer science." },
      { key: "C", text: "Students from lower-income backgrounds." },
      { key: "D", text: "Adults returning to education after many years." },
    ],
    answer: "C",
    analysis: "第 6 句：students from lower-income backgrounds benefited the most from AI assistance。第 7 句解释原因：这些学生通常请不起私教。",
    evidenceSentences: [6, 7],
  },
  {
    number: 3,
    stem: "What concern does Dr. Chen raise at the end?",
    options: [
      { key: "A", text: "AI systems are too expensive for schools to afford." },
      { key: "B", text: "Students might become too dependent on technology." },
      { key: "C", text: "Privacy issues arise from collecting large amounts of student data." },
      { key: "D", text: "Teachers might lose their jobs to AI systems." },
    ],
    answer: "C",
    analysis: "第 9-10 句：privacy concerns remain, as these platforms collect vast amounts of student data。Dr. Chen calls for stricter regulations。C 概括了这两句。",
    evidenceSentences: [9, 10],
  },
];

const cet6WritingQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to write an essay commenting on the remark \"Technology is a useful servant but a dangerous master.\" You should write at least 150 words but no more than 200 words.",
    directions: "请围绕以下要点展开：\n1. 解释这句话的含义\n2. 以教育领域的 AI 应用为例论证\n3. 给出你的观点和建议",
    reference:
      "【参考范文】\nTechnology: Servant or Master?\n\nThe remark \"Technology is a useful servant but a dangerous master\" reveals a fundamental truth about our relationship with innovation: tools should serve human purposes, not dictate them.\n\nNowhere is this tension clearer than in education. Artificial intelligence has brought remarkable benefits — intelligent tutoring systems offer personalized practice, and automated grading frees teachers to focus on mentoring. Yet when technology becomes the master, problems emerge. Students may over-rely on AI-generated answers and lose the ability to think independently. Worse, algorithms can reinforce bias and erode data privacy.\n\nIn my view, the solution lies in human-centered design. Schools should treat AI as an assistant, not a replacement. Teachers must guide students to use technology critically, while policymakers safeguard privacy. Only when technology remains a faithful servant can education truly flourish.\n\n（约 175 词）",
  },
];

const cet6TranslationQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to translate the following passage into English.",
    directions: "近年来，人工智能（artificial intelligence）在教育领域的应用日益广泛。从智能辅导系统到自动批改作业，AI 技术正在改变传统的教学方式。然而，专家指出，技术应该服务于教育目标，而不是主导教育。教师的角色不仅仅是传授知识，更重要的是激发学生的好奇心和创造力。因此，在拥抱技术的同时，我们也需要警惕其可能带来的风险，如数据隐私和学生过度依赖等问题。",
    reference:
      "【参考译文】\nIn recent years, the application of artificial intelligence in education has become increasingly widespread. From intelligent tutoring systems to automated assignment grading, AI technology is transforming traditional teaching methods. However, experts point out that technology should serve educational goals rather than dominate education. The role of teachers is not merely to impart knowledge; more importantly, it is to stimulate students' curiosity and creativity. Therefore, while embracing technology, we also need to be alert to the potential risks it may bring, such as data privacy and excessive student dependence.\n\n【要点提示】\n- 日益广泛：increasingly widespread\n- 智能辅导系统：intelligent tutoring systems\n- 自动批改作业：automated assignment grading\n- 传授知识：impart knowledge\n- 激发好奇心和创造力：stimulate curiosity and creativity\n- 警惕风险：be alert to risks",
  },
];

const cet6Passage: SeedPassage = {
  title: "The Hidden Cost of Convenience",
  paragraphs: [
    {
      label: "A",
      text: "A twenty-minute delivery promise sounds like pure progress. It saves a cook from shopping, a parent from preparing dinner, a student from leaving the dormitory. Yet every promise of speed is paid for somewhere, and the bill rarely appears on the receipt. In Chinese cities the food-delivery industry now employs millions of riders and serves hundreds of millions of customers. The convenience is real, and so is the cost.",
    },
    {
      label: "B",
      text: "The most visible cost is borne by the riders themselves. Pay is tied to completed orders, so time becomes income, and traffic rules become negotiable. Studies of delivery workers in several large cities found that a majority had experienced an accident or a near miss in the previous year. Platforms have responded with \"flexible\" scheduling and safety reminders, but the arithmetic of the job — more orders, less time — remains unchanged. A reminder cannot compete with a rent payment.",
    },
    {
      label: "C",
      text: "Less visible is the cost to the neighbourhood. A restaurant that once relied on regulars now depends on an algorithm's ranking; a shop that cannot afford commission fees slowly disappears. Streets that once held small groceries and cheap noodle stands are increasingly lined with the dark storefronts of \"ghost kitchens\" that serve no walk-in customers at all. The variety that made a district pleasant to live in is not anyone's business model, so no one is paid to protect it.",
    },
    {
      label: "D",
      text: "Then there is the waste. Each order arrives in a plastic box, a bag, a pair of disposable chopsticks, often wrapped twice for a meal that takes eight minutes to eat. Municipal waste systems were not designed for this volume. Some cities have begun requiring recyclable packaging, and a few platforms now offer a \"no cutlery\" option that most customers click past without reading.",
    },
    {
      label: "E",
      text: "None of this argues for giving up delivery, which supports incomes and genuinely helps people whose time is scarce. It argues for seeing the price clearly. Consumers who understand what a twenty-minute promise costs — in risk, in neighbourhoods, in waste — can ask for better terms, and platforms that compete on safety and packaging rather than speed alone would find customers waiting. Convenience is not free; it is only invisible.",
    },
  ],
  questions: [
    {
      number: 51,
      stem: "Why does the author say traffic rules become \"negotiable\" for riders?",
      options: [
        { key: "A", text: "Because platforms pay them a fixed monthly salary." },
        { key: "B", text: "Because their income depends on how many orders they finish in time." },
        { key: "C", text: "Because traffic police rarely stop delivery bikes." },
        { key: "D", text: "Because riders are not required to hold a driving licence." },
      ],
      answer: "B",
      analysis:
        "细节题，B 段第二句：Pay is tied to completed orders, so time becomes income, and traffic rules become negotiable。因果链是「计件收入 → 时间即金钱 → 规则可商量」，B 项把这个链条完整还原。",
      optionAnalysis: {
        A: "与 pay is tied to completed orders（计件）直接矛盾，固定月薪恰恰不会逼人抢时间。",
        B: "正确。对应「Pay is tied to completed orders, so time becomes income」。",
        C: "执法力度原文未提，属常识性干扰。",
        D: "驾照要求原文未提。",
      },
      evidencePara: "B",
      evidenceText:
        "Pay is tied to completed orders, so time becomes income, and traffic rules become negotiable",
      type: "细节题",
    },
    {
      number: 52,
      stem: "What happens to small shops that cannot afford commission fees?",
      options: [
        { key: "A", text: "They move to cheaper districts of the city." },
        { key: "B", text: "They are taken over by the delivery platforms." },
        { key: "C", text: "They gradually disappear from the neighbourhood." },
        { key: "D", text: "They start serving only walk-in customers." },
      ],
      answer: "C",
      analysis:
        "细节题。C 段分号后一句：a shop that cannot afford commission fees slowly disappears。C 项几乎是原句照搬（slowly disappears → gradually disappear）。",
      optionAnalysis: {
        A: "「搬去便宜地段」原文未提，属于合理但无据的推测。",
        B: "「被平台收购」原文未提。",
        C: "正确。对应「a shop that cannot afford commission fees slowly disappears」。",
        D: "把 ghost kitchens 的「不接待到店客」错安到这些小店身上，属于张冠李戴。",
      },
      evidencePara: "C",
      evidenceText: "a shop that cannot afford commission fees slowly disappears",
      type: "细节题",
    },
    {
      number: 53,
      stem: "What does the author imply about \"ghost kitchens\"?",
      options: [
        { key: "A", text: "They offer a wider variety of food than traditional shops." },
        { key: "B", text: "They add little to the street life of a district." },
        { key: "C", text: "They are more strictly regulated than ordinary restaurants." },
        { key: "D", text: "They mainly serve residents living nearby." },
      ],
      answer: "B",
      analysis:
        "推断题。C 段先描述 ghost kitchens 只有 dark storefronts、serve no walk-in customers，接着感叹 variety 消失、没人有动力保护它。合起来暗示这类厨房对街区生活几乎没有贡献，只是「线上出餐口」。",
      optionAnalysis: {
        A: "原文说 variety 正在消失，A 方向相反。",
        B: "正确。由「dark storefronts」「serve no walk-in customers」「variety... is not anyone's business model」推出。",
        C: "监管强弱原文未提。",
        D: "它们服务的是线上下单的顾客，而不是附近居民，D 与 serve no walk-in customers 冲突。",
      },
      evidencePara: "C",
      evidenceText:
        "the dark storefronts of \"ghost kitchens\" that serve no walk-in customers at all",
      type: "推断题",
    },
    {
      number: 54,
      stem: "What have some cities begun to require?",
      options: [
        { key: "A", text: "That platforms limit the number of orders per rider." },
        { key: "B", text: "That restaurants display their commission rates." },
        { key: "C", text: "That delivery packaging be recyclable." },
        { key: "D", text: "That customers pay a separate waste fee." },
      ],
      answer: "C",
      analysis:
        "细节题，D 段第三句：Some cities have begun requiring recyclable packaging。直接对应，无改写难度，属于送分题。",
      optionAnalysis: {
        A: "限单量原文未提，这是平台规则不是城市要求。",
        B: "公示佣金原文未提。",
        C: "正确。对应「Some cities have begun requiring recyclable packaging」。",
        D: "向顾客收垃圾费原文未提。",
      },
      evidencePara: "D",
      evidenceText: "Some cities have begun requiring recyclable packaging",
      type: "细节题",
    },
    {
      number: 55,
      stem: "What is the author's attitude towards food delivery?",
      options: [
        { key: "A", text: "It should be restricted in order to reduce waste." },
        { key: "B", text: "It is a passing trend that will soon fade away." },
        { key: "C", text: "It brings real benefits, but its costs should be made clear." },
        { key: "D", text: "It is mainly responsible for the decline of urban life." },
      ],
      answer: "C",
      analysis:
        "态度题。末段首句明确否定「放弃」：None of this argues for giving up delivery, which supports incomes and genuinely helps...；紧接一句 It argues for seeing the price clearly。既不否定价值，也要求正视代价，这是典型的「平衡/审慎」态度。",
      optionAnalysis: {
        A: "作者明确说 None of this argues for giving up delivery，A 与立场相反。",
        B: "「昙花一现」原文毫无依据，作者反而认为消费者可以要求更好条件。",
        C: "正确。对应「genuinely helps」+「It argues for seeing the price clearly」。",
        D: "归因过度。作者只谈成本被忽略，没有把城市衰退全归给外卖。",
      },
      evidencePara: "E",
      evidenceText:
        "None of this argues for giving up delivery... It argues for seeing the price clearly.",
      type: "态度题",
    },
  ],
};

/* --- CET6 阅读第二篇：远程办公的未来 --- */
const cet6Passage2: SeedPassage = {
  title: "The Future of Remote Work",
  paragraphs: [
    {
      label: "A",
      text: "The COVID-19 pandemic forced millions of white-collar workers into an unprecedented experiment: working from home. What began as a temporary emergency measure has, for many, become a permanent arrangement. Companies that once insisted on daily office attendance now embrace hybrid or fully remote models, and employees have come to value the flexibility that comes with it.",
    },
    {
      label: "B",
      text: "The benefits are well documented. A 2024 Stanford study of 16,000 employees found that remote workers were 13% more productive than their office-based counterparts, largely due to fewer distractions and reduced commute times. Employees also reported higher job satisfaction and lower turnover, which translates into significant cost savings for employers.",
    },
    {
      label: "C",
      text: "Yet remote work is not without challenges. Many employees struggle with isolation and blurred boundaries between work and personal life. Without the informal interactions of an office, collaboration can become slower and creativity may suffer. Junior employees, in particular, miss out on the spontaneous mentoring that happens naturally when colleagues work side by side.",
    },
    {
      label: "D",
      text: "The hybrid model — combining days in the office with days at home — has emerged as a compromise. Proponents argue that it captures the best of both worlds: focused, uninterrupted work at home and collaborative, relationship-building time in the office. However, critics point out that hybrid schedules can create new inequalities, as remote days are viewed as less committed by some managers.",
    },
    {
      label: "E",
      text: "Ultimately, the future of work will likely not be a one-size-fits-all solution. Different industries, roles, and individuals will gravitate toward different arrangements. What is clear is that the genie is out of the bottle: employees have tasted flexibility and are unlikely to give it up willingly. Companies that adapt will attract talent; those that resist may find themselves at a competitive disadvantage.",
    },
  ],
  questions: [
    {
      number: 51,
      stem: "What does the Stanford study suggest about remote work?",
      options: [
        { key: "A", text: "It reduces productivity due to lack of supervision." },
        { key: "B", text: "It increases productivity by 13% mainly through fewer distractions." },
        { key: "C", text: "It has no measurable effect on productivity." },
        { key: "D", text: "It only works for senior employees." },
      ],
      answer: "B",
      analysis: "细节题。B 段第二句：remote workers were 13% more productive... largely due to fewer distractions and reduced commute times。B 准确对应。",
      optionAnalysis: {
        A: "与原文相反，原文说生产力提升。",
        B: "正确。13% more productive + fewer distractions。",
        C: "与原文相反。",
        D: "only for senior 原文未提。",
      },
      evidencePara: "B",
      evidenceText: "remote workers were 13% more productive than their office-based counterparts, largely due to fewer distractions",
      type: "细节题",
    },
    {
      number: 52,
      stem: "According to Paragraph C, what is a disadvantage of remote work for junior employees?",
      options: [
        { key: "A", text: "They earn less than office workers." },
        { key: "B", text: "They miss informal mentoring opportunities." },
        { key: "C", text: "They have to work longer hours." },
        { key: "D", text: "They cannot use company equipment." },
      ],
      answer: "B",
      analysis: "细节题。C 段末句：Junior employees, in particular, miss out on the spontaneous mentoring that happens naturally when colleagues work side by side。B 直接对应。",
      optionAnalysis: {
        A: "薪资原文未提。",
        B: "正确。miss out on the spontaneous mentoring。",
        C: "更长工时原文未提。",
        D: "设备原文未提。",
      },
      evidencePara: "C",
      evidenceText: "Junior employees... miss out on the spontaneous mentoring",
      type: "细节题",
    },
    {
      number: 53,
      stem: "What is the main criticism of the hybrid model mentioned in the passage?",
      options: [
        { key: "A", text: "It is too expensive for small companies." },
        { key: "B", text: "It requires advanced technology that most firms lack." },
        { key: "C", text: "It may create inequalities because remote days are seen as less committed." },
        { key: "D", text: "It reduces productivity more than fully remote work." },
      ],
      answer: "C",
      analysis: "细节题。D 段末句：critics point out that hybrid schedules can create new inequalities, as remote days are viewed as less committed by some managers。C 完整对应。",
      optionAnalysis: {
        A: "成本原文未提。",
        B: "技术门槛原文未提。",
        C: "正确。create new inequalities + viewed as less committed。",
        D: "与 B 段数据矛盾，且原文未比较 hybrid 和 fully remote。",
      },
      evidencePara: "D",
      evidenceText: "hybrid schedules can create new inequalities, as remote days are viewed as less committed by some managers",
      type: "细节题",
    },
    {
      number: 54,
      stem: "What does the author mean by \"the genie is out of the bottle\" in the last paragraph?",
      options: [
        { key: "A", text: "Remote work cannot be easily reversed now that employees have experienced it." },
        { key: "B", text: "Companies have lost control over their employees' schedules." },
        { key: "C", text: "Technology has made office work completely obsolete." },
        { key: "D", text: "Employees are now demanding higher salaries." },
      ],
      answer: "A",
      analysis: "语义/推断题。E 段：employees have tasted flexibility and are unlikely to give it up willingly。这是对『精灵出了瓶子』的解释——一旦放出就收不回去，即远程办公难以逆转。",
      optionAnalysis: {
        A: "正确。tasted flexibility + unlikely to give up = 难以逆转。",
        B: "lost control 过度推断，原文只说员工不愿放弃弹性。",
        C: "completely obsolete 绝对化，原文未说办公室工作消亡。",
        D: "要求加薪原文未提。",
      },
      evidencePara: "E",
      evidenceText: "employees have tasted flexibility and are unlikely to give it up willingly",
      type: "推断题",
    },
    {
      number: 55,
      stem: "What is the author's overall conclusion about the future of work?",
      options: [
        { key: "A", text: "Fully remote work will become the universal standard." },
        { key: "B", text: "The office will disappear within a decade." },
        { key: "C", text: "There is no single solution; flexible arrangements will vary by context." },
        { key: "D", text: "Companies should mandate a return to the office to remain competitive." },
      ],
      answer: "C",
      analysis: "主旨/态度题。E 段首句：the future of work will likely not be a one-size-fits-all solution. Different industries, roles, and individuals will gravitate toward different arrangements。C 准确概括。",
      optionAnalysis: {
        A: "universal standard 与 not one-size-fits-all 相反。",
        B: "disappear 绝对化，原文未说。",
        C: "正确。no single solution + vary by context。",
        D: "与末句 Companies that adapt will attract talent 相反，应适应而非强制回办公室。",
      },
      evidencePara: "E",
      evidenceText: "the future of work will likely not be a one-size-fits-all solution. Different industries, roles, and individuals will gravitate toward different arrangements",
      type: "主旨题",
    },
  ],
};

/* ============================ 落库 ============================ */

async function seedPaper(input: {
  id: string;
  title: string;
  level: string;
  year: number;
  month: number;
  sort: number;
  totalTime: number;
  /** 阅读 Section 可包含多篇 passage */
  passages: SeedPassage[];
  listeningTranscript: SeedTranscriptLine[];
  listeningQuestions: SeedListeningQuestion[];
  writingQuestions: SeedWritingQuestion[];
  translationQuestions: SeedWritingQuestion[];
}) {
  await prisma.paper.deleteMany({ where: { id: input.id } });

  await prisma.paper.create({
    data: {
      id: input.id,
      title: input.title,
      level: input.level,
      year: input.year,
      month: input.month,
      sort: input.sort,
      sections: {
        create: [
          // 写作
          {
            id: `${input.id}-sec-writing`,
            order: 1,
            type: "writing",
            title: "Section I 写作",
            timeLimit: 30,
            passages: {
              create: [{
                id: `${input.id}-p-writing`,
                paperId: input.id,
                order: 1,
                title: "写作",
                paragraphs: "[]",
                questions: {
                  create: input.writingQuestions.map((q, i) => ({
                    id: `${input.id}-q-write-${i}`,
                    order: i + 1,
                    number: q.number,
                    stem: `${q.stem}\n\n${q.directions}`,
                    options: "[]",
                    answer: "",
                    // 参考范文存在 analysis 字段，前端"参考要点"直接展示
                    analysis: q.reference,
                    type: "writing",
                  })),
                },
              }],
            },
          },
          // 听力
          {
            id: `${input.id}-sec-listening`,
            order: 2,
            type: "listening",
            title: "Section II 听力",
            timeLimit: input.level === "CET4" ? 25 : 30,
            passages: {
              create: [{
                id: `${input.id}-p-listening`,
                paperId: input.id,
                order: 1,
                title: "短篇新闻",
                paragraphs: "[]",
                // audioUrl 占位，后续放入公开授权音频文件
                audioUrl: null,
                audioDuration: 56,
                transcript: JSON.stringify(input.listeningTranscript),
                questions: {
                  create: input.listeningQuestions.map((q, i) => ({
                    id: `${input.id}-q-listen-${q.number}`,
                    order: i + 1,
                    number: q.number,
                    stem: q.stem,
                    options: JSON.stringify(q.options),
                    answer: q.answer,
                    analysis: q.analysis,
                    evidenceSentences: JSON.stringify(q.evidenceSentences),
                    type: "listening",
                  })),
                },
              }],
            },
          },
          // 阅读（支持多篇 passage）
          {
            id: `${input.id}-sec-reading`,
            order: 3,
            type: "reading",
            title: "Section III 仔细阅读",
            timeLimit: 40,
            passages: {
              create: input.passages.map((p, pIndex) => ({
                id: `${input.id}-p${pIndex + 1}`,
                paperId: input.id,
                order: pIndex + 1,
                title: p.title,
                paragraphs: JSON.stringify(p.paragraphs),
                questions: {
                  create: p.questions.map((q, index) => ({
                    id: `${input.id}-p${pIndex + 1}-q${q.number}`,
                    order: index + 1,
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
              })),
            },
          },
          // 翻译
          {
            id: `${input.id}-sec-translation`,
            order: 4,
            type: "translation",
            title: "Section IV 翻译",
            timeLimit: 30,
            passages: {
              create: [{
                id: `${input.id}-p-translation`,
                paperId: input.id,
                order: 1,
                title: "翻译",
                paragraphs: "[]",
                questions: {
                  create: input.translationQuestions.map((q, i) => ({
                    id: `${input.id}-q-trans-${i}`,
                    order: i + 1,
                    number: q.number,
                    stem: `${q.stem}\n\n${q.directions}`,
                    options: "[]",
                    answer: "",
                    // 参考译文存在 analysis 字段，前端"参考要点"直接展示
                    analysis: q.reference,
                    type: "translation",
                  })),
                },
              }],
            },
          },
        ],
      },
    },
  });
  const readingQs = input.passages.reduce((sum, p) => sum + p.questions.length, 0);
  const totalQs = readingQs + input.listeningQuestions.length + input.writingQuestions.length + input.translationQuestions.length;
  console.log(`  ✓ ${input.title}（4 Section / ${totalQs} 题）`);
}

async function seedUsers() {
  const password = await bcrypt.hash("demo1234", 10);
  const accounts = [
    { id: "user-demo", email: "demo@cet.local", name: "小明" },
    { id: "user-alice", email: "alice@cet.local", name: "Alice" },
  ];

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: { ...account, password },
      update: { password, name: account.name },
    });
    console.log(`  ✓ ${account.email} / demo1234`);
  }
}

async function main() {
  console.log("→ 写入演示账号");
  await seedUsers();

  console.log("→ 写入试卷");
  await seedPaper({
    id: "paper-cet4-2024-12",
    title: "2024年12月 四级 完整套卷",
    level: "CET4",
    year: 2024,
    month: 12,
    sort: 1,
    totalTime: 125,
    passages: [cet4Passage, cet4Passage2],
    listeningTranscript: cet4ListeningTranscript,
    listeningQuestions: cet4ListeningQuestions,
    writingQuestions: cet4WritingQuestions,
    translationQuestions: cet4TranslationQuestions,
  });
  await seedPaper({
    id: "paper-cet6-2024-06",
    title: "2024年6月 六级 完整套卷",
    level: "CET6",
    year: 2024,
    month: 6,
    sort: 2,
    totalTime: 130,
    passages: [cet6Passage, cet6Passage2],
    listeningTranscript: cet6ListeningTranscript,
    listeningQuestions: cet6ListeningQuestions,
    writingQuestions: cet6WritingQuestions,
    translationQuestions: cet6TranslationQuestions,
  });

  const paperCount = await prisma.paper.count();
  const sectionCount = await prisma.section.count();
  const questionCount = await prisma.question.count();
  console.log(`\n完成：${paperCount} 套试卷 / ${sectionCount} 个 Section / ${questionCount} 道题`);
}

main()
  .catch((error) => {
    console.error("种子数据写入失败：", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
