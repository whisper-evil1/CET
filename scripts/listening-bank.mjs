/**
 * 听力材料题库（仿真，非官方原题）。
 *
 * 为什么要有这个文件：卷库里 66 套正文原本只写了阅读/写作/翻译，
 * 听力 Section 是空壳（0 篇 passage），用户点进去"内容不完整"。
 * 官方听力音频受版权保护、只在授权站点以"仅供个人学习"分发，不能打包进本站，
 * 所以这里提供**可朗读的文本**：前端用语音合成现场读出来，音频不落地、无版权风险。
 *
 * 结构约定（必须满足 CET 听力题量 25）：
 *   - NEWS 里带 3 题的与带 2 题的各有若干：三段新闻按 3+2+2 = 7 题组合（1–7）
 *   - CONVERSATIONS 每段 4 题：两段 = 8 题（8–15）
 *   - PASSAGES 带 4 题的与带 3 题的各有若干：按 4+3+3 = 10 题组合（16–25）
 *
 * 题号由 scripts/gen-listening.mjs 统一重排，这里只按材料顺序写。
 */

const opt = (a, b, c, d) => [
  { key: "A", text: a },
  { key: "B", text: b },
  { key: "C", text: c },
  { key: "D", text: d },
];

/** 每行一句，前端逐句高亮朗读；text 里不要带题号，朗读时会被念出来 */
export const NEWS = [
  {
    id: "n1",
    title: "News Report One",
    lines: [
      "A university library in the north of England has decided to keep its reading rooms open around the clock during the exam season.",
      "The pilot scheme began three weeks ago and has already attracted more than two thousand visits between midnight and six in the morning.",
      "Library staff say most of the night visitors are postgraduate students working on long projects, although a surprising number are first-year students who prefer the quiet to their shared flats.",
      "The university will review the cost of lighting, heating and security in January, but a spokesman said the early figures were far lower than expected because the building was already heated for the computer centre next door.",
      "Students have asked for one change: a small kitchen, so that they do not have to leave the building to eat.",
    ],
    questions: [
      {
        stem: "What does the news report say about the university library?",
        options: opt(
          "It has extended its opening hours during exams.",
          "It has moved into a new building.",
          "It has closed its computer centre.",
          "It has cut the number of staff.",
        ),
        answer: "A",
        analysis: "首句即点明：考试季期间阅览室 24 小时开放，属于延长开放时间，其余三项均未提及。",
      },
      {
        stem: "Who makes up most of the night visitors?",
        options: opt(
          "First-year students living at home.",
          "Postgraduate students working on long projects.",
          "Members of the public.",
          "Library staff on duty.",
        ),
        answer: "B",
        analysis: "原文说大多数夜间来客是「working on long projects」的研究生，本科生只是「a surprising number」，不构成主体。",
      },
      {
        stem: "What have students asked the library to provide?",
        options: opt(
          "More printing machines.",
          "Longer opening hours at weekends.",
          "A small kitchen.",
          "More group discussion rooms.",
        ),
        answer: "C",
        analysis: "末句明确：学生只提了一个要求——一间小厨房，免得为了吃饭离开大楼。",
      },
    ],
  },
  {
    id: "n2",
    title: "News Report Two",
    lines: [
      "A city council has voted to keep its largest public park open until eleven at night instead of the current eight.",
      "The change follows a survey in which seventy per cent of residents said they would use the park in the evening if they felt it was safe.",
      "To pay for extra lighting and two additional security patrols, the council will charge owners of the park's three cafés a small annual fee.",
      "Some neighbours opposed the plan, arguing that late-night noise would disturb families living beside the main gate.",
      "The new hours will be tested for six months starting in April.",
    ],
    questions: [
      {
        stem: "What change will the city council make to the park?",
        options: opt(
          "It will close the park earlier.",
          "It will keep the park open until eleven at night.",
          "It will build a new café in the park.",
          "It will charge visitors an entrance fee.",
        ),
        answer: "B",
        analysis: "新闻首句给出结论：闭园时间从晚八点延后到十一点，费用只向园内咖啡馆收取，不是门票。",
      },
      {
        stem: "Why did some neighbours oppose the plan?",
        options: opt(
          "They feared late-night noise.",
          "They thought the park was too small.",
          "They wanted more parking spaces.",
          "They were not consulted.",
        ),
        answer: "A",
        analysis: "原文提到反对者担心深夜噪音打扰住在正门旁的家庭，其余选项均无依据。",
      },
    ],
  },
  {
    id: "n3",
    title: "News Report Three",
    lines: [
      "A supermarket chain in Denmark is testing a scheme that sells food close to its expiry date at half price.",
      "The items are marked with a yellow sticker and placed on a shelf at the front of each store rather than being thrown away at closing time.",
      "In the first two months the chain reports that food waste has fallen by nearly a third in the thirty shops taking part.",
      "Managers say the biggest surprise is who buys the discounted food: not students, as they had expected, but families doing their weekly shop.",
      "The chain now plans to add bread and dairy products to the scheme, which so far covers only fruit, vegetables and ready meals.",
    ],
    questions: [
      {
        stem: "What is the supermarket chain doing with food close to its expiry date?",
        options: opt(
          "Throwing it away at closing time.",
          "Selling it at half price.",
          "Giving it to staff for free.",
          "Sending it back to suppliers.",
        ),
        answer: "B",
        analysis: "首句说明方案内容：临近保质期的食品半价出售，并贴黄色标签摆在前排货架。",
      },
      {
        stem: "Who turns out to be the main buyer of the discounted food?",
        options: opt(
          "Students living alone.",
          "Restaurant owners.",
          "Families doing their weekly shop.",
          "Supermarket employees.",
        ),
        answer: "C",
        analysis: "原文说最大意外是买折扣食品的主要是「families doing their weekly shop」，而非预期的学生。",
      },
      {
        stem: "What will the chain do next?",
        options: opt(
          "Close thirty of its shops.",
          "Stop the scheme because of losses.",
          "Add bread and dairy products to the scheme.",
          "Lower the discount to twenty per cent.",
        ),
        answer: "C",
        analysis: "末句：下一步把面包和乳制品纳入，目前只覆盖水果、蔬菜和即食餐。",
      },
    ],
  },
  {
    id: "n4",
    title: "News Report Four",
    lines: [
      "A small town in northern Italy has spent eight years turning its disused railway station into a community centre.",
      "The building had been empty since 1998, when the line to the coast was closed.",
      "Local volunteers repaired the roof and the wooden waiting room themselves, while the regional government paid for a new heating system.",
      "The centre now houses a nursery, a small library and a workshop where retired railway workers teach teenagers how to repair bicycles.",
      "The mayor says the project cost less than a fifth of the estimate for demolishing the station and building something new.",
    ],
    questions: [
      {
        stem: "How long did the town spend on the project?",
        options: opt("Three years.", "Five years.", "Eight years.", "Twelve years."),
        answer: "C",
        analysis: "首句给出时长：用了八年把废弃火车站改造成社区中心，注意与「1998 年停用」区分。",
      },
      {
        stem: "What does the community centre now contain?",
        options: opt(
          "A hotel and a restaurant.",
          "A nursery, a library and a bicycle workshop.",
          "A railway museum only.",
          "A supermarket and a car park.",
        ),
        answer: "B",
        analysis: "原文列举：托儿所、小型图书馆，以及退休铁路工人教青少年修自行车的作坊。",
      },
    ],
  },
  {
    id: "n5",
    title: "News Report Five",
    lines: [
      "A secondary school in Finland has reported the results of a one-year trial that banned mobile phones during lessons and breaks.",
      "Teachers said they had expected better concentration in class, and they got it.",
      "What they did not expect was a change during the breaks: students talked to each other more, and the number of students eating alone fell sharply.",
      "The school will keep the ban but will allow phones in the library for research.",
      "Two neighbouring schools have said they will start similar trials next term.",
    ],
    questions: [
      {
        stem: "What was the result of the phone ban in class?",
        options: opt(
          "Students concentrated better.",
          "Students stopped doing homework.",
          "Teachers had more work to do.",
          "Test scores fell sharply.",
        ),
        answer: "A",
        analysis: "教师预期课堂专注度提升，结果「and they got it」，说明课堂注意力确实变好。",
      },
      {
        stem: "What unexpected change happened during the breaks?",
        options: opt(
          "Students left the school grounds.",
          "Students talked to each other more.",
          "The school day became shorter.",
          "Fewer students came to school.",
        ),
        answer: "B",
        analysis: "原文强调意外之处在课间：学生彼此交流变多，独自吃饭的人数明显下降。",
      },
    ],
  },
  {
    id: "n6",
    title: "News Report Six",
    lines: [
      "A software company in New Zealand has finished a two-year experiment with a four-day working week and has decided to make it permanent.",
      "Staff work thirty-two hours instead of forty and keep the same salary.",
      "The company says productivity, measured by the number of projects completed, rose by about twenty per cent.",
      "Managers believe the gain came not from working faster but from cutting meetings: the average meeting now lasts twenty minutes instead of an hour.",
      "Not every part of the business benefited. Customer support had to hire two extra people to cover Friday, when the office is now closed.",
    ],
    questions: [
      {
        stem: "What has the company decided to do?",
        options: opt(
          "Return to a five-day week.",
          "Make the four-day week permanent.",
          "Cut salaries by twenty per cent.",
          "Close its customer support team.",
        ),
        answer: "B",
        analysis: "新闻开头即给出结论：两年试验结束后决定把四天工作制永久化，薪资不变。",
      },
      {
        stem: "Where did the productivity gain mainly come from?",
        options: opt(
          "Hiring more managers.",
          "Working faster than before.",
          "Cutting the length of meetings.",
          "Using new software.",
        ),
        answer: "C",
        analysis: "原文明确「not from working faster but from cutting meetings」，会议从一小时压到二十分钟。",
      },
      {
        stem: "What problem did the change create?",
        options: opt(
          "Customer support needed extra staff for Friday.",
          "Staff refused to accept the same salary.",
          "Projects took longer to finish.",
          "The office became too crowded.",
        ),
        answer: "A",
        analysis: "末句转折：并非所有部门都受益，客服为覆盖周五（办公室关闭）要多招两人。",
      },
    ],
  },
];

