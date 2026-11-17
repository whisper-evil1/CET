import { auth } from "@/lib/auth";
import { MoleGame } from "@/components/arcade/mole-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeMolePage() {
  const session = await auth();

  return (
    <GamePage
      title="单词打地鼠"
      tag="60 秒手速"
      desc="顶部给一条释义，9 个洞里冒出举着单词的地鼠，1.5 秒内敲中「释义对得上」的那只，连击加分。"
      footer={<span>敲中的词写回记忆曲线；手快不如眼准。</span>}
    >
      {session?.user ? <MoleGame /> : <LoginGate what="单词打地鼠" />}
    </GamePage>
  );
}
