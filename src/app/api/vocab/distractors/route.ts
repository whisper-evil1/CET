import { z } from "zod";
import { ok, withApi } from "@/lib/api-helpers";
import { pickNearSynonyms } from "@/lib/synonyms";

/**
 * POST /api/vocab/distractors
 *
 * 一次给一批词找「近义干扰项」，供「生词本背单词」出四选一。
 *
 * 为什么放在服务端：
 *   近义判定要在 1.5 万条离线词库里按汉字重合度排一遍，打包给前端太重；
 *   而且索引在服务端只建一次，后面的请求都是纯内存查表。
 *
 * 请求：{ items: [{ word, definition, pos }], count?: number }
 * 返回：{ results: { [word]: string[] } }  —— 找不到就返回空数组，前端自行用词池兜底，
 *       所以这个接口失败不会让游戏开不了局。
 */

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        word: z.string().trim().min(1).max(48),
        definition: z.string().trim().min(1).max(200),
        pos: z.string().max(24).optional().default(""),
      }),
    )
    .min(1)
    .max(24),
  count: z.number().int().min(1).max(5).optional().default(3),
});

export const POST = withApi(async (request: Request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return ok({ results: {} });

  const { items, count } = parsed.data;
  const results: Record<string, string[]> = {};
  for (const item of items) {
    results[item.word] = pickNearSynonyms(item.definition, item.pos, [item.word], count);
  }
  return ok({ results });
});
