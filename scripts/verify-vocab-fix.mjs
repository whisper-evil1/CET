/**
 * 验证"单词收藏不了"的三层修复。
 * 注意：API 返回体是 { code, message, data: {...} }，业务字段在 data 里。
 */
const BASE = "http://127.0.0.1:3000";

const jar = new Map();
const absorb = (r) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [p] = c.split(";");
    const i = p.indexOf("=");
    jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function login() {
  let r = await fetch(`${BASE}/api/auth/csrf`);
  absorb(r);
  const { csrfToken } = await r.json();
  const form = new URLSearchParams({
    csrfToken,
    email: "demo@cet.local",
    password: "demo1234",
    callbackUrl: `${BASE}/`,
    json: "true",
  });
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie() },
    redirect: "manual",
  });
  absorb(r);
}

async function apiCall(path, options = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Cookie: cookie(), ...(options.headers ?? {}) },
  });
  const body = await r.json();
  return { status: r.status, body };
}

const lookup = (word) =>
  apiCall("/api/lookup", {
    method: "POST",
    body: JSON.stringify({ word, passageId: "test", context: "" }),
  });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  → ${detail}` : ""}`);
};

await login();

console.log("\n【修复1】词形还原：researchers 应命中释义");
const cases = [
  ["researchers", "研究人员"],
  ["notebooks", "笔记本"],
  ["admitted", "承认"],
  ["typing", "打字"],
  ["outperformed", "表现优于"],
];
for (const [word, expectZh] of cases) {
  const r = await lookup(word);
  const entry = r.body?.data?.entry;
  const zh = entry?.definitions?.[0]?.zh ?? "";
  check(
    `${word} 查到释义`,
    r.body?.data?.found && Boolean(entry),
    entry ? `word=${entry.word}, zh="${zh}", source=${entry.source}` : r.body?.data?.hint ?? "",
  );
  if (expectZh) {
    check(`${word} 释义包含"${expectZh}"`, zh.includes(expectZh), `zh="${zh}"`);
  }
}

console.log("\n【修复2】查不到释义的词也能加入生词本");
const fakeWord = "xyzqwerty";
const r2 = await lookup(fakeWord);
check("xyzqwerty 查不到释义（预期）", !r2.body?.data?.found, r2.body?.data?.hint ?? "");

const add2 = await apiCall("/api/vocab", {
  method: "POST",
  body: JSON.stringify({
    word: fakeWord,
    phonetic: null,
    definitions: [],
    example: null,
    exampleZh: null,
    sourceContext: "test",
    sourcePassageId: null,
  }),
});
check("无释义的词成功加入", add2.status === 200 && add2.body?.code === 0, `status=${add2.status}`);
check(
  "返回 definitions 为空数组",
  Array.isArray(add2.body?.data?.definitions) && add2.body.data.definitions.length === 0,
);

console.log("\n【修复3】生词本列表能看到无释义的词");
const list = await apiCall("/api/vocab?status=learning");
const items = list.body?.data ?? [];
const fakeInList = items.find((w) => w.word === fakeWord);
check("无释义的词出现在列表", Boolean(fakeInList));
check("列表中 definitions 为空", fakeInList && fakeInList.definitions.length === 0);

console.log("\n【回归】重复加入不覆盖旧释义");
const add3 = await apiCall("/api/vocab", {
  method: "POST",
  body: JSON.stringify({
    word: "research",
    phonetic: "/rɪˈsɜːtʃ/",
    definitions: [{ pos: "n./v.", zh: "研究，调查" }],
    example: null,
    exampleZh: null,
    sourceContext: null,
    sourcePassageId: null,
  }),
});
check("有释义的词加入正常", add3.status === 200 && add3.body?.code === 0);

const add4 = await apiCall("/api/vocab", {
  method: "POST",
  body: JSON.stringify({ word: "research", phonetic: null, definitions: [], example: null, exampleZh: null, sourceContext: null, sourcePassageId: null }),
});
check(
  "重复加入后旧释义保留",
  add4.body?.data?.definitions?.length > 0,
  `defs=${JSON.stringify(add4.body?.data?.definitions)}`,
);

// 清理测试假词
if (fakeInList) {
  await fetch(`${BASE}/api/vocab/${fakeInList.id}`, { method: "DELETE", headers: { Cookie: cookie() } });
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n结果：${passed}/${results.length} 通过${passed === results.length ? " ✓" : " ✗"}`);
process.exit(passed === results.length ? 0 : 1);
