/**
 * 校验 /api/papers/[id] 的返回结构。
 *
 * 为什么要单独一个：v2.0 把数据结构改成 Paper→Section→Passage→Question，
 * 但 /api/papers/[id] 一直是 v1 写法（把所有 passage 塞进一个伪造的 reading
 * section），结果 sections 只有 1 个、类型全错。这个脚本对着**指定的构建产物**
 * 起一个临时生产服务，直接断言层级，避免"改了但没验"。
 *
 * 用法：
 *   node scripts/verify-papers-detail.mjs                 # 用默认 .next
 *   NEXT_DIST_DIR=.next-v5 node scripts/verify-papers-detail.mjs
 */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const PORT = Number(process.env.VERIFY_PORT || 4177);
const BASE = `http://127.0.0.1:${PORT}`;
const NEXT_BIN = path.join("node_modules", "next", "dist", "bin", "next");

let pass = 0;
let fail = 0;
const failures = [];
function record(ok, name, detail) {
  if (ok) {
    pass += 1;
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function waitPort(timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const sock = net.connect({ port: PORT, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error("服务启动超时"));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d.toString()));
child.stderr.on("data", (d) => (serverLog += d.toString()));

let exitCode = 0;
try {
  await waitPort();
  console.log(`服务已就绪：${BASE}（distDir=${process.env.NEXT_DIST_DIR || ".next"}）\n`);

  /* ---------- 列表 ---------- */
  const lr = await fetch(`${BASE}/api/papers`);
  const lj = await lr.json();
  const list = Array.isArray(lj.data) ? lj.data : lj.data?.papers ?? [];
  record(lr.status === 200 && lj.code === 0, "GET /api/papers", `status ${lr.status}, ${list.length} 套`);
  if (!list.length) throw new Error("没有试卷，无法继续");

  /* ---------- 详情 ---------- */
  const id = list[0].id;
  const dr = await fetch(`${BASE}/api/papers/${encodeURIComponent(id)}`);
  const dj = await dr.json();
  const paper = dj.data;
  record(dr.status === 200 && dj.code === 0, "GET /api/papers/[id]", `status ${dr.status}`);

  const sections = paper?.sections ?? [];
  const types = sections.map((s) => s.type);

  console.log(`\n  试卷：${paper?.title ?? "?"}（${id}）`);
  console.log(`  sections = ${sections.length}：${types.join(" / ")}`);
  for (const s of sections) {
    const qn = s.passages.reduce((a, p) => a + p.questions.length, 0);
    console.log(`    - ${s.type.padEnd(12)} passages=${s.passages.length} questions=${qn}`);
  }
  console.log("");

  // 核心断言：必须有多个 section，且类型齐全（新题库的四段式）
  record(sections.length > 1, "sections 数量 > 1（不再是 v1 的单 section 包装）", `实际 ${sections.length}`);
  record(types.includes("writing"), "含 writing 板块");
  record(types.includes("listening"), "含 listening 板块");
  record(types.includes("reading"), "含 reading 板块");
  record(types.includes("translation"), "含 translation 板块");
  record(new Set(types).size === types.length, "section 类型不重复", types.join(","));

  // order 必须严格递增，前端靠它排页签
  const orders = sections.map((s) => s.order);
  record(
    orders.every((v, i) => i === 0 || v > orders[i - 1]),
    "section.order 严格递增",
    orders.join(",")
  );

  // 题目 id 必须带试卷前缀（v1 是裸 q46，跨卷会撞主键）
  const allQ = sections.flatMap((s) => s.passages.flatMap((p) => p.questions));
  record(allQ.length > 0, "题目总数 > 0", `${allQ.length} 题`);
  record(
    allQ.every((q) => q.id.startsWith(`${id}-`)),
    "题目 id 均带试卷前缀（不与其它卷撞主键）",
    allQ[0]?.id ?? "-"
  );
  record(new Set(allQ.map((q) => q.id)).size === allQ.length, "题目 id 唯一");

  // 首屏不能泄露阅读/听力解析
  const readingQ = sections
    .filter((s) => s.type === "reading" || s.type === "listening")
    .flatMap((s) => s.passages.flatMap((p) => p.questions));
  record(
    readingQ.every((q) => !q.analysis),
    "阅读/听力不下发 analysis（防首屏泄题）",
    `${readingQ.length} 题`
  );

  // 写作/翻译要下发参考要点
  const writingQ = sections
    .filter((s) => s.type === "writing" || s.type === "translation")
    .flatMap((s) => s.passages.flatMap((p) => p.questions));
  record(
    writingQ.length === 0 || writingQ.some((q) => q.analysis),
    "写作/翻译下发 analysis（参考要点）"
  );

  // 客观题（有选项的）必须至少 A/B 两个选项；写作/翻译没选项是正常的
  const choiceQ = allQ.filter((q) => q.type !== "writing" && q.type !== "translation");
  record(
    choiceQ.length > 0 && choiceQ.every((q) => Array.isArray(q.options) && q.options.length >= 2),
    "客观题选项完整",
    `${choiceQ.length} 题`
  );
  record(
    allQ
      .filter((q) => q.type === "writing" || q.type === "translation")
      .every((q) => Array.isArray(q.options) && q.options.length === 0),
    "写作/翻译不带选项"
  );

  // 页签顺序要和 UI 文案一致：写作→听力→阅读→翻译
  record(
    types.join(",") === "writing,listening,reading,translation",
    "板块顺序为 写作→听力→阅读→翻译",
    types.join(",")
  );
} catch (e) {
  fail += 1;
  failures.push(`异常：${e.message}`);
  console.log(`✗ 异常：${e.message}`);
  if (serverLog) console.log(`\n--- 服务日志 ---\n${serverLog.slice(-1500)}`);
  exitCode = 1;
} finally {
  child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode || (fail ? 1 : 0)), 600);
}

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
if (failures.length) {
  console.log("失败项：");
  for (const f of failures) console.log(`  - ${f}`);
}
