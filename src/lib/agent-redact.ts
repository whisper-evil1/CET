/**
 * Agent 网关脱敏层（从交付包《可复制配置/脱敏模块.ts》移植）。
 *
 * 用途：内容进入 Dify / 模型之前 redactText()；成品返回之前 outboundRescan()，
 * 防止模型把原始 PII 带回来。映射表只存服务端进程内隔离区，绝不随正文下发、
 * 不进日志、不进前端响应。
 *
 * 与交付包参考实现的差异：
 * - tokenMapRef 用进程内自增 + 随机串，不依赖 node:crypto（网关是无状态 Lambda 友好型）；
 * - 去掉 node 专属 API，保持纯 TS，可被 Next 服务端路由直接引用；
 * - 规则表原样保留，正则与占位符命名与四个 Dify DSL 里的 code 节点保持一致。
 *
 * 边界：只覆盖中国大陆常见 PII；中文姓名仅匹配「姓名：xxx」这类显式标签，
 * 不做全文识别（误伤率太高）。画面类敏感（人脸 / 二维码 / 水印）不在这里处理。
 */

export type RedactStage = "inbound" | "outbound";

export type PiiKind =
  | "PHONE"
  | "ID_CARD"
  | "EMAIL"
  | "BANK_CARD"
  | "PLATE"
  | "SOCIAL_ID"
  | "URL_TOKEN"
  | "PERSON"
  | "ADDRESS";

export interface RedactRule {
  kind: PiiKind;
  pattern: RegExp;
  token: string;
  note: string;
}

