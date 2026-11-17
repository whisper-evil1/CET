import { auth } from "@/lib/auth";
import { ListenGame } from "@/components/arcade/listen-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeListenPage() {
  const session = await auth();

  return (
    <GamePage
      title="听音辨词"
      tag="听发音选释义"
      desc="听一个单词的发音，从四条中文释义里选出对的，共 10 轮。每轮自动念一遍，没听清可以点喇叭重听。"
      footer={<span>发音先用词典音频，取不到再用浏览器语音合成。</span>}
    >
      {session?.user ? <ListenGame /> : <LoginGate what="听音辨词" />}
    </GamePage>
  );
}
