import { auth } from "@/lib/auth";
import { SpellGame } from "@/components/arcade/spell-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeSpellPage() {
  const session = await auth();

  return (
    <GamePage
      title="拼写达人"
      tag="看释义拼单词"
      desc="给中文释义和首尾字母，把单词完整拼出来。3 条命，拼对 8 个通关，拼错一次掉一条，连对得分更高。"
      footer={<span>拼错的词会推回生词本，下一轮 10 分钟后再考。</span>}
    >
      {session?.user ? <SpellGame /> : <LoginGate what="拼写达人" />}
    </GamePage>
  );
}
