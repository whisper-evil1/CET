import { auth } from "@/lib/auth";
import { SnakeGame } from "@/components/arcade/snake-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeSnakePage() {
  const session = await auth();

  return (
    <GamePage
      title="单词贪吃蛇"
      tag="经典 + 背词"
      desc="场上同时有 3 个单词食物，照着释义吃掉对的那条。吃对变长加速，吃错缩短，撞墙即终。"
      footer={<span>手机在画布上滑动转向，电脑方向键 / WASD。</span>}
    >
      {session?.user ? <SnakeGame /> : <LoginGate what="单词贪吃蛇" />}
    </GamePage>
  );
}