export const CONVERSATIONS = [
  {
    id: "c1",
    title: "Conversation One",
    lines: [
      "Woman: Professor Hale, do you have a minute? I want to change my dissertation topic.",
      "Man: You are three months in, Anna. What happened?",
      "Woman: I wanted to study how tourists use city parks, but the council refused to give me the visitor data. Without it the whole thing falls apart.",
      "Man: Right. Have you considered using photographs instead? People post thousands of park pictures, and the time and place are usually recorded.",
      "Woman: I did think about that, but I am not sure I can handle that much data on my own.",
      "Man: You would not be on your own. Doctor Ellis in the computing department has a tool that sorts images by location. I can introduce you.",
      "Woman: That would help a lot. But is changing the method acceptable at this stage?",
      "Man: Changing the method is fine. Changing the question at this stage is not. Keep parks and visitors, drop the council data.",
      "Woman: Understood. I will write a two-page plan and send it to you by Friday.",
    ],
    questions: [
      {
        stem: "Why does the woman want to change her topic?",
        options: opt(
          "She has lost interest in city parks.",
          "The council refused to give her the data.",
          "Her professor rejected her first plan.",
          "She cannot afford the research costs.",
        ),
        answer: "B",
        analysis: "女士说明原因：市议会拒绝提供游客数据，没有数据整个研究就无法进行。",
      },
      {
        stem: "What does the man suggest she use instead?",
        options: opt(
          "Interviews with park visitors.",
          "Photographs posted online.",
          "Newspaper reports about parks.",
          "The council's annual report.",
        ),
        answer: "B",
        analysis: "教授建议改用照片：人们上传大量公园照片，且通常带时间和地点信息。",
      },
      {
        stem: "What is the man's view about changing the method?",
        options: opt(
          "It is acceptable at this stage.",
          "It should be avoided at all costs.",
          "It requires the department's permission.",
          "It would waste the past three months.",
        ),
        answer: "A",
        analysis: "教授明确「Changing the method is fine」，但强调不能改研究问题，只能换方法。",
      },
      {
        stem: "What will the woman do by Friday?",
        options: opt(
          "Meet Doctor Ellis in person.",
          "Collect the council data again.",
          "Write a two-page plan.",
          "Present her findings to the class.",
        ),
        answer: "C",
        analysis: "对话结尾女士承诺周五前写一份两页的计划发给他。",
      },
    ],
  },
  {
    id: "c2",
    title: "Conversation Two",
    lines: [
      "Man: The electricity bill came. It is almost double what we paid last winter.",
      "Woman: Double? That cannot be right. We have not bought anything new.",
      "Man: Look at the second page. The heating is on from six in the morning until midnight, every day.",
      "Woman: That is because you work from home three days a week now. Last year the flat was empty all day.",
      "Man: Fair point. But you leave the window open when you cook.",
      "Woman: Only for ten minutes. Look, rather than arguing, let us split it by how many days each of us is actually here.",
      "Man: That is complicated. How about we each pay half, and I will pay the extra for the days I work from home?",
      "Woman: That sounds fair. And can we agree on a rule about the heating? Twenty degrees during the day, eighteen at night.",
      "Man: Agreed. I will set the timer tonight.",
    ],
    questions: [
      {
        stem: "What are the speakers mainly discussing?",
        options: opt(
          "How to reduce the rent.",
          "How to share a higher electricity bill.",
          "Whether to move to a new flat.",
          "How to repair the heating system.",
        ),
        answer: "B",
        analysis: "整段围绕电费翻倍后如何分摊展开，最终商定方案，并非讨论搬家或维修。",
      },
      {
        stem: "Why is the bill higher than last winter?",
        options: opt(
          "They bought new appliances.",
          "The price of electricity doubled.",
          "The heating runs all day because the man works from home.",
          "The flat has larger windows now.",
        ),
        answer: "C",
        analysis: "女士指出原因：男士现在每周三天在家办公，去年白天公寓是空的。",
      },
      {
        stem: "What does the woman suggest about the bill?",
        options: opt(
          "Splitting it by how many days each person is at home.",
          "Asking the landlord to pay part of it.",
          "Paying it from their savings.",
          "Refusing to pay until it is checked.",
        ),
        answer: "A",
        analysis: "女士提出按各人在家的天数分摊，男士认为太复杂，转而提出各付一半加补贴。",
      },
      {
        stem: "What do they finally agree on?",
        options: opt(
          "Moving the heating timer to the evening only.",
          "Paying half each plus an extra for home-working days.",
          "Keeping the window closed while cooking.",
          "Asking a third roommate to share the cost.",
        ),
        answer: "B",
        analysis: "最终方案：各付一半，男士为在家办公的天数多付一部分，并约定取暖温度。",
      },
    ],
  },
  {
    id: "c3",
    title: "Conversation Three",
    lines: [
      "Woman: Come in. You must be Daniel. I see you applied for the summer internship in our design team.",
      "Man: Yes. I am in my third year of product design, and I have done two freelance projects for small companies.",
      "Woman: Tell me about one of them.",
      "Man: I designed a booking system for a bicycle repair shop. The hard part was not the screen but getting the mechanics to use it. So I spent two days in the shop watching them work.",
      "Woman: Interesting. Most candidates talk about the software. What did you learn?",
      "Man: That the first version failed. They kept writing jobs on paper because typing took too long with dirty hands. The second version used big buttons and voice input.",
      "Woman: Good. The internship is ten weeks, starting on the first of July. It is paid, but not much. Is that a problem?",
      "Man: No. I mainly want to see how a real team works from brief to launch.",
      "Woman: Then I will send you the details on Monday.",
    ],
    questions: [
      {
        stem: "What is the man applying for?",
        options: opt(
          "A full-time job as a mechanic.",
          "A summer internship in a design team.",
          "A freelance project for a bicycle shop.",
          "A place on a master's course.",
        ),
        answer: "B",
        analysis: "女士开场即说明他申请的是设计团队暑期实习，男士是产品设计三年级学生。",
      },
      {
        stem: "What was difficult about his bicycle shop project?",
        options: opt(
          "Designing the screen layout.",
          "Getting the staff to actually use the system.",
          "Finding a company to pay for it.",
          "Meeting the deadline.",
        ),
        answer: "B",
        analysis: "男士强调难点不在界面，而在让修车师傅真正使用系统，因此他在店里观察了两天。",
      },
      {
        stem: "Why did the first version of the system fail?",
        options: opt(
          "It was too expensive.",
          "It crashed when many people used it.",
          "Typing took too long with dirty hands.",
          "The owner changed his mind.",
        ),
        answer: "C",
        analysis: "失败原因是师傅手脏、打字太慢，所以继续用纸记录；第二版改用大按钮和语音输入。",
      },
      {
        stem: "What does the man care most about in the internship?",
        options: opt(
          "The salary.",
          "The length of the programme.",
          "Seeing how a real team works from brief to launch.",
          "Getting a permanent contract afterwards.",
        ),
        answer: "C",
        analysis: "对薪资低并不介意，他主要想看到真实团队从需求到上线的完整流程。",
      },
    ],
  },
  {
    id: "c4",
    title: "Conversation Four",
    lines: [
      "Man: I am trying to book train tickets for the weekend of the twenty-second. The website says the morning trains are all full.",
      "Woman: All of them? That is unusual for a Saturday.",
      "Man: There is engineering work on the line, so they are running half the usual number of trains.",
      "Woman: Then take the coach. It takes about an hour longer, but it leaves from the station near your flat.",
      "Man: I thought about it, but I get sick on coaches.",
      "Woman: What about going on Friday evening instead? The six o'clock train still has seats, and you could stay with your sister.",
      "Man: She is away that week. I could go early on Saturday, though. There is a five forty train with seats.",
      "Woman: Five forty means leaving home at five. Are you sure?",
      "Man: If it means arriving by nine, yes. I will book it now before it goes too.",
    ],
    questions: [
      {
        stem: "Why are the morning trains full?",
        options: opt(
          "It is a public holiday.",
          "There is engineering work on the line.",
          "The website is broken.",
          "Tickets are cheaper that day.",
        ),
        answer: "B",
        analysis: "男士解释线路在施工，运行列车数量只有平时一半，所以上午班次很快售空。",
      },
      {
        stem: "Why does the man refuse to take the coach?",
        options: opt(
          "It is more expensive.",
          "It leaves too early.",
          "He gets sick on coaches.",
          "It does not go to his destination.",
        ),
        answer: "C",
        analysis: "他说坐长途汽车会晕车，因此拒绝了女士的替代建议。",
      },
      {
        stem: "Why can't he travel on Friday evening?",
        options: opt(
          "The six o'clock train is full.",
          "His sister is away that week.",
          "He has to work late on Friday.",
          "The station is closed on Friday.",
        ),
        answer: "B",
        analysis: "周五晚班次有座位，但姐姐那周不在家，无法借住，所以只能考虑周六早班。",
      },
      {
        stem: "What does the man decide to do?",
        options: opt(
          "Book the five forty train on Saturday.",
          "Wait for more tickets to be released.",
          "Travel by coach after all.",
          "Cancel the trip.",
        ),
        answer: "A",
        analysis: "他权衡后选择周六 5:40 的班次，能九点前到，并打算立刻订票。",
      },
    ],
  },
];

