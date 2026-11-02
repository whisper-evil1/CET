"use client";

import { useEffect } from "react";
import { sharecodeFromUrl, persistSharecode, currentSharecode } from "@/lib/share-code";

/**
 * 分享码同步器（无 UI，纯副作用）。
 *
 * 挂在根 layout 里，做两件事：
 *   1. 首次访问带 ?sharecode=... 的链接时，把 sharecode 存到 sessionStorage，
 *      给后续相对路径 fetch 兜底（见 src/lib/api-client.ts 的 withSharecode）
 *   2. 监听 apiFetch 抛出的「平台 403 拦截」事件，自动把页面跳回带 sharecode
 *      的入口链接，让平台重新种 __wb_rsc cookie，而不是停在错误提示上
 *
 * 不渲染任何 DOM，只 return null。
 */
export function ShareCodeSync() {
  useEffect(() => {
    // 1. 持久化当前 URL 上的 sharecode
    const fromUrl = sharecodeFromUrl();
    if (fromUrl) {
      persistSharecode(fromUrl);
    }

    // 2. 监听平台拦截事件：用 sessionStorage 里留的 sharecode 重新拼入口 URL
    const onPlatformBlock = () => {
      const code = currentSharecode();
      if (!code) {
        // 连 sessionStorage 里也没有，说明用户不是从分享链接进来的，
        // 这种情况没法自动恢复，停在原地让用户看到错误提示即可
        return;
      }
      // 跳回首页并带上 sharecode，让平台重新种 cookie，
      // 之后用户再点原来的功能就能正常用了
      const next = `${window.location.origin}/?sharecode=${encodeURIComponent(code)}`;
      // 用 replace 避免在历史栈里留下错误页，按返回键能回到来源站
      window.location.replace(next);
    };
    window.addEventListener("cet:platform-block", onPlatformBlock);

    return () => {
      window.removeEventListener("cet:platform-block", onPlatformBlock);
    };
  }, []);

  return null;
}
