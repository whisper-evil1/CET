import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * 背单词模式已经搬进生词本（/vocab?mode=review）。
 *
 * 保留这条路由只是为了让旧链接、书签和之前的分享不 404 ——
 * 产品上它不再是「游戏厅里的一关」，而是生词本自带的一个视图。
 * 未登录的用户会在 /vocab 那边被带去登录页（next 参数指回来）。
 */
export default function ArcadeReviewRedirect() {
  redirect("/vocab?mode=review");
}
