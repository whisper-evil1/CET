import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { VocabClient } from "@/components/vocab/vocab-client";

export const dynamic = "force-dynamic";

export default async function VocabPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?next=/vocab");

  return (
    <div className="min-h-screen">
      <SiteHeader active="vocab" />
      <main className="pt-2">
        <VocabClient />
      </main>
    </div>
  );
}
