import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 构建产物目录。
   *
   * 默认 `.next`，部署环境无需设置。之所以支持环境变量覆盖：
   * 本地构建时 `.next` 偶尔会被上一次运行的服务进程残留句柄占住，
   * Next 在写 `.next/trace` 时会报 EPERM，而清目录又可能被安全策略拦下。
   * 此时用 `NEXT_DIST_DIR=.next-build npm run build` 换一个干净目录即可继续，
   * 不需要动项目其他部分（`next start` 会自动读同一个配置）。
   */
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",

  /**
   * 语音合成库必须留在 Node 侧原样加载。
   *
   * msedge-tts 依赖 `ws` 这个原生 WebSocket 实现，打包器一旦把它揉进
   * server bundle，运行时就会因为拿不到 Node 的 net/tls 而连不上。
   * 放进 external 后由 require 直接加载，构建产物里只留一句引用。
   */
  serverExternalPackages: ["msedge-tts"],
};

export default nextConfig;
