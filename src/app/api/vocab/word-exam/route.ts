import { ok, withApi } from "@/lib/api-helpers";
import { getExamEvidence } from "@/lib/exam-evidence";

/**
 * GET /api/vocab/word-exam?word=frequently
 *
 * 一个词在本站真题题库里的「真题再现」证据：出现句次、听力/笔试占比、
 * 2021–2026 年份跨度，以及最多 3 条带出处的真题原句。
 *
 * 公开接口（真题语料不涉隐私），刷词卡 / 闪卡都走它；服务端带进程内缓存。
 */
export const GET = withApi(async (request: Request) => {
  const word = (new URL(request.url).searchParams.get("word") ?? "").trim();
  if (!word || word.length > 32) {
    return ok({ evidence: null });
  }
  const evidence = await getExamEvidence(word);
  return ok({ evidence });
});
