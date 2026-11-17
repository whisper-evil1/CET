import { auth } from "@/lib/auth";
import { SentenceGame } from "@/components/arcade/sentence-game";
import { GamePage, LoginGate } from "@/components/arcade/game-page";

export const dynamic = "force-dynamic";

export default async function ArcadeSentencePage() {
  const session = await auth();

  return (
    <GamePage
      title="句子重组"
      tag="拼句型"
      desc="看中文句意，把打乱的英文单词点回正确语序。一局 5 句，全部来自四六级作文和翻译的高频表达。"
      footer={<span>拼错不扣分，可以反复重排 —— 这个游戏练的是句型语感。</span>}
    >
      {session?.user ? <SentenceGame /> : <LoginGate what="句子重组" />}
    </GamePage>
  );
}
