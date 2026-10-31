import type { Metadata } from "next";
import "./globals.css";

/**
 * 不引 next/font/google：设计上正文用系统衬线 + 中文黑体栈（见 globals.css 的 --font-serif / --font-sans），
 * 好处是零字体请求、构建不依赖外网，首屏不闪字。
 */
export const metadata: Metadata = {
  title: "左文右题 · 四六级阅读刷题",
  description:
    "左边滚动原文，右边答题，两栏互不干扰。点词即查、生词自动进库循环复习，每题都能问 AI、写笔记。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
