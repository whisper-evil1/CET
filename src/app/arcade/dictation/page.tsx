import { auth } from "@/lib/auth";
import { DictationGame } from "@/components/arcade/dictation-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeDictationPage() {
  const session = await auth();

  return (
    <GamePage
      title="听写填空"
      tag="听句子 · 写下来"
      desc="一句一句听，听完整句再写。支持 0.85× 慢速与逐句重听，判分逐词标出错在哪——拼错的划掉、漏写的标黄。"
      footer={<span>朗读引擎与听力做题同一个，这里练顺了，做题不会换一种声音。</span>}
    >
      {session?.user ? <DictationGame /> : <LoginGate what="听写填空" />}
    </GamePage>
  );
}
