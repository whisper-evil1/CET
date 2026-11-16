import { Errors, fail, ok, parseBody, withApi } from "@/lib/api-helpers";
import { currentUserId } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { agentCreationSchema } from "@/lib/validators";
import {
  DEFAULT_NOVEL_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  type NovelOutput,
  type VideoOutput,
} from "@/lib/creation";
import { redactForLog, redactText, outboundRescan } from "@/lib/agent-redact";
import { DifyError, difyEnabled, runWorkflow } from "@/lib/dify-agent";
import { builtinNovel, builtinVideo, type PlanStep } from "@/lib/agent-builtin";
import { adaptNovelMarkdown, adaptVideoMarkdown } from "@/lib/agent-adapter";

/**
 * POST /api/agent/creation —— 创作出海 Agent 网关（小说英译 / 短视频出海）。
 *
 * 链路：登录 → 限流 → 入关脱敏 → [Dify WF1/WF2 优先 / builtin 降级] → 出关复扫 → 适配 UI 结构。
 * 密钥只在服务端；响应只回计数与占位符，不回映射内容、不回原值、不回平台密钥。
 *
 * 这是「新增通道」，不改原来的 /api/create/generate 三级降级链路；
 * 创作页可以按需切到 Agent 模式，未配置 Dify 时 builtin 仍可跑通全流程。
 */
export const maxDuration = 90;

type AgentMode = "dify" | "builtin";

type CreationData = {
  job_id: string;
  mode: AgentMode;
  route: "novel" | "video";
  status: "done" | "blocked";
  output: NovelOutput | VideoOutput;
  plan: PlanStep[];
  redact_count: number;
  note: string;
  elapsed_ms: number;
};

export const POST = withApi(async (request: Request) => {
  const userId = await currentUserId();
  if (!userId) return Errors.unauthorized();

  const limited = rateLimit(`agent-create:${userId}`, { windowMs: 10 * 60_000, max: 20 });
  if (!limited.allowed) {
    return Errors.tooMany(`生成太频繁了，${limited.retryAfterSec} 秒后再试`);
  }

  const body = await parseBody(request, agentCreationSchema);
  const started = Date.now();
  const route = body.kind;
  const workflow = route === "novel" ? "novel" : "video";

  // 1. 入关脱敏：无论走哪条后端，先在本地替换 PII，映射留服务端
  const redacted = redactText(body.text);
  console.info("[agent] inbound", {
    route,
    user: userId,
    job: body.client_request_id || "-",
    ...redactForLog(redacted),
  });

  const plan: PlanStep[] = [];
  let output: NovelOutput | VideoOutput | null = null;
  let mode: AgentMode = "builtin";
  let note = "";
  let useDify = difyEnabled(workflow);

  if (useDify) {
    try {
      const inputs: Record<string, unknown> =
        route === "novel"
          ? { raw_text: redacted.cleanText, target_platform: body.target_platform ?? "" }
          : {
              script_zh: redacted.cleanText,
              target: (body.video?.platform ?? "youtube") === "tiktok" ? "tiktok" : "youtube-shorts",
              visual_notes: "",
              duration_hint: `${body.video?.seconds ?? 30}s`,
            };

      const run = await runWorkflow(workflow, inputs, userId);
      mode = "dify";
      plan.push(
        { seq: 1, action: "入关脱敏（网关 + 工作流双检）", tool: "redact" },
        { seq: 2, action: `调用 Dify ${route === "novel" ? "WF1" : "WF2"} 工作流`, tool: "dify_workflow" },
        { seq: 3, action: "出关复扫 + 结构适配", tool: "outbound_rescan" },
      );

      const blockedByDify = Boolean(run.outputs.blocked);
      const adaptedMd = String(
        route === "novel" ? run.outputs.adapted_md ?? "" : run.outputs.package_md ?? "",
      );
      const difyNote = String(run.outputs.note ?? "");

      // 网关侧再复扫一次：不信任任何单一环节的脱敏结论
      const rescan = outboundRescan(adaptedMd, redacted.tokenMapRef);
      const blocked = blockedByDify || rescan.blocked;
      output =
        route === "novel"
          ? adaptNovelMarkdown(adaptedMd, body.text, blocked)
          : adaptVideoMarkdown(adaptedMd, body.video ?? DEFAULT_VIDEO_OPTIONS, blocked);
      note = blocked
        ? "出关复扫检出隐私泄漏，已阻断交付；请脱敏后重试"
        : difyNote || (rescan.blocked ? "" : "Dify 工作流产出");
      if (blocked) {
        return fail(4222, note, 422);
      }
    } catch (error) {
      // Dify 失败 → 透明降级到 builtin，前端无感；只有配置缺失才会走到这
      if (error instanceof DifyError && error.kind === "unconfigured") {
        useDify = false;
      } else if (error instanceof Error) {
        console.warn("[agent] dify failed, fallback to builtin:", error.message);
        useDify = false;
        note = "Dify 通道不可用，已自动切换到内置链路";
      }
    }
  }

  if (!useDify) {
    try {
      const builtin =
        route === "novel"
          ? await builtinNovel(redacted.cleanText, body.novel ?? DEFAULT_NOVEL_OPTIONS)
          : await builtinVideo(redacted.cleanText, body.video ?? DEFAULT_VIDEO_OPTIONS);
      mode = "builtin";
      plan.push(...builtin.plan);

      const rescan = outboundRescan(JSON.stringify(builtin.output), redacted.tokenMapRef);
      if (rescan.blocked) {
        return fail(4222, "出关复扫检出隐私泄漏，已阻断交付；请脱敏后重试", 422);
      }
      output = builtin.output;
      note = note || builtin.note;
    } catch (error) {
      console.error("[agent] builtin failed:", error);
      // builtin 也没有模型配置：明确报错，由前端降级到原 /api/create/generate 骨架链路
      return fail(5001, error instanceof Error ? error.message : "生成失败", 502);
    }
  }

  if (!output) return Errors.server("生成结果为空");

  const data: CreationData = {
    job_id: body.client_request_id || `job_${Date.now().toString(36)}`,
    mode,
    route,
    status: "done",
    output,
    plan,
    redact_count: redacted.redactCount,
    note,
    elapsed_ms: Date.now() - started,
  };
  return ok(data);
});
