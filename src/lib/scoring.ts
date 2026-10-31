/**
 * 排行榜积分公式。
 * 设计目标：鼓励持续学习（打卡权重高），同时奖励答题量与正确率。
 *   - 每答 1 题 +2 分（参与即得分）
 *   - 每答对 1 题额外 +3 分（共 +5）
 *   - 每天打卡 +10 分（当天答题 ≥5 题）
 *   - 每收藏 1 个生词 +1 分
 * accuracy 单独按百分比返回，用于展示，不直接进入积分（已隐含在 correctCount 里）。
 */

export function computeScore(input: {
  questionCount: number;
  correctCount: number;
  checkinDays: number;
  newVocab: number;
}): { totalScore: number; accuracy: number } {
  const { questionCount, correctCount, checkinDays, newVocab } = input;
  const accuracy = questionCount
    ? Math.round((correctCount / questionCount) * 100)
    : 0;
  const totalScore =
    questionCount * 2 + correctCount * 3 + checkinDays * 10 + newVocab * 1;
  return { totalScore, accuracy };
}
