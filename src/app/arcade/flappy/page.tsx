import { auth } from "@/lib/auth";
import { FlappyGame } from "@/components/arcade/flappy-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeFlappyPage() {
  const session = await auth();

  return (
    <GamePage
      title="笨鸟先飞"
      tag="飞行 + 单词关"
      desc="点画面拍翅膀穿过管道，每过 3 道弹出单词四选一，答对继续飞，答错扣命。电脑手机都能玩。"
      footer={<span>弹出的单词题会写回记忆曲线，飞着飞着也在复习。</span>}
    >
      {session?.user ? <FlappyGame /> : <LoginGate what="笨鸟先飞" />}
    </GamePage>
  );
}
