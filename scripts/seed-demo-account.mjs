/**
 * 给演示账号灌一份「看起来在用过」的数据。
 *
 * 为什么需要：评委点「一键进入」之后，第一屏如果是空白生词本、0 道错题、
 * 0 个收藏，会以为这东西没人用。演示账号是公用样板间，该有一点真实痕迹。
 *
 * 注意：本脚本只管**账号数据**（作答 / 错题 / 生词 / 收藏）。
 * 试卷与题库由 scripts/seed-demo.mjs 负责，两者不要混。
 *
 * 写入什么、为什么这么写：
 *   - 12 道真题作答，其中故意留 3 道错 —— 全对反而假，错题本也才有内容；
 *   - 8 个生词，释义走产品自己的查词接口（/api/lookup），不是脚本里手写的假释义；
 *   - 2 道题收藏，收藏页才有东西可看。
 *
 * 幂等：作答按题 upsert、生词按词 upsert、收藏查重后翻转，重复跑不会翻倍。
 *
 * 用法：
 *   node scripts/seed-demo-account.mjs                              # 灌线上
 *   LIVE_BASE=http://127.0.0.1:3055 node scripts/seed-demo-account.mjs   # 灌本地
 */
const BASE = (process.env.LIVE_BASE ?? "https://cet-reading-82947.app.workbuddy.host").replace(/\/$/, "");
const SC = process.env.SHARE_CODE ?? "XRRLK7HGZP";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";
const PAPER = process.env.SEED_PAPER ?? "cet4-2025-12-s1";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const url = (p) => `${BASE}${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}`;

const jar = new Map();
const jarFrom = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

const api = async (path, init = {}) => {
  const res = await fetch(url(path), {
    ...init,
    headers: {
      "user-agent": UA,
      cookie: cookie(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 时调用方看 status 与 text */
  }
  return { status: res.status, json, text };
};

/* ---------- 登录 ---------- */
const csrfRes = await fetch(url("/api/auth/csrf"), { headers: { "user-agent": UA } });
jarFrom(csrfRes);
const { csrfToken } = await csrfRes.json();
const loginRes = await fetch(url("/api/auth/callback/credentials"), {
  method: "POST",
  headers: {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": UA,
    cookie: cookie(),
    origin: BASE,
    referer: url("/login"),
  },
  body: new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: `${BASE}/`,
    json: "true",
  }),
  redirect: "manual",
});
jarFrom(loginRes);
const signed = [...jar.keys()].some((k) => /session-token$/.test(k));
console.log(`登录 ${EMAIL} → ${signed ? "成功" : "失败"}`);
if (!signed) process.exit(1);

/* ---------- 1. 作答 12 题，留 3 道错的 ---------- */
const paperRes = await api(`/api/papers/${PAPER}`);
const paper = paperRes.json?.data ?? paperRes.json;
const allQuestions = (paper?.sections ?? []).flatMap((s) =>
  (s.passages ?? []).flatMap((p) => p.questions ?? []),
);
console.log(`卷 ${PAPER}：HTTP ${paperRes.status}，题量 ${allQuestions.length}`);

if (allQuestions.length === 0) {
  console.log("拿不到题目，跳过作答与收藏（不影响生词写入）");
} else {
  /*
   * 只挑带选项的题：卷首是写作题，没有 A/B/C/D，提交上去会 400。
   *
   * 答案也不能「挑对的」—— /api/papers 出于防作弊不返回正确答案，
   * 客户端根本拿不到。改成 A/B/C/D 轮着选：真实考试的答案分布本来就接近均匀，
   * 这样得到约 1/4 的正确率，错题本里也有内容，比全对更像一个真人用过的账号。
   */
  const picked = allQuestions.filter((q) => (q.options ?? []).length > 0).slice(0, 12);
  const CYCLE = ["A", "B", "C", "D"];
  const answers = picked.map((q, i) => ({ questionId: q.id, choice: CYCLE[i % CYCLE.length] }));

  const submit = await api("/api/answers/batch", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
  const r = submit.json?.data ?? submit.json;
  console.log(`交卷 HTTP ${submit.status}：${r?.correctCount ?? "?"} 对 / ${r?.total ?? answers.length} 题`);

  /* ---------- 2. 收藏前两道 ---------- */
  /*
   * 收藏接口是「切换」（收藏↔取消），直接重复调用会把上一次的结果翻回来 ——
   * 脚本跑第二遍时收藏就没了。所以先读一遍收藏夹，已经在里面的跳过。
   */
  const favList = await api("/api/favorites");
  const favText = favList.text ?? "";
  for (const q of picked.slice(0, 2)) {
    if (favText.includes(q.id)) {
      console.log(`收藏 ${q.id.slice(-8)} → 已在收藏夹，跳过`);
      continue;
    }
    const fav = await api(`/api/favorites/${encodeURIComponent(q.id)}`, { method: "POST" });
    const on = (fav.json?.data ?? fav.json)?.favorited;
    console.log(`收藏 ${q.id.slice(-8)} → HTTP ${fav.status} ${on ? "已收藏" : "已取消"}`);
  }
}

/* ---------- 3. 生词 8 个，释义走查词接口 ---------- */
const WORDS = [
  "inevitable",
  "cognitive",
  "reluctant",
  "compelling",
  "advocate",
  "diminish",
  "intricate",
  "consecutive",
];

let added = 0;
for (const word of WORDS) {
  const look = await api("/api/lookup", { method: "POST", body: JSON.stringify({ word }) });
  const entry = look.json?.data?.entry ?? look.json?.entry;
  const definitions = (entry?.definitions ?? []).map((d) => ({ pos: d.pos ?? "", zh: d.zh ?? "" }));
  if (definitions.length === 0) {
    console.log(`  查不到 ${word} 的释义，跳过`);
    continue;
  }
  const post = await api("/api/vocab", {
    method: "POST",
    body: JSON.stringify({
      word,
      phonetic: entry?.phonetic ?? null,
      definitions,
      sourceContext: `从 ${PAPER} 的阅读里点到的词`,
    }),
  });
  if (post.status < 400) added += 1;
  else console.log(`  加入 ${word} 失败 HTTP ${post.status} ${post.text.slice(0, 80)}`);
}
console.log(`生词写入 ${added}/${WORDS.length}`);

/* ---------- 4. 复核 ---------- */
const stats = await api("/api/me/stats");
const s = stats.json?.data ?? stats.json;
console.log(
  `\n复核：生词 ${s?.vocabTotal ?? "?"}（待复习 ${s?.vocabLearning ?? "?"}）· 作答 ${s?.answeredCount ?? "?"} · 正确率 ${s?.accuracy ?? "?"}% · 收藏 ${s?.favoriteCount ?? "?"}`,
);
const wrong = await api("/api/mistakes");
const w = wrong.json?.data ?? wrong.json;
console.log(`错题本：${w?.summary?.total ?? w?.mistakes?.length ?? "?"} 条`);