export const PASSAGES = [
  {
    id: "p1",
    title: "Passage One",
    lines: [
      "For years students have been told to study hard and sleep less before an exam. Research on memory suggests the opposite advice may be better.",
      "In one well-known experiment, two groups learned the same list of foreign words. One group studied in the morning and was tested in the evening. The other studied in the evening and slept before being tested the next morning.",
      "The second group remembered about twenty per cent more, although they had spent the same time studying.",
      "The reason is that during deep sleep the brain replays what we have just learned, moving it from short-term storage into longer-term memory. Without that replay, much of the material simply fades.",
      "This does not mean that sleep can replace study. Students who slept well but studied very little still performed badly. Sleep protects what has been learned; it does not create knowledge that was never there.",
    ],
    questions: [
      {
        stem: "What did the experiment compare?",
        options: opt(
          "Two ways of taking notes.",
          "Studying in the morning versus studying before sleep.",
          "Reading aloud versus reading silently.",
          "Two different groups of words.",
        ),
        answer: "B",
        analysis: "实验对比两组记同一份外语词表：一组早上学晚上测，一组晚上学、睡后再测。",
      },
      {
        stem: "What was the result for the group that slept before the test?",
        options: opt(
          "They remembered about twenty per cent more.",
          "They finished the test faster.",
          "They forgot almost everything.",
          "They made more spelling mistakes.",
        ),
        answer: "A",
        analysis: "原文给出数据：睡眠组多记住约百分之二十，学习时间相同。",
      },
      {
        stem: "What happens during deep sleep according to the passage?",
        options: opt(
          "The brain rests completely.",
          "The brain replays what was learned and stores it longer.",
          "The brain forgets unimportant details only.",
          "The brain produces new words.",
        ),
        answer: "B",
        analysis: "原文解释机制：深睡时大脑重放刚学的内容，把信息从短时记忆转入长时记忆。",
      },
      {
        stem: "What does the speaker warn against?",
        options: opt(
          "Studying in the evening.",
          "Taking tests in the morning.",
          "Thinking sleep can replace study.",
          "Learning too many words at once.",
        ),
        answer: "C",
        analysis: "末段明确：睡眠保护已学内容，但不能替代学习，学得太少仍考不好。",
      },
    ],
  },
  {
    id: "p2",
    title: "Passage Two",
    lines: [
      "When a city builds a protected bicycle lane, the first question people ask is whether it will cause traffic jams.",
      "Studies from several European cities suggest the opposite often happens. In one city, the number of people cycling to work doubled within three years of a new lane opening, and car traffic on the same street fell by nine per cent.",
      "The reason is not that drivers gave up their cars completely. Many of them simply chose a different route, or cycled on the days when the weather was good.",
      "The bigger effect was on safety. Accidents involving cyclists fell by almost half, and, more surprisingly, accidents involving pedestrians also fell, because the pavement was no longer used as a place to park bicycles.",
      "The lesson for city planners is that a bicycle lane is not only transport policy. It is also a public health measure and, in busy streets, the cheapest way to move more people through the same space.",
    ],
    questions: [
      {
        stem: "What do studies from European cities suggest?",
        options: opt(
          "Bicycle lanes usually cause worse traffic jams.",
          "Bicycle lanes often reduce car traffic.",
          "Few people use bicycle lanes in winter.",
          "Bicycle lanes are too expensive to build.",
        ),
        answer: "B",
        analysis: "研究显示相反结果：新自行车道开通三年内骑车通勤人数翻倍，同街汽车流量下降 9%。",
      },
      {
        stem: "What happened to accidents after the lane opened?",
        options: opt(
          "They stayed the same.",
          "Accidents involving cyclists fell by almost half.",
          "Only pedestrian accidents rose.",
          "They doubled in three years.",
        ),
        answer: "B",
        analysis: "原文给出：涉及骑行者的事故下降近一半，行人事故也下降，因为人行道不再被停车占用。",
      },
      {
        stem: "What is the speaker's main point about bicycle lanes?",
        options: opt(
          "They are mainly a health measure.",
          "They only help cyclists.",
          "They are not only transport policy but also public health policy.",
          "They should replace all car lanes.",
        ),
        answer: "C",
        analysis: "结尾总结：自行车道不只是交通政策，也是公共卫生措施，是繁忙街道最便宜的运力方案。",
      },
    ],
  },
  {
    id: "p3",
    title: "Passage Three",
    lines: [
      "When offices closed in 2020, many managers feared that teamwork would collapse. Five years on, the picture is more complicated.",
      "Surveys of software teams show that individual work, such as writing code or preparing a report, is often done faster at home. There are fewer interruptions and no commute.",
      "Team work is a different matter. Groups that met in person occasionally solved new and unclear problems faster than groups that only met online. When the task was routine, the difference disappeared.",
      "Researchers explain this by pointing to what happens in the gaps: the short conversations before a meeting starts, the questions asked while waiting for coffee. These exchanges share information that nobody thought to put in an email.",
      "The practical advice is not to bring everyone back to the office. It is to bring people together when the work is new, and to let them stay at home when the work is clear.",
    ],
    questions: [
      {
        stem: "What did managers fear in 2020?",
        options: opt(
          "That teamwork would collapse.",
          "That rents would rise.",
          "That staff would work too many hours.",
          "That software would fail.",
        ),
        answer: "A",
        analysis: "开篇说 2020 年办公室关闭时，管理者担心团队协作会崩溃，五年后情况更复杂。",
      },
      {
        stem: "Which kind of work is often done faster at home?",
        options: opt(
          "Solving unclear new problems.",
          "Individual work such as writing code.",
          "Training new employees.",
          "Negotiating with clients.",
        ),
        answer: "B",
        analysis: "调查显示写代码、写报告这类个人工作在家更快，因为干扰少、无需通勤。",
      },
      {
        stem: "When did in-person groups perform better?",
        options: opt(
          "When the task was routine.",
          "When the task was new and unclear.",
          "When the group was large.",
          "When the meeting was long.",
        ),
        answer: "B",
        analysis: "遇到新的、不清晰的问题时，线下见过面的团队解决得更快；任务常规时差别消失。",
      },
      {
        stem: "What is the speaker's practical advice?",
        options: opt(
          "Bring everyone back to the office full time.",
          "Keep everyone at home permanently.",
          "Meet in person for new work, stay home for clear work.",
          "Hold longer online meetings.",
        ),
        answer: "C",
        analysis: "结尾建议：工作新且模糊时聚到一起，工作明确时在家，而不是一刀切回办公室。",
      },
    ],
  },
  {
    id: "p4",
    title: "Passage Four",
    lines: [
      "Museums have been putting their collections online for twenty years, but until recently most of what they published was a photograph and a date.",
      "That is changing. Several large museums now publish the letters, notebooks and even the shopping lists that came with an object. Researchers have found that these ordinary papers often explain more than the object itself.",
      "One example is a wooden chair in a national collection. For decades the label said only that it was made in the eighteenth century. The family's letters revealed that the chair was the only piece of furniture they took with them when they moved to a smaller house, and that it was repaired three times rather than replaced.",
      "Visitors now stop in front of the chair far longer than before, because the story turns an example of a style into a decision made by a family with very little money.",
      "The lesson is simple: a collection becomes interesting when it is connected to the people who used it, not when it is simply catalogued.",
    ],
    questions: [
      {
        stem: "What did museums mainly publish online in the past?",
        options: opt(
          "Letters and notebooks.",
          "A photograph and a date.",
          "Video tours of exhibitions.",
          "Interviews with collectors.",
        ),
        answer: "B",
        analysis: "原文说过去二十年博物馆上线的内容大多是「一张照片和一个日期」，信息很少。",
      },
      {
        stem: "What did the family's letters reveal about the chair?",
        options: opt(
          "It was made in the twentieth century.",
          "It was the only furniture they took to a smaller house and was repaired three times.",
          "It was bought at an auction.",
          "It was made by a famous designer.",
        ),
        answer: "B",
        analysis: "信件显示这把椅子是全家搬进更小房子时唯一带走的家具，修过三次而非换新。",
      },
      {
        stem: "Why do visitors now spend more time in front of the chair?",
        options: opt(
          "It has been restored.",
          "The story connects it to a real family's decisions.",
          "It is displayed in a larger room.",
          "It is now for sale.",
        ),
        answer: "B",
        analysis: "因为故事把一件风格样品变成了一个缺钱家庭的真实选择，观众停留时间明显变长。",
      },
    ],
  },
];

/** 组合约束：3 段新闻共 7 题、2 段对话共 8 题、3 段篇章共 10 题，合计 25 题 */
export const BLUEPRINT = {
  news: { pattern: [3, 2, 2], total: 7 },
  conversations: { count: 2, perItem: 4, total: 8 },
  passages: { pattern: [4, 3, 3], total: 10 },
};

export const bankStats = () => ({
  news: NEWS.length,
  newsByQ: [3, 2].map((n) => ({ n, count: NEWS.filter((x) => x.questions.length === n).length })),
  conversations: CONVERSATIONS.length,
  passages: PASSAGES.length,
  passageByQ: [4, 3].map((n) => ({ n, count: PASSAGES.filter((x) => x.questions.length === n).length })),
  questions:
    NEWS.reduce((a, x) => a + x.questions.length, 0) +
    CONVERSATIONS.reduce((a, x) => a + x.questions.length, 0) +
    PASSAGES.reduce((a, x) => a + x.questions.length, 0),
});
