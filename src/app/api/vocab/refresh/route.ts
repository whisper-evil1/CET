import { prisma } from "@/lib/prisma";
import { Errors, ok, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { lookupWord } from "@/lib/dict";
import { toJsonText } from "@/lib/db-mappers";

/**
 * POST /api/vocab/refresh —— 批量补全缺失释义
 * 取 definitions 为空的生词（最多 20 个），走查词四级链路补全。
 * vocab 页进入时自动触发。
 */
export const POST = withApi(async () => {
  const meId = await currentUserId();
  if (!meId) return Errors.unauthorized();

  const needFill = await prisma.vocabWord.findMany({
    where: {
      userId: meId,
      OR: [
        { definitions: "[]" },
        { definitions: "null" },
        { definitions: "" },
      ],
    },
    take: 20,
    orderBy: { updatedAt: "asc" },
  });

  let filled = 0;
  for (const row of needFill) {
    const entry = await lookupWord(row.word);
    if (entry && entry.definitions.length > 0) {
      await prisma.vocabWord.update({
        where: { id: row.id },
        data: {
          phonetic: entry.phonetic ?? row.phonetic,
          definitions: toJsonText(entry.definitions),
          ...(entry.examples[0]?.en ? { example: entry.examples[0].en } : {}),
          ...(entry.examples[0]?.zh ? { exampleZh: entry.examples[0].zh } : {}),
        },
      });
      filled++;
    }
  }

  return ok({ total: needFill.length, filled });
});
