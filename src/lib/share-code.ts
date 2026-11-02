/**
 * 分享码（sharecode）透传工具。
 *
 * 背景：应用部署在 workbuddy.host 反代后面，平台中间件会校验每次请求是否带
 *   - URL 查询参数 `?sharecode=XXXX`，或
 *   - 平台在首次通过分享链接访问时种下的 `__wb_rsc` cookie
 * 二者满足其一即放行；都没有则平台直接返回 403 HTML「链接不完整」错误页，
 * 请求根本到不了 Next.js 应用层。
 *
 * 浏览器里前端发的都是相对路径 fetch（如 `/api/vocab`），URL 上不会自动带
 * sharecode 参数，只能依赖 `__wb_rsc` cookie 透传。但该 cookie 的属性是
 * `SameSite=None; Secure`，在以下场景会丢：
 *   - 隐私模式 / 严格追踪保护（iOS ITP、Edge 严格模式、安卓 Chrome 隐私）
 *   - 第三方 App WebView（手机百度、迅雷、微信内置浏览器等）
 *   - cookie 过期（30 天）或被手动清除
 *   - 跨容器重启后平台重置 cookie 但浏览器仍持旧值
 *
 * 一旦 cookie 丢失，所有写操作 API 都会被平台 403 拦截，表现为
 * 「服务开小差了 / 加入失败 / 请求失败」，而应用层其实完全正常。
 *
 * 本模块的职责：
 *   1. 在首次访问带 sharecode 的链接时，把 sharecode 持久化到 sessionStorage
 *      （同源、标签页内有效，刷新不丢，关标签页才清）
 *   2. 给所有 API 请求自动补上 sharecode 参数，作为 cookie 丢失时的兜底通道
 *   3. 当平台返回 403「链接不完整」时，前端能识别并引导用户回到分享链接
 */

const SHARE_KEY = "cet:sharecode";
const SHARE_PARAM = "sharecode";

/** 当前页面 URL 上的 sharecode（若有） */
export function sharecodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const v = new URL(window.location.href).searchParams.get(SHARE_PARAM);
  return v && v.trim() ? v.trim() : null;
}

/** sessionStorage 里缓存的 sharecode（上次访问带 sharecode 的链接时存下的） */
export function sharecodeFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(SHARE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    // sessionStorage 在某些隐私模式下不可用，静默退回 null
    return null;
  }
}

/** 把 sharecode 写入 sessionStorage（仅在拿到有效值时写） */
export function persistSharecode(v: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const trimmed = (v ?? "").trim();
  if (!trimmed) return;
  try {
    window.sessionStorage.setItem(SHARE_KEY, trimmed);
  } catch {
    // 写不进去就算了，不影响主流程
  }
}

/**
 * 拿当前可用的 sharecode：优先 URL，其次 sessionStorage。
 * 同时如果 URL 上有，顺手持久化一下，给后续的相对路径 fetch 兜底。
 */
export function currentSharecode(): string | null {
  const fromUrl = sharecodeFromUrl();
  if (fromUrl) {
    persistSharecode(fromUrl);
    return fromUrl;
  }
  return sharecodeFromStorage();
}

/**
 * 给一个相对/绝对 URL 拼上 sharecode 参数（如果它还没有的话）。
 * 只处理同源路径；外链不动。
 */
export function withSharecode(url: string): string {
  // 只动同源的相对路径或本站绝对 URL，外链直接返回
  if (/^https?:\/\//i.test(url) && !url.includes("workbuddy.host")) return url;

  const code = currentSharecode();
  if (!code) return url;

  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (u.searchParams.has(SHARE_PARAM)) return url; // 已带就不重复
    u.searchParams.set(SHARE_PARAM, code);
    // 相对路径输入时返回相对路径，避免把 origin 写死
    if (url.startsWith("/")) return u.pathname + u.search;
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * 判断一个响应是否是平台「链接不完整」403 拦截页。
 * 平台拦的时候 Content-Type 是 text/html，且 body 里有「链接不完整」标题。
 * 应用层自己的错误都是 JSON。
 */
export function isPlatformBlock(response: Response, contentType: string | null): boolean {
  if (response.status !== 403) return false;
  // 平台拦截一定是 HTML，应用层 403 一定是 JSON
  if (!contentType) return false;
  if (!/text\/html/i.test(contentType)) return false;
  return true;
}
