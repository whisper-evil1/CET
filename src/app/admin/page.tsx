import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

/** 管理员邮箱白名单，从环境变量读，逗号分隔 */
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * 管理后台：看注册用户和题库。
 * 访问控制靠 ADMIN_EMAILS 环境变量，登录账号的邮箱在里面才放行。
 * 这是个轻量后台，不做复杂 RBAC，够线上排查用户和题库数据用。
 */
export default async function AdminPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  const admins = getAdminEmails();

  // 没登录或不是管理员，直接扔回首页，不暴露后台存在
  if (!email || !admins.has(email)) {
    redirect("/");
  }

  // 用户列表：带上做题数、生词数、收藏数，用 _count 一次查出来
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      _count: {
        select: { answers: true, vocab: true, favorites: true },
      },
    },
  });

  // 题库：试卷 + 每篇的题目数
  const papers = await prisma.paper.findMany({
    orderBy: { level: "asc" },
    include: {
      passages: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          _count: { select: { questions: true } },
        },
      },
    },
  });

  const totalQuestions = papers.reduce(
    (sum, p) => sum + p.passages.reduce((s, pa) => s + pa._count.questions, 0),
    0,
  );

  return (
    <div className="min-h-screen">
      <SiteHeader active="home" />

      <main className="mx-auto max-w-[1180px] px-5 pb-24">
        <section className="flex items-end justify-between border-b border-line py-8">
          <div>
            <h1 className="font-serif text-[26px] text-ink">管理后台</h1>
            <p className="mt-1 text-[12.5px] text-ink-mute">
              当前账号 {email} · 可查看注册用户与题库数据
            </p>
          </div>
          <LogoutButton />
        </section>

        {/* 用户列表 */}
        <section className="mt-10">
          <h2 className="font-serif text-[18px] text-ink">
            注册用户（{users.length}）
          </h2>
          <div className="mt-3 overflow-x-auto border-t border-line">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] tracking-wider text-ink-mute">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-normal">邮箱</th>
                  <th className="py-2 pr-4 font-normal">昵称</th>
                  <th className="py-2 pr-4 font-normal">注册时间</th>
                  <th className="py-2 pr-4 font-normal text-right">做题</th>
                  <th className="py-2 pr-4 font-normal text-right">生词</th>
                  <th className="py-2 pr-4 font-normal text-right">收藏</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line/60">
                    <td className="py-2.5 pr-4 font-mono text-[12px] text-ink">
                      {u.email}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-soft">{u.name ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-ink-mute">
                      {new Date(u.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-ink-soft">
                      {u._count.answers}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-ink-soft">
                      {u._count.vocab}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono text-ink-soft">
                      {u._count.favorites}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-ink-mute">
                      还没有注册用户
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 题库 */}
        <section className="mt-12">
          <h2 className="font-serif text-[18px] text-ink">
            题库（{papers.length} 套试卷 · 共 {totalQuestions} 题）
          </h2>
          <ul className="mt-3 border-t border-line">
            {papers.map((paper) => {
              const qCount = paper.passages.reduce(
                (s, p) => s + p._count.questions,
                0,
              );
              return (
                <li key={paper.id} className="border-b border-line py-4">
                  <div className="flex items-center gap-4">
                    <span className="w-14 shrink-0 font-mono text-[11px] text-accent">
                      {paper.level}
                    </span>
                    <span className="flex-1 font-serif text-[15px] text-ink">
                      {paper.title}
                    </span>
                    <span className="text-[12px] text-ink-mute">{qCount} 题</span>
                  </div>
                  <ul className="mt-2 ml-[68px] space-y-1 text-[12px] text-ink-mute">
                    {paper.passages.map((p) => (
                      <li key={p.id}>
                        {p.title ?? "（未命名篇章）"} · {p._count.questions} 题
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
            {papers.length === 0 && (
              <li className="py-10 text-center text-ink-mute">
                题库为空，先运行 npm run db:seed 灌入试卷
              </li>
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
