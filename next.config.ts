import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * dev 与生产各用各的产物目录。
   *
   * 教训：默认两者共用 .next，先 `next build` 再 `next dev`，开发产物会把
   * 生产构建的 vendor-chunks 覆盖掉一半，之后 `next start` 全站 500
   * （报 Cannot find module './vendor-chunks/zod.js'，且 build 产物明明是好的）。
   * dev 走 .next-dev，生产永远读完整的 .next，这个坑就不会再踩。
   */
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",

  /**
   * 客户端兼容性：只降级这一个包。
   *
   * 用 acorn 逐 chunk 实测（scripts/syntax-floor.mjs）：产物里语法底线最高的是
   * @tencent-ai/workbuddy-cloud-sdk —— 它用了 class static 初始化块（ES2022），
   * 这把整个页面的门槛抬到 Chrome 94 / Safari 16.4，一挂就是「白屏 + 无交互」。
   * 其余 chunk 最高只到 ES2020（`?.` / `??`），来自 Next 自身的运行时，改不动也不需要改。
   *
   * 只把它交给 SWC 降级，底线就从 ES2022 落到 ES2020（Chrome 80 / Safari 13.1），
   * 再配合 layout 里的运行时 polyfill（.at / Object.hasOwn / replaceAll / structuredClone），
   * 老内核就能正常跑完所有交互。
   */
  transpilePackages: ["@tencent-ai/workbuddy-cloud-sdk"],
};

export default nextConfig;
