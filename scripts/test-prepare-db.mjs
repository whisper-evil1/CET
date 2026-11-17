/**
 * prepare-db.mjs 的行为验证。
 *
 * 重点验证「题库换版」这条最容易出事的分支：
 *   换版必须重建题库，但不能把账号和生词本一起清掉 ——
 *   一旦清掉，用户浏览器里还有效的 JWT 就变成了指向空气的 id，
 *   后续所有写操作都会外键失败，对外就是「页面能看，一点就报错」。
 *
 * 用法：node scripts/test-prepare-db.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TMP = path.join(os.tmpdir(), `cet-pdb-${Date.now()}`);
const DATA = path.join(TMP, "data");

let pass = 0;
let fail = 0;
function check(ok, label, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 在临时目录跑一次 prepare-db，返回其 stderr 便于断言日志 */
function runPrepare(args = []) {
  return execFileSync(process.execPath, [path.join(ROOT, "scripts/prepare-db.mjs"), ...args], {
    cwd: TMP,
    env: { ...process.env, CET_DATA_DIR: DATA },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function openDb() {
  return new DatabaseSync(path.join(DATA, "cet.db"));
}

try {
  fs.mkdirSync(path.join(TMP, "prisma"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "prisma", "seed.db"), path.join(TMP, "prisma", "seed.db"));

  /* ---------- 1. 首次初始化 ---------- */
  runPrepare();
  let db = openDb();
  const papers0 = db.prepare("SELECT COUNT(*) n FROM Paper").get().n;
  check(papers0 > 0, "首次初始化：从种子库建库", `${papers0} 套试卷`);

  /* ---------- 2. 造一个用户和他的生词本 ---------- */
  db.exec(`
    INSERT INTO "User" (id,email,password,name,avatar,createdAt)
    VALUES ('u-test','u@t.local','hash','测试用户',NULL,datetime('now'));
  `);
  db.exec(`
    INSERT INTO "VocabWord" (id,userId,word,definitions,reviewCount,correctStreak,status,createdAt,updatedAt)
    VALUES ('v-test','u-test','explanation','[{"pos":"n.","zh":"解释"}]',0,0,'learning',datetime('now'),datetime('now'));
  `);
  const vocabBefore = db.prepare('SELECT COUNT(*) n FROM "VocabWord"').get().n;
  check(vocabBefore === 1, "准备数据：已写入 1 个用户 + 1 条生词");
  db.close();

  /* ---------- 3. 种子未变：必须原样保留 ---------- */
  runPrepare();
  db = openDb();
  // 种子库自带 2 个 demo 账号（demo / alice），所以按 id 判断而不是按总数
  check(
    Boolean(db.prepare(`SELECT id FROM "User" WHERE id = 'u-test'`).get()),
    "种子未变：用户保留",
  );
  check(db.prepare('SELECT COUNT(*) n FROM "VocabWord"').get().n === 1, "种子未变：生词保留");
  db.close();

  /* ---------- 4. 模拟题库换版 ---------- */
  // 改一个字节让 sha256 变化，同时真的改一条试卷标题以证明题库确实被替换
  db = new DatabaseSync(path.join(TMP, "prisma", "seed.db"));
  db.exec(`UPDATE Paper SET title = title || '（新版）' WHERE rowid = (SELECT MIN(rowid) FROM Paper)`);
  db.close();

  const log = (() => {
    try {
      return runPrepare();
    } catch (e) {
      return String(e.stderr ?? e);
    }
  })();

  db = openDb();
  const hasTestUser = Boolean(db.prepare(`SELECT id FROM "User" WHERE id = 'u-test'`).get());
  const vocab = db.prepare('SELECT word FROM "VocabWord"').get();
  const newTitle = db.prepare("SELECT title FROM Paper ORDER BY rowid LIMIT 1").get().title;

  check(hasTestUser, "种子换版：账号被保留（不会逼用户重新登录）");
  check(vocab?.word === "explanation", "种子换版：生词本被保留", vocab?.word ?? "-");
  check(/新版/.test(newTitle), "种子换版：题库确实换成了新版", newTitle);
  check(fs.existsSync(DATA) && fs.readdirSync(DATA).some((f) => f.startsWith("cet.db.bak.")), "换版前已自动备份旧库");
  db.close();

  /* ---------- 5. 二次启动不应重复换版 ---------- */
  runPrepare();
  db = openDb();
  check(
    Boolean(db.prepare(`SELECT id FROM "User" WHERE id = 'u-test'`).get()),
    "二次启动：不重复重建，数据仍在",
  );
  db.close();

  console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
} catch (err) {
  console.error("测试异常:", err);
  fail += 1;
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail > 0 ? 1 : 0);
}
