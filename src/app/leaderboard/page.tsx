import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { LeaderboardClient } from "@/components/leaderboard/leaderboard-client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 排行榜 + 打卡页
export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/leaderboard");

  return (
    <div className="min-h-screen">
      <SiteHeader active="leaderboard" />
      <main className="mx-auto max-w-[960px] px-5 py-10">
        <div className="mb-6">
          <h1 className="font-serif text-[28px] text-ink">排行榜</h1>
          <p className="mt-2 text-[13px] text-ink-mute">
            四级/六级分开排行，周榜与月榜实时更新。坚持答题与打卡，分数会自动累计。
          </p>
        </div>
        <LeaderboardClient />
      </main>
    </div>
  );
}
