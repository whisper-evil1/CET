import { auth } from "@/lib/auth";
import { GuardGame } from "@/components/arcade/guard-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeGuardPage() {
  const session = await auth();

  return (
    <GamePage
      title="单词保卫战"
      tag="打字守城"
      desc="陨石带着单词坠落，照着下方释义把单词打进输入框击落它。陨石落地摧毁一座城，守住 3 座城。"
      footer={<span>电脑全程盲打；手机点图例里的释义即可自动填词。</span>}
    >
      {session?.user ? <GuardGame /> : <LoginGate what="单词保卫战" />}
    </GamePage>
  );
}
