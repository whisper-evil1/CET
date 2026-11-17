import Link from "next/link";
import { auth } from "@/lib/auth";
import { BlastGame } from "@/components/arcade/blast-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeBlastPage() {
  const session = await auth();

  return (
    <GamePage
      title="词义消除"
      tag="配对消除"
      desc="16 张牌、8 对英中释义，90 秒内全部消掉。连击越长单次得分越高，消掉一对就把那个词的复习间隔往后推一档。"
      footer={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>词源：生词本优先，不足时补四级高频词。</span>
          <Link href="/arcade/blast-levels" className="g-blue hover:underline">
            换 12 关闯关模式 →
          </Link>
        </span>
      }
    >
      {session?.user ? <BlastGame /> : <LoginGate what="词义消除" />}
    </GamePage>
  );
}
