import { NextResponse } from "next/server";
import { probeCloudIdentity } from "@/lib/cloud-identity";
import { logOtpEvent } from "@/lib/otp-log";

export const dynamic = "force-dynamic";

/**
 * 验证码登录的诊断探针。
 *
 * 只回答「这个 accessToken 能不能换到云端身份」，以及失败时的上游状态码/错误码，
 * 不返回任何用户资料。用途：把「会话建立失败」拆成可定位的原因。
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { accessToken?: unknown; originHint?: unknown }
    | null;

  const token = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  if (token.length < 20 || token.length > 4096) {
    return NextResponse.json({ ok: false, reason: "token_missing" }, { status: 400 });
  }

  const originHint =
    (typeof body?.originHint === "string" ? body.originHint : null) ??
    request.headers.get("origin");

  const result = await probeCloudIdentity(token, originHint);

  logOtpEvent({
    stage: "probe",
    ok: result.ok,
    status: result.ok ? null : result.status ?? null,
    reason: result.ok ? null : `${result.reason} | len=${token.length}`.slice(0, 240),
    origin: result.ok ? result.origin : originHint,
  });

  if (result.ok) return NextResponse.json({ ok: true });

  return NextResponse.json({
    ok: false,
    status: result.status ?? null,
    reason: result.reason,
    tried: result.tried,
  });
}
