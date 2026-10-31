import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";

/**
 * 云服务客户端（浏览器侧）。
 *
 * endpoint 与 publishableKey 由 workbuddy_cloud_service 的 activate 步骤返回，
 * 属于面向终端用户的 publicConfig（publishableKey 本身不带任何权限，服务端按 Origin 精确匹配鉴权）。
 * 这里通过 NEXT_PUBLIC_ 在 build 时 inline 进前端 bundle，运行时不读任何服务端密钥。
 *
 * 仅在浏览器使用：AI 答疑走 cloud.llm，由前端直接发起流式调用，
 * 不再经过 Node 服务端中转（云服务 SDK 的约定）。
 */
const endpoint = process.env.NEXT_PUBLIC_CLOUD_ENDPOINT;
const publishableKey = process.env.NEXT_PUBLIC_CLOUD_PUBLISHABLE_KEY;

export const cloudReady = Boolean(endpoint && publishableKey);

export const cloud =
  endpoint && publishableKey
    ? createWorkBuddyCloud({ endpoint, publishableKey })
    : null;
