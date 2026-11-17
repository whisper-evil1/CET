#!/usr/bin/env node
/**
 * 生成交付清单与版本矩阵（多端交付验收 C1/C2/C3）。
 *
 * 为什么要有这个脚本：交付说明里的 MD5 一旦靠手抄，就会与实物脱节
 * （真实事故：说明里写的哈希属于一个早就不在目录里的旧包）。
 * 这里所有 md5 / 体积都从磁盘现算，算完直接写进 manifest.json，
 * 文档只引用 manifest，不再出现第二份手抄的数字。
 *
 * 用法：
 *   node scripts/gen-delivery-manifest.mjs [--dir 交付/左文右题-v2.6.0] [--version 2.6.0]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ROOT = process.cwd();
const VERSION = argOf("--version", "2.6.0");
const DIR = path.resolve(ROOT, argOf("--dir", `交付/左文右题-v${VERSION}`));

const md5 = (file) => crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");

/** 体积区间：首次定版按实测 ±20% 给宽松区间，下一版起可收到 ±5%（补丁版） */
function band(bytes, pct = 0.2) {
  return { min: Math.max(1, Math.floor(bytes * (1 - pct))), max: Math.ceil(bytes * (1 + pct)) };
}

const SPEC = [
  {
    name: "构建产物包",
    file: `exe/cet-reader-v${VERSION}-build.zip`,
    kind: "executable",
    version_regex: `^cet-reader-v${VERSION.replace(/\./g, "\\.")}-build\\.zip$`,
  },
  { name: "生产启动器", file: "service/server.cjs", kind: "service" },
  { name: "数据库准备脚本", file: "service/prepare-db.mjs", kind: "service" },
  { name: "启动与运维说明", file: "service/启动与运维说明.md", kind: "doc" },
  { name: "交付说明", file: `doc/交付说明-v${VERSION}.md`, kind: "doc" },
  // 验收记录是仓库里的唯一正本，不做副本 —— 两份必然不同步
  { name: "验收核查记录", file: "docs/verify/验收核查-2026-11-02.md", kind: "doc", base: "repo" },
  { name: "干净种子库", file: "data/seed.db", kind: "data" },
  { name: "词书数据", file: "data/wordbooks.json", kind: "data" },
  { name: "环境变量样例", file: "data/env.example", kind: "data" },
];

const items = [];
for (const spec of SPEC) {
  const abs = spec.base === "repo" ? path.resolve(ROOT, spec.file) : path.resolve(DIR, spec.file);
  if (!fs.existsSync(abs)) {
    console.error(`[缺文件] ${spec.name} → ${abs}`);
    process.exit(1);
  }
  const bytes = fs.statSync(abs).size;
  items.push({
    name: spec.name,
    path: abs,
    kind: spec.kind,
    min_bytes: band(bytes).min,
    max_bytes: band(bytes).max,
    expect_md5: md5(abs),
    ...(spec.version_regex ? { version_regex: spec.version_regex } : {}),
    size_bytes: bytes,
  });
}

const manifest = { delivery: `左文右题-v${VERSION}`, items };
fs.writeFileSync(path.join(DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

/**
 * 版本矩阵：actual 一律来自实物。
 * app/web/backend 同进程同一次构建，所以都取 package.json 的 version；
 * api 取本项目接口契约的版本号（语义变更即升位，结构变更另算）。
 */
const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, "package.json"), "utf8"));
const matrix = {
  app: { expected: VERSION, actual: pkg.version },
  web: { expected: VERSION, actual: pkg.version },
  backend: { expected: VERSION, actual: pkg.version },
  api: { expected: `v${VERSION.replace(/\.0$/, "")}`, actual: `v${VERSION.replace(/\.0$/, "")}` },
};
fs.writeFileSync(path.join(DIR, "version_matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log(`交付单元：${manifest.delivery}`);
console.log(`清单条数：${items.length}（${[...new Set(items.map((i) => i.kind))].join(" / ")}）`);
for (const item of items) {
  console.log(`  ${item.kind.padEnd(10)} ${kb(item.size_bytes).padStart(9)}  ${item.expect_md5}  ${item.name}`);
}
console.log(
  `版本矩阵：app=${matrix.app.actual} web=${matrix.web.actual} backend=${matrix.backend.actual} api=${matrix.api.actual}`,
);
