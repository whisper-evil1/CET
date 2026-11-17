import { currentUserId } from "@/lib/auth";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { getUserMistakes } from "@/lib/mistakes";

/** GET /api/mistakes —— 当前用户的错题列表与聚合分析（本地数据，低延迟） */
export const GET = withApi(async () => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const data = await getUserMistakes(userId);
  return ok(data);
});
