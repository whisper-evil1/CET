/**
 * 云服务公开配置（publicConfig）。
 *
 * 这两个值来自 workbuddy_cloud_service 的 activate 结果，属于可以随前端产物一起发布的
 * 公开信息：publishableKey 只标识「哪个应用」，本身不携带任何权限，安全性由服务端按
 * Origin 精确匹配提供。真正的密钥（环境 id、provider key）只在服务端，永远不会出现在这里。
 *
 * 为什么写进源码而不是只放 .env：
 *   NEXT_PUBLIC_* 必须在构建期被 inline 进前端 bundle。构建发生在部署沙箱里，
 *   而 .env 是否随源码一起上传不受本项目控制 —— 一旦构建环境读不到 .env，
 *   产物里就会留着上一轮的旧域名，表现为「发布成功但页面仍在请求旧地址」。
 *   写进源码后，值随源码一起上传、随构建一起生效，不存在这层不确定性。
 *
 * 换发布域名时：这里要和新的 endpoint 一起改，并重新构建。
 * 服务端按 Origin 精确匹配，域名与 endpoint 不一致会直接落到 auth_ 类错误。
 */
export const CLOUD_PUBLIC_CONFIG = {
  /** 应用「左文右题」的数据面基址，与发布域名一致 */
  endpoint: "https://cet-reading-02555.app.workbuddy.host",
  /** 应用标识，无权限 */
  publishableKey: "wbpk_MfXmaijifCP3WLo92qALnn_wYmIQ4U7JdFOKbrvG7HBzs31bGvAwo5Y",
  /** Web 端第三方登录（微信扫码 / WorkBuddy 账号）走中心 Relay，本应用暂未启用，先留着备用 */
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
} as const;
