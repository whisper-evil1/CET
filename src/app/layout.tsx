import type { Metadata } from "next";
import "./globals.css";
import "./legacy.css";
import { ShareCodeSync } from "@/components/share-code-sync";
import { POLYFILLS, FLOOR_CHECK } from "@/lib/compat-scripts";

/**
 * 不引 next/font/google：设计上正文用系统衬线 + 中文黑体栈（见 globals.css 的 --font-serif / --font-sans），
 * 好处是零字体请求、构建不依赖外网，首屏不闪字。
 */
export const metadata: Metadata = {
  title: "左文右题 · 四六级阅读刷题",
  description:
    "左边滚动原文，右边答题，两栏互不干扰。点词即查、生词自动进库循环复习，每题都能问 AI、写笔记。",
};

/**
 * 老内核样式探测，必须最早执行（放在 <head> 里、样式表之前）。
 *
 * Tailwind v4 的产物全部包在 @layer 里，不支持 cascade layers 的内核
 * （Chrome < 99，以及百度、迅雷这类内置浏览器）会把整块规则丢弃，
 * 页面只剩少数未分层的基础样式 —— 用户看到的就是「导航是蓝色下划线链接」的裸奔页。
 *
 * CSSLayerBlockRule 是 @layer 的精确特征，比用 color-mix 之类语法做代理更可靠。
 * 写成 ES5 原生脚本、不经打包，避免被降级目标影响；判断失败也绝不阻断页面。
 */
const LEGACY_CSS_PROBE = `(function(){try{if(!("CSSLayerBlockRule" in window)){document.documentElement.setAttribute("data-css-fallback","1");}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning：head 里的 LEGACY_CSS_PROBE 探针会在 hydration 前
    // 给 <html> 补 data-css-fallback 属性，React 19 生产模式把根元素属性差异
    // 当成 hydration mismatch 抛 #418，登录态首屏白白多一次客户端重渲染。
    // 只抑制根元素自身的属性差异，子树照常严格校验。
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 必须排在所有应用脚本之前：老内核缺 Array.prototype.at / Object.hasOwn 等内置方法，
            Next 自己的运行时就会抛 TypeError，页面直接失去交互（见 lib/compat-scripts.ts）。 */}
        <script dangerouslySetInnerHTML={{ __html: POLYFILLS }} />
        <script dangerouslySetInnerHTML={{ __html: LEGACY_CSS_PROBE }} />
      </head>
      <body className="min-h-full antialiased">
        {/* 语法都解析不了的内核里，任何脚本都跑不起来，这里给一句人话解释 */}
        <script dangerouslySetInnerHTML={{ __html: FLOOR_CHECK }} />
        {/* 同步分享码到 sessionStorage，并在平台拦截时自动跳回分享链接。
            反代环境下 __wb_rsc cookie 丢失会导致所有 API 403，必须兜底。 */}
        <ShareCodeSync />
        <noscript>
          <div
            style={{
              background: "#17181a",
              color: "#faf8f3",
              padding: "12px 16px",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            当前禁用了 JavaScript：文章和题目仍可阅读，但答题、查词、AI 解析等交互无法使用。开启后即可正常使用。
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
