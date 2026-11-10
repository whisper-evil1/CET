import { auth } from "@/lib/auth";
import { SprintGame } from "@/components/arcade/sprint-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeSprintPage() {
  const session = await auth();

  return (
    <GamePage
      title="60 秒快问快答"
      tag="极限连击"
      desc="看词选义、看义选词、听音选义三种题型混着来，60 秒极限连击，连击越长单题加分越高。"
      footer={<span>答错的词会标出来，本局结束统一回顾。</span>}
    >
      {session?.user ? <SprintGame /> : <LoginGate what="60 秒快问快答" />}
    </GamePage>
  );
}
