/**
 * 创作工作台草稿 / 任务状态持久化（localStorage）。
 *
 * 解决两个真实痛点：
 * 1. 生成完不点「保存」→ 作品库里没记录，用户以为白做了一版；
 * 2. 生成中途切走页面 / 关标签 → 请求结果丢失，回来什么都没有。
 *
 * 做法是纯前端的「草稿 + 进行中标记」：
 * - 输入内容（原文 / 参数）实时落 localStorage，切走再回过还在；
 * - 点生成先写一个 pending 标记，生成成功并自动入库后清除；
 * - 下次挂载如果发现 pending 还在，就说明上次没跑完，提示可一键续跑。
 *
 * 为什么不做服务端长任务：当前部署是 serverless，没有常驻进程托管后台任务，
 * 真后台任务得引入任务表 + 轮询，成本远高于收益。前端草稿 + 生成后自动入库
 * 已覆盖用户「切出去回来还在 / 有记录可查」的核心诉求。
 */

const PREFIX = "cet:create";

export type DraftState<T> = {
  source: string;
  options: T;
  updatedAt: number;
};

function keyOf(kind: string, suffix: string): string {
  return `${PREFIX}:${kind}:${suffix}`;
}

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    /* localStorage 不可用（隐私模式 / 配额满）时静默降级，不影响生成 */
  }
}

function safeRemove(key: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 读草稿；无草稿或解析失败返回 null */
export function loadDraft<T>(kind: string): DraftState<T> | null {
  const raw = safeGet(keyOf(kind, "draft"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DraftState<T>;
    if (parsed && typeof parsed.source === "string") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** 写草稿（调用方自行 debounce，避免每次按键都写） */
export function saveDraft<T>(kind: string, source: string, options: T): void {
  safeSet(keyOf(kind, "draft"), JSON.stringify({ source, options, updatedAt: Date.now() }));
}

export function clearDraft(kind: string): void {
  safeRemove(keyOf(kind, "draft"));
}

/** 标记「正在生成」；成功 / 失败 / 卸载都要清掉，避免误报中断 */
export function markPending(kind: string, pending: boolean): void {
  if (pending) safeSet(keyOf(kind, "pending"), String(Date.now()));
  else safeRemove(keyOf(kind, "pending"));
}

/** 上次是否有一个没跑完的生成任务 */
export function hasPending(kind: string): boolean {
  return safeGet(keyOf(kind, "pending")) !== null;
}
