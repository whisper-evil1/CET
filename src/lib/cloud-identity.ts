import { CLOUD_PUBLIC_CONFIG } from "./cloud-config";
import { normalizePhone } from "./phone";

/**
 * 用云端 accessToken 换取用户身份。
 *
 * 三个条件缺一不可：
 *   1. x-wb-webapp-access-key —— publishableKey，网关先验「哪个应用」；
 *   2. Origin               —— 会话绑定来源，浏览器自动带，Node fetch 不会；
 *   3. 来源必须与 token 签发时的来源一致。
 *
 * 第 3 点最容易出问题：用户可能从预览域名或自定义域名进入，而服务端只写死了
 * 发布域名。因此这里同时尝试「浏览器上报的来源」与「应用发布域名」，任一成功即可。
 */
export type CloudIdentity = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
};

export type CloudIdentityProbe =
  | { ok: true; identity: CloudIdentity; origin: string }
  | { ok: false; status?: number; reason: string; tried: string[] };

function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) return null;
  return trimmed;
}

async function requestMe(accessToken: string, origin: string): Promise<CloudIdentityProbe> {
  const url = `${CLOUD_PUBLIC_CONFIG.endpoint}/.cloud/auth/v1/user/me`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-wb-webapp-access-key": CLOUD_PUBLIC_CONFIG.publishableKey,
        Origin: origin,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      let reason = `http_${res.status}`;
      try {
        const body = (await res.json()) as { error?: string; error_description?: string };
        const parts = [body?.error, body?.error_description].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        if (parts.length) reason = parts.join(": ").slice(0, 180);
      } catch {
        /* 非 JSON 响应，保留 http_ 状态码 */
      }
      return { ok: false, status: res.status, reason, tried: [origin] };
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const id =
      typeof raw.sub === "string" ? raw.sub : typeof raw.uid === "string" ? raw.uid : "";
    if (!id) return { ok: false, reason: "missing_id", tried: [origin] };

    const rawPhone =
      typeof raw.phone_number === "string" && raw.phone_number
        ? raw.phone_number
        : typeof raw.phone === "string" && raw.phone
          ? raw.phone
          : undefined;

    return {
      ok: true,
      origin,
      identity: {
        id,
        email: typeof raw.email === "string" && raw.email ? raw.email : undefined,
        /*
         * 手机号在这里就归一。
         *
         * 云端 phone_number 是 `+86 13800138000`（带国家码和空格），
         * 而用户输入、数据库、页面展示全是 `13800138000`。
         * 不在这里收敛，后面每一处比较都会「人眼看一致、代码说不等」——
         * 绑定手机号报「验证码与绑定的不一致」就是这么来的。
         * 归一放在最靠外的一层，调用方拿到的永远是同一种写法。
         */
        phone: rawPhone ? normalizePhone(rawPhone) : undefined,
        name: typeof raw.name === "string" && raw.name ? raw.name : undefined,
      },
    };
  } catch {
    return { ok: false, reason: "network", tried: [origin] };
  }
}

export async function probeCloudIdentity(
  accessToken: string,
  originHint?: string | null,
): Promise<CloudIdentityProbe> {
  const candidates = Array.from(
    new Set(
      [normalizeOrigin(originHint), normalizeOrigin(CLOUD_PUBLIC_CONFIG.endpoint)].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  );

  let last: CloudIdentityProbe = { ok: false, reason: "network", tried: candidates };
  for (const origin of candidates) {
    const result = await requestMe(accessToken, origin);
    if (result.ok) return result;
    last = result;
  }

  return { ok: false, status: last.status, reason: last.reason, tried: candidates };
}

export async function fetchCloudIdentity(
  accessToken: string,
  originHint?: string | null,
): Promise<CloudIdentity | null> {
  const result = await probeCloudIdentity(accessToken, originHint);
  return result.ok ? result.identity : null;
}
