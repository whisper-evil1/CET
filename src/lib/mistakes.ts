import { prisma } from "./prisma";
import { parseOptions, parseOptionAnalysis } from "./db-mappers";
import type { MistakeSummary, MistakeItem } from "./types";

/**
 * 取当前用户的错题与聚合分析。全部来自本地 SQLite：一次 findMany（带嵌套题目上下文）
 * + 一次 count，聚合在内存完成。个人维度的错题量很小，延迟可忽略。
 * 错题页与 AI 分析接口共用，避免两处各查一遍。
 */
export async function getUserMistakes(
  userId: string,
): Promise<{ summary: MistakeSummary; mistakes: MistakeItem[] }> {
  const [wrongAnswers, answeredCount] = await Promise.all([
    prisma.answer.findMany({
      where: { userId, isCorrect: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        choice: true,
        createdAt: true,
        question: {
          select: {
            id: true,
            number: true,
            stem: true,
            options: true,
            answer: true,
            analysis: true,
            optionAnalysis: true,
            type: true,
            evidenceText: true,
            passage: {
              select: { title: true, paper: { select: { id: true, title: true } } },
            },
          },
        },
      },
    }),
    prisma.answer.count({ where: { userId } }),
  ]);

  const wrongCount = wrongAnswers.length;
  const correctCount = answeredCount - wrongCount;
  const accuracy = answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0;

  const typeMap = new Map<string, number>();
  const paperMap = new Map<string, { paperId: string; title: string; wrongCount: number }>();
  const choiceMap = new Map<string, number>();

  for (const a of wrongAnswers) {
    const q = a.question;
    const type = q.type?.trim() || "未分类";
    typeMap.set(type, (typeMap.get(type) ?? 0) + 1);

    const pid = q.passage.paper.id;
    const existing = paperMap.get(pid);
    if (existing) existing.wrongCount += 1;
    else paperMap.set(pid, { paperId: pid, title: q.passage.paper.title, wrongCount: 1 });

    const c = a.choice?.trim();
    if (c) choiceMap.set(c, (choiceMap.get(c) ?? 0) + 1);
  }

  const byType = [...typeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const byPaper = [...paperMap.values()].sort((a, b) => b.wrongCount - a.wrongCount);
  const byWrongChoice = [...choiceMap.entries()]
    .map(([choice, count]) => ({ choice, count }))
    .sort((a, b) => b.count - a.count);

  const summary: MistakeSummary = {
    answeredCount,
    correctCount,
    wrongCount,
    accuracy,
    byType,
    byPaper,
    byWrongChoice,
  };

  const mistakes: MistakeItem[] = wrongAnswers.map((a) => ({
    id: a.id,
    questionId: a.question.id,
    choice: a.choice,
    createdAt: a.createdAt.toISOString(),
    question: {
      number: a.question.number,
      stem: a.question.stem,
      options: parseOptions(a.question.options),
      answer: a.question.answer,
      analysis: a.question.analysis,
      optionAnalysis: parseOptionAnalysis(a.question.optionAnalysis),
      type: a.question.type,
      passageTitle: a.question.passage.title,
      paperTitle: a.question.passage.paper.title,
      evidenceText: a.question.evidenceText,
    },
  }));

  return { summary, mistakes };
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * 给真实模型的系统提示词：把结构化错题数据压成纯文本。
 * 服务端 /api/mistakes/context 会把它交给前端，用于直连云模型。
 */
export function buildMistakeAnalysisPrompt(summary: MistakeSummary, mistakes: MistakeItem[]): string {
  const sample = mistakes
    .slice(0, 12)
    .map((m) => {
      const wrongOpt = m.question.options.find((o) => o.key === m.choice);
      const correctOpt = m.question.options.find((o) => o.key === m.question.answer);
      const analysis = m.question.analysis.replace(/\s+/g, " ").slice(0, 120);
      return `· 第${m.question.number}题（${m.question.type ?? "未分类"}）：你选了 ${m.choice}（${wrongOpt?.text ?? ""}），正确答案是 ${m.question.answer}（${correctOpt?.text ?? ""}）。解析：${analysis}`;
    })
    .join("\n");

  const byType = summary.byType.map((t) => `${t.type} ${t.count} 道`).join("、") || "无";
  const byChoice = summary.byWrongChoice.map((c) => `误选 ${c.choice} ${c.count} 次`).join("、") || "无";

  return `你是一位耐心的四六级英语阅读老师，正在分析一位学生的错题本。请基于下面的真实数据给出分析，不要编造数据。

【整体情况】共作答 ${summary.answeredCount} 题，正确 ${summary.correctCount} 题，错题 ${summary.wrongCount} 题，正确率 ${summary.accuracy}%。
【错题题型分布】${byType}
【最易误选的选项】${byChoice}

【部分错题样例】
${sample}

请输出一段 300-500 字的中文分析：
1. 先点出这位学生最突出的薄弱点（结合上面的分布数据和他实际选错的选项，不要空泛）。
2. 给 2-3 条具体、可操作的学习建议。
3. 语气鼓励、像真人老师；用 Markdown 输出：关键结论用 **加粗**，建议用有序列表，不要使用一级标题和表格。`;
}

/**
 * 未接入模型时的兜底分析：完全依据该用户的真实错题数据归纳，
 * 不再是“演示模式”的通用示例。首屏即可用，零外部依赖。
 */
export function buildLocalMistakeAnalysis(summary: MistakeSummary, mistakes: MistakeItem[]): string {
  const { answeredCount, correctCount, wrongCount, accuracy, byType, byPaper, byWrongChoice } = summary;

  if (wrongCount === 0) {
    return `目前你还没有错题（已作答 ${answeredCount} 题，正确率 ${accuracy}%），暂时看不出明显薄弱点。继续保持，多刷两套卷子后再回来看看。`;
  }

  const topType = byType[0];
  const secondType = byType[1];
  const topPaper = byPaper[0];
  const topChoice = byWrongChoice[0];
  const parts: string[] = [];

  parts.push(
    `基于你目前的 ${answeredCount} 道作答（对 ${correctCount} 道，错 ${wrongCount} 道，正确率 ${accuracy}%），我把错题按题型、卷子和选项归了一遍，结论如下。`,
  );

  if (topType) {
    parts.push(
      `**最突出的薄弱点是「${topType.type}」**：这类题你错了 ${topType.count} 道，占全部错题的 ${pct(
        topType.count,
        wrongCount,
      )}${secondType ? `；其次是「${secondType.type}」（${secondType.count} 道）` : ""}。这类题考的多是回原文定位细节，建议专门练「先定位、再比对」。`,
    );
  }

  if (topChoice) {
    parts.push(
      `**你最容易栽在「选项 ${topChoice.choice}」上**：有 ${topChoice.count} 次把答案选成了它。四六级阅读的干扰项很爱把原文的主语、范围或程度偷偷换掉，遇到 ${topChoice.choice} 时先回原文核对那一句。`,
    );
  }

  if (topPaper) {
    parts.push(`**出错最集中的是《${topPaper.title}》**（${topPaper.wrongCount} 道），这套卷子值得整篇重做一遍，把每题错因写在旁边。`);
  }

  parts.push("**接下来可以这样做**");
  parts.push("1. 把上面的错题重做一遍，重点看「正确答案为什么对」，而不只是「我为什么错」。");
  if (topType) parts.push(`2. 针对「${topType.type}」单独刷 5–10 道同类题，把「定位 → 比对」固定成动作。`);
  if (topChoice) parts.push(`3. 遇到选项 ${topChoice.choice} 时慢一拍，逐词回原文核对，确认它有没有偷换主语或范围。`);

  parts.push(
    `> 说明：这段分析由你的真实错题数据自动归纳，不是通用示例。接入 AI 模型后，可得到更细的逐题讲解。`,
  );

  return parts.join("\n\n");
}
