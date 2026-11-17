import { auth } from "@/lib/auth";
import { MemoryGame } from "@/components/arcade/memory-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeMemoryPage() {
  const session = await auth();

  return (
    <GamePage
      title="翻牌配对"
      tag="记忆翻牌"
      desc="12 张背面朝上的牌，一次翻两张找「英文 ↔ 中文」的配对。对不上会自己盖回去，步数越少分越高。"
      footer={<span>判分只看步数，慢一点想清楚比乱翻更划算。</span>}
    >
      {session?.user ? <MemoryGame /> : <LoginGate what="翻牌配对" />}
    </GamePage>
  );
}
