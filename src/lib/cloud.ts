import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";
import { CLOUD_PUBLIC_CONFIG } from "./cloud-config";

/**
 * 云服务客户端（浏览器侧）。
 *
 * 配置来自 cloud-config.ts 里的 publicConfig（由 workbuddy_cloud_service 的 activate 返回），
 * 属于面向终端用户的公开信息：publishableKey 只标识应用、不带权限，
 * 服务端按 Origin 精确匹配鉴权。运行时不读任何服务端密钥。
 *
 * endpoint 必须与该应用的发布域名完全一致，否则服务端会按 Origin 拒绝（auth_ 类错误）。
 *
 * 仅在浏览器使用：AI 答疑走 cloud.llm，由前端直接发起流式调用，
 * 不经过 Node 服务端中转（云服务 SDK 的约定）。
 */
export const cloudReady = Boolean(
  CLOUD_PUBLIC_CONFIG.endpoint && CLOUD_PUBLIC_CONFIG.publishableKey,
);

export const cloud = cloudReady
  ? createWorkBuddyCloud({
      endpoint: CLOUD_PUBLIC_CONFIG.endpoint,
      publishableKey: CLOUD_PUBLIC_CONFIG.publishableKey,
    })
  : null;
