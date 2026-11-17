import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 背单词已并入「生词本」（/vocab 的「词书」tab）。
 * 保留这个路由，让老链接（首页、收藏夹里存的 /study）不 404，
 * 直接跳到生词本，并在 query 上标注让生词本直接落在「词书」页签。
 */
export default async function StudyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/vocab?tab=books");
  redirect("/vocab?tab=books");
}
