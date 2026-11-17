import { auth } from "@/lib/auth";
import { BlastLevelsGame } from "@/components/arcade/blast-levels-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeBlastLevelsPage() {
  const session = await auth();

  return (
    <GamePage
      title="单词消消乐"
      tag="12 关闯关"
      desc="真题高频难词按难度分成 12 关，每关 10 对英中释义，120 秒内清完通过，过关解锁下一关。"
      footer={<span>进度和最佳分存在本机；这一关的词不在生词本里，想收藏去词书导入。</span>}
    >
      {session?.user ? <BlastLevelsGame /> : <LoginGate what="单词消消乐" />}
    </GamePage>
  );
}
