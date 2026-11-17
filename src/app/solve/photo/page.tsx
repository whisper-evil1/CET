import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { PhotoSolver } from "@/components/solve/photo-solver";

export const dynamic = "force-dynamic";

/** 拍照搜题：用户遇到不会的题，拍照上传由 Agent 识别并解答（不是刷题）。 */
export default async function PhotoSolvePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/solve/photo");

  return (
    <div className="min-h-screen">
      <SiteHeader active="create" />
      <main className="mx-auto max-w-[1080px] px-4 pb-24 sm:px-5">
        <section className="pt-7 sm:pt-9">
          <p className="text-[10.5px] tracking-[0.26em] text-accent uppercase">Photo Solve</p>
          <h1 className="mt-2 font-serif text-[26px] leading-tight text-ink sm:text-[32px]">
            不会的题，拍下来讲给你听
          </h1>
          <p className="mt-2 max-w-[58ch] text-[13px] leading-[1.85] text-ink-soft sm:text-[14px]">
            拍照或上传题目截图，Agent 会识别题干、分步解答并标出易错点。
            看不清时会请你补拍，不会硬猜答案。图片只用于本次识别，不留存。
          </p>
        </section>

        <PhotoSolver />
      </main>
    </div>
  );
}
