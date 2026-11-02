/**
 * 云服务公开配置（publicConfig）。
 *
 * 这两个值来自 workbuddy_cloud_service 的 activate 结果，属于可以随前端产物一起发布的
 * 公开信息：publishableKey 只标识「哪个应用」，本身不携带任何权限，安全性由服务端按
 * Origin 精确匹配提供。真正的密钥（环境 id、provider key）只在服务端，永远不会出现在这里。
 *
 * 为什么保留写死的默认值（FALLBACK）：
 *   NEXT_PUBLIC_* 必须在构建期被 inline 进前端 bundle。构建发生在部署沙箱里，
 *   而 .env 是否随源码一起上传不受本项目控制 —— 一旦构建环境读不到 .env，
 *   产物里就会留着上一轮的旧域名，表现为「发布成功但页面仍在请求旧地址」。
 *   写进源码后，值随源码一起上传、随构建一起生效，不存在这层不确定性。
 *
 * 给别人部署时怎么换云实例（无需改源码）：
 *   设 NEXT_PUBLIC_CLOUD_ENDPOINT 与 NEXT_PUBLIC_CLOUD_PUBLISHABLE_KEY 两个构建期环境变量，
 *   会覆盖下面的默认值；不设置则回退到本项目的当前实例，保证现有部署不受影响。
 * 服务端按 Origin 精确匹配，endpoint 与部署域名不一致会直接落到 auth_ 类错误。
 *
 * 完全不用 WorkBuddy 云时（例如改用 .env 里的 AI_API_KEY 跑 AI 答疑）：
 *   设 NEXT_PUBLIC_CLOUD_ENABLED=false，云端不会被初始化，AI 答疑自动改走
 *   /api/ai/chat（AI_API_KEY 路径），账号镜像同步也会跳过。
 */

/** 是否启用 WorkBuddy 云服务。默认开启（本项目部署在 workbuddy.host）。 */
export const CLOUD_ENABLED =
  (process.env.NEXT_PUBLIC_CLOUD_ENABLED ?? "true").trim().toLowerCase() !== "false";

const FALLBACK_ENDPOINT = "https://cet-reading-02555.app.workbuddy.host";
const FALLBACK_PUBLISHABLE_KEY =
  "wbpk_MfXmaijifCP3WLo92qALnn_wYmIQ4U7JdFOKbrvG7HBzs31bGvAwo5Y";

/** endpoint：构建期可由 NEXT_PUBLIC_CLOUD_ENDPOINT 覆盖，否则用本项目实例 */
const endpoint = (process.env.NEXT_PUBLIC_CLOUD_ENDPOINT ?? "").trim() || FALLBACK_ENDPOINT;
/** publishableKey：构建期可由 NEXT_PUBLIC_CLOUD_PUBLISHABLE_KEY 覆盖，否则用本项目实例 */
const publishableKey =
  (process.env.NEXT_PUBLIC_CLOUD_PUBLISHABLE_KEY ?? "").trim() || FALLBACK_PUBLISHABLE_KEY;

export const CLOUD_PUBLIC_CONFIG = {
  /** 应用「左文右题」的数据面基址，与发布域名一致 */
  endpoint,
  /** 应用标识，无权限 */
  publishableKey,
  /** Web 端第三方登录（微信扫码 / WorkBuddy 账号）走中心 Relay，本应用暂未启用，先留着备用 */
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
} as const;
