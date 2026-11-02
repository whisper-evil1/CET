/**
 * 端到端冒烟测试：不依赖浏览器，直接打接口。
 * 覆盖：登录态、试卷详情不下发答案、判题、解析、私密留言跨账号隔离、
 *      收藏、生词唯一性、认识三次进已掌握、查词、AI 流式。
 *
 * 用法：先 npm run dev，再 node scripts/smoke.mjs
 */

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const PAPER = "paper-cet4-2024-12";
const Q1 = "paper-cet4-2024-12-q46";
const Q2 = "paper-cet4-2024-12-q47";

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}

/** 极简 cookie jar */
function makeSession() {
  const jar = new Map();
  return {
    jar,
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    absorb(response) {
      const cookies = response.headers.getSetCookie?.() ?? [];
      for (const cookie of cookies) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || value === "deleted") jar.delete(name);
        else jar.set(name, value);
      }
    },
    async fetch(path, init = {}) {
      const response = await fetch(`${BASE}${path}`, {
        ...init,
        redirect: "manual",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(jar.size ? { Cookie: this.header() } : {}),
          ...(init.headers ?? {}),
        },
      });
      this.absorb(response);
      return response;
    },
  };
}

async function login(email, password) {
  const session = makeSession();

  const csrfResponse = await session.fetch("/api/auth/csrf");
  const { csrfToken } = await csrfResponse.json();

  const form = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: `${BASE}/`,
    json: "true",
  });

  await session.fetch("/api/auth/callback/credentials", {
    method: "POST",
    body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const whoami = await session.fetch("/api/auth/session");
  const data = await whoami.json();
  return { session, email: data?.user?.email ?? null };
}

async function json(session, path, init) {
  const response = await session.fetch(path, init);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function main() {
  console.log("\n[1] 未登录访问");
  {
    const anon = makeSession();
    const { status } = await json(anon, "/api/answers?paperId=" + PAPER);
    check("未登录访问受保护接口返回 401", status === 401, `实际 ${status}`);
  }

  console.log("\n[2] 登录演示账号");
  const demo = await login("demo@cet.local", "demo1234");
  check("demo 登录成功", demo.email === "demo@cet.local", `实际 ${demo.email}`);

  console.log("\n[3] 试卷详情不含答案");
  {
    const { body } = await json(demo.session, `/api/papers/${PAPER}`);
    // v2.0 返回 sections[].passages[]，定位阅读篇（id 以 -p1 结尾，5 段 5 题）
    const sections = body?.data?.sections ?? [];
    const allPassages = sections.flatMap((s) => s.passages ?? []);
    const passage = allPassages.find((p) => p.id === `${PAPER}-p1`) ?? allPassages[0];
    const question = passage?.questions?.[0];
    check("返回 5 道题", passage?.questions?.length === 5);
    check("题干与选项齐全", Boolean(question?.stem && question?.options?.length === 4));
    check(
      "payload 里没有 answer / analysis 字段",
      !("answer" in (question ?? {})) && !("analysis" in (question ?? {})),
    );
    check("段落按 A-E 渲染", passage?.paragraphs?.length === 5);
  }

  console.log("\n[4] 判题与解析");
  {
    const correct = await json(demo.session, "/api/answers", {
      method: "POST",
      body: JSON.stringify({ questionId: Q1, choice: "B" }),
    });
    check("选对判定 isCorrect=true", correct.body?.data?.isCorrect === true);
    check("返回解析与逐项分析", Boolean(correct.body?.data?.analysis && correct.body?.data?.optionAnalysis));
    check("返回依据段落", correct.body?.data?.evidencePara === "A");

    const wrong = await json(demo.session, "/api/answers", {
      method: "POST",
      body: JSON.stringify({ questionId: Q2, choice: "A" }),
    });
    check("选错判定 isCorrect=false", wrong.body?.data?.isCorrect === false);
    check("正确答案仍下发给已作答的人", wrong.body?.data?.answer === "C");

    const invalid = await json(demo.session, "/api/answers", {
      method: "POST",
      body: JSON.stringify({ questionId: Q1, choice: "Z" }),
    });
    check("非法选项被 zod 拦下", invalid.status === 400, `实际 ${invalid.status}`);

    const mine = await json(demo.session, `/api/answers?paperId=${PAPER}`);
    check("可回读自己的作答记录", mine.body?.data?.length >= 2);
  }

  console.log("\n[5] 解析回看会记录 viewedAnalysis");
  {
    const analysis = await json(demo.session, `/api/questions/${Q1}/analysis`);
    check("能拿到解析", Boolean(analysis.body?.data?.analysis));
  }

  console.log("\n[6] 私密留言跨账号隔离");
  let privateId = null;
  {
    const created = await json(demo.session, `/api/questions/${Q1}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: "<script>alert(1)</script>只有我能看到的笔记", visibility: "private" }),
    });
    privateId = created.body?.data?.id ?? null;
    check("demo 发布私密笔记成功", Boolean(privateId));
    check(
      "XSS 标签被清洗掉",
      created.body?.data?.content === "只有我能看到的笔记",
      `实际内容：${created.body?.data?.content}`,
    );

    const publicOne = await json(demo.session, `/api/questions/${Q1}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: "这条是公开讨论", visibility: "public" }),
    });
    check("demo 发布公开讨论成功", publicOne.body?.code === 0);

    const demoList = await json(demo.session, `/api/questions/${Q1}/comments?scope=all`);
    check("demo 自己能看到两条", demoList.body?.data?.length === 2, `实际 ${demoList.body?.data?.length}`);

    const alice = await login("alice@cet.local", "demo1234");
    check("alice 登录成功", alice.email === "alice@cet.local");

    const aliceList = await json(alice.session, `/api/questions/${Q1}/comments?scope=all`);
    const aliceContents = (aliceList.body?.data ?? []).map((c) => c.content);
    check("alice 看不到 demo 的私密笔记", !aliceContents.some((c) => c.includes("只有我能看到")));
    check("alice 能看到公开讨论", aliceContents.includes("这条是公开讨论"), JSON.stringify(aliceContents));

    if (privateId) {
      const like = await json(alice.session, `/api/comments/${privateId}/like`, { method: "POST" });
      check("他人无法给私密留言点赞", like.status === 403 || like.status === 400, `实际 ${like.status}`);

      const patch = await json(alice.session, `/api/comments/${privateId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "public" }),
      });
      check("他人无法改别人的留言可见性", patch.status === 403, `实际 ${patch.status}`);
    }

    // 作者本人把私密改成公开，然后 alice 应该能看到
    if (privateId) {
      const patch = await json(demo.session, `/api/comments/${privateId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "public" }),
      });
      check("作者可以把私密改为公开", patch.body?.data?.visibility === "public");

      const aliceAgain = await json(alice.session, `/api/questions/${Q1}/comments?scope=all`);
      check(
        "改为公开后 alice 能看到",
        (aliceAgain.body?.data ?? []).some((c) => c.content.includes("只有我能看到")),
      );

      const revert = await json(demo.session, `/api/comments/${privateId}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: "private" }),
      });
      check("公开后不允许撤回为私密", revert.status === 400, `实际 ${revert.status}`);
    }
  }

  console.log("\n[7] 收藏");
  {
    const on = await json(demo.session, `/api/favorites/${Q2}`, { method: "POST" });
    check("收藏成功", on.body?.data?.favorited === true);
    const list = await json(demo.session, "/api/favorites");
    check(
      "收藏列表按试卷分组",
      (list.body?.data?.[0]?.items ?? []).some((i) => i.questionId === Q2),
      JSON.stringify(list.body?.data?.[0]?.items?.[0] ?? null),
    );
    const off = await json(demo.session, `/api/favorites/${Q2}`, { method: "POST" });
    check("再点一次取消收藏", off.body?.data?.favorited === false);
    await json(demo.session, `/api/favorites/${Q2}`, { method: "POST" }); // 留一条收藏
  }

  console.log("\n[8] 生词：唯一性 + 认识三次进已掌握");
  {
    const payload = {
      word: "Nostalgia",
      phonetic: "/nɒˈstældʒə/",
      definitions: [{ pos: "n.", zh: "怀旧，念旧之情" }],
      example: "Nostalgia alone cannot explain the rise.",
      sourceContext: "The obvious explanation — nostalgia — does not survive contact with the numbers.",
    };
    const first = await json(demo.session, "/api/vocab", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const second = await json(demo.session, "/api/vocab", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    check("同一单词只存一条", first.body?.data?.id === second.body?.data?.id);
    check("单词统一小写存储", second.body?.data?.word === "nostalgia");

    const id = first.body?.data?.id;
    const r1 = await json(demo.session, `/api/vocab/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ result: "known" }),
    });
    const r2 = await json(demo.session, `/api/vocab/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ result: "unknown" }),
    });
    check("认识一次 reviewCount=1", r1.body?.data?.reviewCount === 1);
    check("不认识不增加计数", r2.body?.data?.reviewCount === 1);
    check("仍留在学习队列", r2.body?.data?.status === "learning");

    await json(demo.session, `/api/vocab/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ result: "known" }),
    });
    const r4 = await json(demo.session, `/api/vocab/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ result: "known" }),
    });
    check("累计认识 3 次变为已掌握", r4.body?.data?.status === "mastered", JSON.stringify(r4.body));

    const learning = await json(demo.session, "/api/vocab?status=learning");
    check(
      "已掌握的词从学习队列消失",
      !(learning.body?.data ?? []).some((w) => w.word === "nostalgia"),
    );

    const reset = await json(demo.session, `/api/vocab/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "reset" }),
    });
    check("可以移回生词本", reset.body?.data?.status === "learning");
  }

  console.log("\n[9] 查词");
  {
    const hit = await json(demo.session, "/api/lookup", {
      method: "POST",
      body: JSON.stringify({ word: "nostalgia" }),
    });
    check("内置词库命中 nostalgia", hit.body?.data?.found === true);
    check("返回中文释义", Boolean(hit.body?.data?.entry?.definitions?.[0]?.zh));

    const cached = await json(demo.session, "/api/lookup", {
      method: "POST",
      body: JSON.stringify({ word: "nostalgia" }),
    });
    check("第二次走缓存", cached.body?.data?.entry?.source === "cache");

    const typical = await json(demo.session, "/api/lookup", {
      method: "POST",
      body: JSON.stringify({ word: "typists" }),
    });
    check("复数形式能还原到原词", typical.body?.data?.entry?.word === "typists");
    check("还原后拿到释义", Boolean(typical.body?.data?.entry?.definitions?.[0]?.zh));

    const miss = await json(demo.session, "/api/lookup", {
      method: "POST",
      body: JSON.stringify({ word: "zzzznotaword" }),
    });
    check("查不到时给友好提示而不是报错", miss.body?.data?.found === false && Boolean(miss.body?.data?.hint));
  }

  console.log("\n[10] AI 流式答疑");
  {
    const response = await demo.session.fetch("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        questionId: Q1,
        messages: [{ role: "user", content: "这题为什么选 B？" }],
      }),
    });
    check("流式接口返回 200", response.status === 200, `实际 ${response.status}`);
    const mode = response.headers.get("X-AI-Mode");
    check("响应头标明 live/mock 模式", mode === "live" || mode === "mock", `实际 ${mode}`);
    const text = await response.text();
    check("流式内容非空", text.length > 20, `长度 ${text.length}`);
  }

  console.log("\n[11] 统计与脏数据校验");
  {
    const stats = await json(demo.session, "/api/me/stats");
    check("统计数据可读", typeof stats.body?.data?.answeredCount === "number");
    check("正确率在 0-100 之间", stats.body?.data?.accuracy >= 0 && stats.body?.data?.accuracy <= 100);

    const tooLong = await json(demo.session, `/api/questions/${Q1}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: "x".repeat(600), visibility: "private" }),
    });
    check("超长留言被拦下", tooLong.status === 400, `实际 ${tooLong.status}`);
  }

  console.log("\n[12] AI 经验包");
  {
    const first = await json(demo.session, `/api/questions/${Q1}/experience`);
    const pack = first.body?.data?.pack;
    check("读取经验包返回 200", first.status === 200, `实际 ${first.status}`);
    check("经验包含『这题的坑』", typeof pack?.pitfall === "string" && pack.pitfall.length > 0);
    check("经验包含正确思路", typeof pack?.correctApproach === "string" && pack.correctApproach.length > 0);
    check("常错原因与高频生词为数组", Array.isArray(pack?.commonMistakes) && Array.isArray(pack?.keyVocab));

    const cached = await json(demo.session, `/api/questions/${Q1}/experience`);
    check("二次读取走缓存且内容一致", cached.body?.data?.pack?.pitfall === pack?.pitfall);

    const refreshed = await json(demo.session, `/api/questions/${Q1}/experience`, { method: "POST", body: JSON.stringify({}) });
    check("刷新重建经验包成功", refreshed.status === 200 && typeof refreshed.body?.data?.pack?.pitfall === "string");

    const unauth = await fetch(`${BASE}/api/questions/${Q1}/experience`);
    check("未登录访问经验包返回 401", unauth.status === 401, `实际 ${unauth.status}`);
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n冒烟测试异常：", error);
  process.exit(1);
});
