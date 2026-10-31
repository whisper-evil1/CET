import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 排行榜页面（阶段 6 完整实现，先放占位）
export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/leaderboard");

  return (
    <div className="min-h-screen">
      <SiteHeader active="leaderboard" />
      <main className="mx-auto max-w-[960px] px-5 py-16 text-center">
        <h1 className="font-serif text-[28px] text-ink">排行榜</h1>
        <p className="mt-4 text-[14px] text-ink-mute">
          正在开发中 · 四级/六级分开排行 · 周榜/月榜 · 综合评分（打卡 + 正确率 + 生词）
        </p>
      </main>
    </div>
  );
}
