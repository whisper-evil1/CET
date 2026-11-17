import { currentUserId } from "@/lib/auth";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { getUserMistakes, buildMistakeAnalysisPrompt } from "@/lib/mistakes";

/**
 * GET /api/mistakes/context —— 返回基于当前用户错题拼好的系统提示词。
 * 前端用它直连云模型（浏览器 → WorkBuddy cloud）做真实分析；
 * 没配云/云不可用时，前端回退到 /api/mistakes/analyze（本地数据归纳）。
 */
export const GET = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const { summary, mistakes } = await getUserMistakes(userId);
  return ok({
    hasMistakes: mistakes.length > 0,
    count: mistakes.length,
    systemPrompt: buildMistakeAnalysisPrompt(summary, mistakes),
  });
});
