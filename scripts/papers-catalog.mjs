#!/usr/bin/env node
/**
 * 四六级卷库目录（唯一事实来源）。
 *
 * 范围：2021 年 6 月 → 2026 年 6 月，每年 6 月 / 12 月两场，每场三套。
 * 11 场 × 3 套 = 每级 33 套，四级 33 + 六级 33 = 66 套。
 *
 * 这里只负责**元数据与章节结构**（官方题型、题号区间、时长），不含正文。
 * 正文由 data/papers/<id>.json 提供，缺正文的卷以 status=draft 入库：
 * 列表里看得见（用户知道进度），但不会进闯关、不会被当成可练的卷。
 *
 * 用法：
 *   node scripts/papers-catalog.mjs            # 打印 66 套
 *   node scripts/papers-catalog.mjs --json     # 输出 JSON
 */

/** 一年两场：6 月与 12 月；endYear 的 6 月为终点 */
const SESSIONS = [];
for (let year = 2021; year <= 2026; year++) {
  for (const month of [6, 12]) {
    if (year === 2026 && month === 12) continue; // 只到 2026 上半年
    SESSIONS.push({ year, month });
  }
}

const LEVELS = [
  { level: "CET4", label: "四级", totalTime: 125 },
  { level: "CET6", label: "六级", totalTime: 130 },
];

/**
 * 官方章节结构。
 * CET4：写作 30' + 听力 25' + 阅读 40' + 翻译 30'，共 57 题（写作/翻译各 1 题为 1 篇作文/1 段译文）。
 * CET6：同四段，听力 30'，总时长 130'。
 * 题号：听力 1–25，阅读 26–55（选词 26–35 / 匹配 36–45 / 仔细 46–55），翻译 56。
 */
const BLUEPRINT = {
  CET4: [
    { order: 1, type: "writing", title: "Section I Writing", timeLimit: 30 },
    { order: 2, type: "listening", title: "Section II Listening Comprehension", timeLimit: 25 },
    { order: 3, type: "reading", title: "Section III Reading Comprehension", timeLimit: 40 },
    { order: 4, type: "translation", title: "Section IV Translation", timeLimit: 30 },
  ],
  CET6: [
    { order: 1, type: "writing", title: "Section I Writing", timeLimit: 30 },
    { order: 2, type: "listening", title: "Section II Listening Comprehension", timeLimit: 30 },
    { order: 3, type: "reading", title: "Section III Reading Comprehension", timeLimit: 40 },
    { order: 4, type: "translation", title: "Section IV Translation", timeLimit: 30 },
  ],
};

/** 阅读四篇的分工：题型 + 题号区间 + 题量 */
const READING_PLAN = [
  { key: "banked", label: "Section A 选词填空", from: 26, count: 10 },
  { key: "matching", label: "Section B 长篇阅读匹配", from: 36, count: 10 },
  { key: "careful1", label: "Section C 仔细阅读（一）", from: 46, count: 5 },
  { key: "careful2", label: "Section C 仔细阅读（二）", from: 51, count: 5 },
];

function buildCatalog() {
  const out = [];
  // sort 越小越靠前：最新一场排最前
  const ordered = [...SESSIONS].reverse();
  for (const [levelIndex, { level, label, totalTime }] of LEVELS.entries()) {
    ordered.forEach((session, sessionIndex) => {
      for (let setNo = 1; setNo <= 3; setNo++) {
        const id = `${level.toLowerCase()}-${session.year}-${String(session.month).padStart(2, "0")}-s${setNo}`;
        out.push({
          id,
          level,
          year: session.year,
          month: session.month,
          setNo,
          title: `${session.year}年${session.month}月 大学英语${label}考试（第${["一", "二", "三"][setNo - 1]}套）`,
          totalTime,
          // 场次倒序 → 同场先四级后六级 → 套号升序（列表看起来像书架：一场考试三套连排）
          sort: sessionIndex * 100 + levelIndex * 10 + setNo,
          sections: BLUEPRINT[level],
        });
      }
    });
  }
  return out;
}

export { SESSIONS, LEVELS, BLUEPRINT, READING_PLAN, buildCatalog };

if (process.argv[1] && process.argv[1].endsWith("papers-catalog.mjs")) {
  const catalog = buildCatalog();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(catalog, null, 2));
  } else {
    const byLevel = catalog.reduce((m, p) => ({ ...m, [p.level]: (m[p.level] ?? 0) + 1 }), {});
    console.log(`共 ${catalog.length} 套（CET4 ${byLevel.CET4} / CET6 ${byLevel.CET6}）`);
    for (const p of catalog.slice(0, 6)) console.log(`  ${p.sort}\t${p.id}\t${p.title}`);
    console.log("  …");
    for (const p of catalog.slice(-3)) console.log(`  ${p.sort}\t${p.id}\t${p.title}`);
  }
}