/** 顺序即优先级：先具体后宽泛。与 DSL code 节点同一套规则。 */
export const REDACT_RULES: RedactRule[] = [
  {
    kind: "ID_CARD",
    pattern: /\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    token: "ID_CARD",
    note: "18 位居民身份证号",
  },
  {
    kind: "PHONE",
    pattern: /(?<!\d)1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}(?!\d)/g,
    token: "PHONE",
    note: "中国大陆手机号，允许 - 或空格分隔",
  },
  {
    kind: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    token: "EMAIL",
    note: "邮箱地址",
  },
  {
    kind: "BANK_CARD",
    pattern: /(?<!\d)\d{16,19}(?!\d)/g,
    token: "BANK_CARD",
    note: "银行卡号",
  },
  {
    kind: "URL_TOKEN",
    pattern: /([?&](?:token|access_token|key|api_key|secret|code|sign)=)[^&\s"']+/gi,
    token: "URL_TOKEN",
    note: "URL 查询串中的凭证参数",
  },
  {
    kind: "SOCIAL_ID",
    pattern: /(微信号|微信|VX|vx|QQ|qq|抖音号|快手号|微博|B站|小红书|账号|ID)\s*[:：]?\s*([A-Za-z0-9_\-.@]{4,30})/g,
    token: "SOCIAL_ID",
    note: "平台账号 / 水印 ID",
  },
  {
    kind: "PLATE",
    pattern: /\b[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{5}\b/g,
    token: "PLATE",
    note: "机动车号牌（简版）",
  },
  {
    kind: "PERSON",
    pattern: /(姓名|作者|笔名|联系人|收货人|署名)\s*[:：]\s*([\u4e00-\u9fa5]{2,4})/g,
    token: "PERSON",
    note: "仅带明确标签时命中中文姓名",
  },
  {
    kind: "ADDRESS",
    pattern: /((?:住址|地址)\s*[:：]?\s*)([^\n，。；,;]{6,60})/g,
    token: "ADDRESS",
    note: "带标签的详细地址",
  },
];

export interface RedactHit {
  kind: PiiKind;
  token: string;
  /** 只记录长度，不记录原值 */
  originalLength: number;
}

export interface RedactResult {
  cleanText: string;
  tokenMapRef: string;
  redactCount: number;
  hits: RedactHit[];
}

/** 映射表存储接口：进程内实现，实例重启即失效（不持久化原值） */
export interface TokenMapStore {
  save(ref: string, map: ReadonlyMap<string, string>): void;
  load(ref: string): ReadonlyMap<string, string>;
}

export class InMemoryMapStore implements TokenMapStore {
  private readonly store = new Map<string, ReadonlyMap<string, string>>();
  save(ref: string, map: ReadonlyMap<string, string>): void {
    this.store.set(ref, new Map(map));
  }
  load(ref: string): ReadonlyMap<string, string> {
    return this.store.get(ref) ?? new Map();
  }
}

/** 进程内单例：映射表只在当前实例内存，不落库、不进响应 */
export const tokenStore = new InMemoryMapStore();

let refSeq = 0;
function makeRef(): string {
  refSeq += 1;
  return `pmap_${Date.now().toString(36)}_${refSeq}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 入关脱敏：PII → 占位符，映射存隔离区。
 * 返回对象不含任何原值，可安全下发模型 / 写日志。
 */
export function redactText(
  raw: string,
  store: TokenMapStore = tokenStore,
  stage: RedactStage = "inbound",
): RedactResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { cleanText: "", tokenMapRef: "", redactCount: 0, hits: [] };
  }

  const tokenMap = new Map<string, string>();
  const reverse = new Map<string, string>();
  const counters = new Map<PiiKind, number>();
  const hits: RedactHit[] = [];
  let cleanText = raw;

  for (const rule of REDACT_RULES) {
    if (stage === "outbound" && (rule.kind === "PERSON" || rule.kind === "ADDRESS")) continue;

    rule.pattern.lastIndex = 0;
    cleanText = cleanText.replace(rule.pattern, (match: string, ...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[];
      const prefix = groups.length >= 1 && typeof groups[0] === "string" ? groups[0] : "";
      const hasPrefix = prefix.length > 0 && match.indexOf(prefix) === 0;
      const value = hasPrefix ? match.slice(prefix.length) : match;
      if (value.length === 0) return match;

      const dedupKey = `${rule.kind}:${value}`;
      let token = reverse.get(dedupKey);
      if (!token) {
        const n = (counters.get(rule.kind) ?? 0) + 1;
        counters.set(rule.kind, n);
        token = `[${rule.token}_${n}]`;
        reverse.set(dedupKey, token);
        tokenMap.set(token, value);
      }
      hits.push({ kind: rule.kind, token, originalLength: value.length });
      return hasPrefix ? `${prefix}${token}` : token;
    });
  }

  const tokenMapRef = tokenMap.size > 0 ? makeRef() : "";
  if (tokenMap.size > 0) store.save(tokenMapRef, tokenMap);

  return { cleanText, tokenMapRef, redactCount: hits.length, hits };
}

/**
 * 出关复扫：生成结果里若出现原值，替换回占位符并 blocked=true。
 * 网关据此阻断输出，绝不把带 PII 的成品交给用户。
 */
export function outboundRescan(
  generated: string,
  tokenMapRef: string,
  store: TokenMapStore = tokenStore,
): { safeText: string; blocked: boolean; leakedTokens: string[] } {
  const map = store.load(tokenMapRef);
  const leakedTokens: string[] = [];
  let safeText = generated;

  for (const [token, original] of map.entries()) {
    if (original.length < 4) continue;
    if (safeText.indexOf(original) >= 0) {
      leakedTokens.push(token);
      safeText = safeText.split(original).join(token);
    }
  }

  const probe = redactText(safeText, new InMemoryMapStore(), "outbound");
  if (probe.redactCount > 0) {
    for (const hit of probe.hits) {
      if (leakedTokens.indexOf(hit.token) < 0) leakedTokens.push(hit.token);
    }
    safeText = probe.cleanText;
  }

  return { safeText, blocked: leakedTokens.length > 0, leakedTokens };
}

/** 日志脱敏：只输出计数与占位符种类，绝不输出原值 */
export function redactForLog(result: RedactResult): Record<string, unknown> {
  const byKind: Record<string, number> = {};
  for (const hit of result.hits) byKind[hit.kind] = (byKind[hit.kind] ?? 0) + 1;
  return {
    message: "已脱敏",
    redact_count: result.redactCount,
    by_kind: byKind,
    map_ref: result.tokenMapRef,
  };
}
