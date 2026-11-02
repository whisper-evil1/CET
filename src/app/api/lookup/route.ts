import { Errors, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { lookupSchema } from "@/lib/validators";
import { lookupWord } from "@/lib/dict";
import { rateLimit } from "@/lib/rate-limit";
import { aiConfig } from "@/lib/ai";

/** POST /api/lookup —— 查词（缓存 → 内置词库 → AI），失败给友好提示 */
export const POST = withApi(async (request: Request) => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  if (!rateLimit(`lookup:${meId}`, { windowMs: 60_000, max: 60 }).allowed) {
    return Errors.tooMany("查词太频繁了，稍等一下");
  }

  const body = await parseBody(request, lookupSchema);
  const entry = await lookupWord(body.word, body.context);

  // lookupWord 对"确实查不到"的词返回 needsDefinition 的空释义占位（而非 null）。
  // 这里以"是否有释义"判定 found；仍回传占位条目，前端可保留"加入生词本（释义待补）"入口。
  const found = Boolean(entry && entry.definitions.length > 0);
  if (!found) {
    return ok({
      found: false,
      entry,
      hint: aiConfig().enabled
        ? "这个单词没有查到释义，换个拼写试试？"
        : "内置词库暂未收录这个词。在 .env 里配置 AI_API_KEY 后，可以自动生成中文释义。",
    });
  }

  return ok({ found: true, entry, hint: null });
});
