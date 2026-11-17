/**
 * 复现用户截图里的三类报错，定位服务端真实异常。
 * 不起浏览器：直接注入合法会话 cookie 打接口，服务端日志里有完整堆栈。
 */
const BASE = process.env.REPRO_BASE ?? "http://127.0.0.1:3000";
const TOKEN = process.env.REPRO_TOKEN ?? "";
const jar = new Map([["authjs.session-token", TOKEN]]);
const hdr = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function req(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers || {}), cookie: hdr() },
  });
  let body = "";
  try {
    body = await res.text();
  } catch {}
  return { status: res.status, body, ctype: res.headers.get("content-type") };
}

function show(label, r) {
  const mark = r.status >= 200 && r.status < 300 ? "OK " : "FAIL";
  let brief = r.body.replace(/\s+/g, " ").slice(0, 220);
  console.log(`${mark} ${label} → ${r.status}  ${brief}`);
}

// 1) 生词本：完全按前端 word-card 的真实载荷
const vocabPayload = {
  word: "explanation",
  phonetic: ".eksplə'neiʃən",
  definitions: [{ pos: "n.", zh: "解释, 说明, 辩解, 表明; [经] 解释, 注释, 说明" }],
  example: null,
  exampleZh: null,
  sourceContext: "The obvious explanation — nostalgia — does not survive contact with the numbers.",
  sourcePassageId: "paper-cet4-2024-12-p1",
};
show("POST /api/vocab", await req("/api/vocab", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(vocabPayload),
}));

// 2) 提交答案
const q = await req("/api/papers?level=CET4");
let qid = "paper-cet4-2024-12-p1-q46";
try {
  const j = JSON.parse(q.body);
  const first = j?.data?.[0]?.sections?.find((s) => s.type === "reading")?.passages?.[0]?.questions?.[0];
  if (first?.id) qid = first.id;
} catch {}
show("POST /api/answers", await req("/api/answers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ questionId: qid, choice: "B", durationMs: 3200 }),
}));

// 3) AI 抽屉前置：题目上下文
show(`GET /api/questions/${qid}/ai-context`, await req(`/api/questions/${qid}/ai-context`));
// 4) AI 答疑（服务端流式）
show("POST /api/ai/chat", await req("/api/ai/chat", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ questionId: qid, messages: [{ role: "user", content: "为什么不选B" }] }),
}));
// 5) 体验包（AI 抽屉里那段 "1" 的来源之一）
show(`GET /api/questions/${qid}/experience`, await req(`/api/questions/${qid}/experience`));
// 6) 统计与排行榜
show("GET /api/me/stats", await req("/api/me/stats"));
show("GET /api/leaderboard", await req("/api/leaderboard"));
// 7) 生词本读取
show("GET /api/vocab", await req("/api/vocab"));
