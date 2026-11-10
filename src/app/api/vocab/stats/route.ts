import { ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { loadVocabAnalytics } from "@/lib/vocab-analytics";

/**
 * GET /api/vocab/stats —— 学习分析面板的数据源。
 *
 * 页面本身是服务端直出（不依赖这个接口），这里留一份 JSON 是给：
 *   1. 闯关结算面板复用同一套口径，避免两套算法各算一遍；
 *   2. 后续接外部看板 / 导出。
 * 与页面共用 loadVocabAnalytics，保证「面板显示的」和「接口返回的」永远一致。
 */
export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return ok({ empty: true });

  const data = await loadVocabAnalytics(meId);
  return ok(data);
});
