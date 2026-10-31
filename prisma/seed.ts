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
  },
];

/* --- CET4 翻译 --- */
const cet4TranslationQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to translate the following passage into English.",
    directions: "在中国，书法（calligraphy）自古以来被视为一种高雅的艺术形式。许多人认为，练习书法不仅能培养耐心，还能提高专注力。尽管现代人更多地使用电脑和手机打字，但仍有不少人坚持每天手写。他们相信，手写是一种与内心对话的方式，有助于在快节奏的生活中找到平静。",
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
  },
];

const cet6TranslationQuestions: SeedWritingQuestion[] = [
  {
    number: 1,
    stem: "For this part, you are allowed 30 minutes to translate the following passage into English.",
    directions: "近年来，人工智能（artificial intelligence）在教育领域的应用日益广泛。从智能辅导系统到自动批改作业，AI 技术正在改变传统的教学方式。然而，专家指出，技术应该服务于教育目标，而不是主导教育。教师的角色不仅仅是传授知识，更重要的是激发学生的好奇心和创造力。因此，在拥抱技术的同时，我们也需要警惕其可能带来的风险，如数据隐私和学生过度依赖等问题。",
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

/* ============================ 落库 ============================ */

async function seedPaper(input: {
  id: string;
  title: string;
  level: string;
  year: number;
  month: number;
  sort: number;
  totalTime: number;
  passage: SeedPassage;
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
      totalTime: input.totalTime,
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
                    analysis: "写作题为开放式作答，无标准答案。",
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
          // 阅读
          {
            id: `${input.id}-sec-reading`,
            order: 3,
            type: "reading",
            title: "Section III 仔细阅读",
            timeLimit: 40,
            passages: {
              create: [{
                id: `${input.id}-p1`,
                order: 1,
                title: input.passage.title,
                paragraphs: JSON.stringify(input.passage.paragraphs),
                questions: {
                  create: input.passage.questions.map((q, index) => ({
                    id: `${input.id}-q${q.number}`,
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
              }],
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
                    analysis: "翻译为开放式作答，无标准答案。",
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
  const totalQs = input.passage.questions.length + input.listeningQuestions.length + input.writingQuestions.length + input.translationQuestions.length;
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
    passage: cet4Passage,
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
    passage: cet6Passage,
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
