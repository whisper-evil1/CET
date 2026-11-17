/**
 * 词书（/study 数据层）本地验收：纯 HTTP，不开浏览器。
 *
 * 覆盖用户这一轮提的两件事：
 *   1. 可以自己建多本词书、能改名、能设默认、能删；
 *   2. 单个词加进书里时是「指定的那本」，且重复加不会产生两份；
 *      内置高频词书能复制一段进自己的书。
 *
 * 用法：node scripts/local-books-http.mjs [baseUrl]
 * 依赖本地已 `npm run build && npm run start -p 3055`。
 */

const BASE = (process.argv[2] ?? process.env.LOCAL_BASE ?? "http://127.0.0.1:3055").replace(/\/$/, "");
const EMAIL = process.env.LOCAL_EMAIL ?? "demo@cet.local";
const PASSWORD = process.env.LOCAL_PASSWORD ?? "demo1234";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function signIn() {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { "user-agent": UA } });
  absorb(csrfRes);
  const { csrfToken } = await csrfRes.json();

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      cookie: cookieHeader(),
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
  });
  absorb(res);
  const session = await fetch(`${BASE}/api/auth/session`, {
    headers: { "user-agent": UA, cookie: cookieHeader() },
  }).then((r) => r.json());
  return Boolean(session?.user?.email);
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "user-agent": UA,
      cookie: cookieHeader(),
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });
const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (path) => api(path, { method: "DELETE" });

async function main() {
  console.log(`BASE = ${BASE}\n`);

  const signed = await signIn();
  check("登录（demo@cet.local）", signed, signed ? "" : "会话没拿到，后面的检查都不可信");
  if (!signed) return finish();

  /* ---------- 1. 书架 ---------- */
  const shelf = await api("/api/books");
  const books = shelf.json?.data?.books ?? [];
  const kinds = new Set(books.map((b) => b.kind));
  check("GET /api/books 返回书架", shelf.status === 200 && books.length > 0, `${books.length} 本`);
  check(
    "书架含三类书（自动/内置/我的）",
    kinds.has("reading") && kinds.has("exam") && kinds.has("custom"),
    [...kinds].join(" / "),
  );
  const defaultBook = books.find((b) => b.isDefault);
  check("有且只有一本默认词书", books.filter((b) => b.isDefault).length === 1, defaultBook?.name ?? "无");

  /* ---------- 2. 建书 ---------- */
  const stamp = String(Date.now()).slice(-6);
  const nameA = `验收书${stamp}`;
  const created = await post("/api/books", { name: nameA });
  const bookA = created.json?.data?.book;
  check("POST /api/books 新建", created.json?.code === 0 && Boolean(bookA?.id), bookA?.name ?? created.text);

  const dupName = await post("/api/books", { name: nameA });
  check("同名词书被拒", dupName.json?.code !== 0, dupName.json?.message ?? "");

  const created2 = await post("/api/books", { name: `${nameA}-B` });
  const bookB = created2.json?.data?.book;
  check("可以建第二本", created2.json?.code === 0 && Boolean(bookB?.id), bookB?.name ?? "");

  /* ---------- 3. 加词：单字 / 去重 / 复制高频 ---------- */
  const addOne = await post(`/api/books/${bookA.id}/words`, { word: "abandon" });
  check(
    "单个词存入指定词书",
    addOne.json?.code === 0 && addOne.json?.data?.added === 1,
    JSON.stringify(addOne.json?.data ?? addOne.json?.message),
  );

  const addAgain = await post(`/api/books/${bookA.id}/words`, { word: "abandon" });
  check(
    "重复加同一个词不产生第二份",
    addAgain.json?.code === 0 && addAgain.json?.data?.added === 0,
    `added=${addAgain.json?.data?.added} duplicated=${addAgain.json?.data?.duplicated}`,
  );

  const copy = await post(`/api/books/${bookA.id}/words`, { importExam: "cet4-core", count: 5 });
  check(
    "从四级高频复制 5 个",
    copy.json?.code === 0 && copy.json?.data?.added === 5,
    `added=${copy.json?.data?.added}`,
  );

  const listA = await api(`/api/books/${bookA.id}/words?limit=300`);
  const wordsA = listA.json?.data?.words ?? [];
  check("词表能取回", listA.status === 200 && wordsA.length === 6, `${wordsA.length} 个词`);
  check(
    "词表带音标与释义",
    wordsA.some((w) => w.phonetic) && wordsA.some((w) => (w.definitions ?? []).length > 0),
    `phonetic=${wordsA.filter((w) => w.phonetic).length} defs=${wordsA.filter((w) => (w.definitions ?? []).length > 0).length}`,
  );
  check("只进了指定的那本，没串到另一本", wordsA.every((w) => w.word !== "______"));

  const listB = await api(`/api/books/${bookB.id}/words?limit=300`);
  check("B 书仍是空的", (listB.json?.data?.words ?? []).length === 0);

  /* ---------- 4. 内置书只读 ---------- */
  const examId = encodeURIComponent("exam:cet4-core");
  const examWords = await api(`/api/books/${examId}/words?limit=20`);
  check(
    "内置词书可读（只读）",
    examWords.json?.code === 0 && (examWords.json?.data?.words ?? []).length === 20,
    `${(examWords.json?.data?.words ?? []).length} 个词`,
  );
  const examPatch = await patch(`/api/books/${examId}`, { name: "改个名" });
  check("内置词书不能改名", examPatch.json?.code !== 0, examPatch.json?.message ?? "");

  /* ---------- 5. 默认 / 改名 / 删词 / 删书 ---------- */
  const toDefault = await patch(`/api/books/${bookA.id}`, { isDefault: true });
  const afterDefault = await api("/api/books");
  const def = (afterDefault.json?.data?.books ?? []).find((b) => b.isDefault);
  check(
    "设默认生效且唯一",
    toDefault.json?.code === 0 &&
      def?.id === bookA.id &&
      (afterDefault.json?.data?.books ?? []).filter((b) => b.isDefault).length === 1,
    def?.name ?? "",
  );

  const renamed = await patch(`/api/books/${bookB.id}`, { name: `${nameA}-改名` });
  const afterRename = await api("/api/books");
  const renamedBook = (afterRename.json?.data?.books ?? []).find((b) => b.id === bookB.id);
  check("改名生效", renamed.json?.code === 0 && renamedBook?.name === `${nameA}-改名`, renamedBook?.name ?? "");

  const rmWord = await del(`/api/books/${bookA.id}/words?word=abandon`);
  const afterRm = await api(`/api/books/${bookA.id}/words?limit=300`);
  check(
    "移出单词生效",
    rmWord.json?.code === 0 && !(afterRm.json?.data?.words ?? []).some((w) => w.word === "abandon"),
    `剩 ${(afterRm.json?.data?.words ?? []).length} 个`,
  );

  const rmBook = await del(`/api/books/${bookB.id}`);
  const afterRmBook = await api("/api/books");
  check(
    "删书生效",
    rmBook.json?.code === 0 &&
      !(afterRmBook.json?.data?.books ?? []).some((b) => b.id === bookB.id),
  );

  // 收尾：清掉验收用的书
  await del(`/api/books/${bookA.id}`);

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.log("失败项：");
    for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error("验收脚本本身出错：", err);
  process.exit(2);
});
