#!/usr/bin/env node
/**
 * 真题原文抓取器：把公开真题解析页落地成本地纯文本，供后续结构化。
 *
 * 为什么不用浏览器/无头渲染：这些站点是静态 HTML，curl + 标签剥离就够，
 * 且**原文逐字保真**（不经过模型转述），比摘要式抓取可靠。
 *
 * 用法：
 *   node scripts/fetch-source.mjs <url> [--name foo] [--charset gbk]
 *   node scripts/fetch-source.mjs --list list.txt     # 文件里每行一个 url
 *
 * 产物：_sources/<slug>.txt（纯文本）+ _sources/index.json（url/抓取时间/字数）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "_sources");
fs.mkdirSync(OUT, { recursive: true });
const INDEX = path.join(OUT, "index.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", mdash: "—", ndash: "–",
  middot: "·", times: "×", copy: "©", reg: "®", deg: "°", euro: "€", pound: "£", yen: "¥",
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** HTML → 纯文本：保留段落边界，去掉脚本样式与导航噪声 */
function htmlToText(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ");
  // 块级标签断行
  s = s.replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|blockquote|pre)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  s = s.replace(/\r/g, "\n");
  s = s.replace(/[ \t\u00a0\u3000]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).filter((l) => l.length > 0).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function slugify(url, name) {
  if (name) return name;
  const u = new URL(url);
  const base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return base.slice(0, 90);
}

async function fetchOne(url, opts = {}) {
  const args = ["-sL", "-m", "45", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8"];
  if (opts.referer) args.push("-e", opts.referer);
  args.push(url);
  let buf;
  try {
    buf = execFileSync("curl", args, { maxBuffer: 24 * 1024 * 1024 });
  } catch (err) {
    return { url, ok: false, error: String(err.message || err).slice(0, 200) };
  }
  if (!buf || buf.length === 0) return { url, ok: false, error: "空响应" };
  let html;
  const head = buf.subarray(0, 2048).toString("latin1");
  const isGbk = /charset=["']?(gb2312|gbk|gb18030)/i.test(head) || opts.charset === "gbk";
  if (isGbk) {
    // Node 无 GBK 解码器，交给 iconv（Windows 上通常有 GNU iconv / git bash 自带）
    try {
      html = execFileSync("iconv", ["-f", "GB18030", "-t", "UTF-8"], { input: buf, maxBuffer: 24 * 1024 * 1024 }).toString("utf8");
    } catch {
      html = buf.toString("utf8");
    }
  } else {
    html = buf.toString("utf8");
  }
  const text = htmlToText(html);
  const slug = slugify(url, opts.name);
  const file = path.join(OUT, `${slug}.txt`);
  fs.writeFileSync(file, text, "utf8");
  return { url, ok: true, slug, chars: text.length, words: text.split(/\s+/).filter(Boolean).length };
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX, "utf8"));
  } catch {
    return [];
  }
}

const argv = process.argv.slice(2);
const listIdx = argv.indexOf("--list");
const urls = [];
if (listIdx >= 0) {
  const file = argv[listIdx + 1];
  urls.push(...fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:/.test(l)));
} else if (argv[0] && /^https?:/.test(argv[0])) {
  urls.push(argv[0]);
} else {
  console.error("用法: node scripts/fetch-source.mjs <url>|--list list.txt [--name foo]");
  process.exit(1);
}
const nameIdx = argv.indexOf("--name");
const name = nameIdx >= 0 ? argv[nameIdx + 1] : null;
const charsetIdx = argv.indexOf("--charset");
const charset = charsetIdx >= 0 ? argv[charsetIdx + 1] : null;

const index = readIndex();
for (const url of urls) {
  const r = await fetchOne(url, { name: urls.length === 1 ? name : null, charset });
  console.log(r.ok ? `OK  ${r.chars} 字  ${r.slug}.txt  ${url}` : `FAIL ${r.error}  ${url}`);
  if (r.ok) {
    const prev = index.findIndex((x) => x.url === url);
    const rec = { url, slug: r.slug, chars: r.chars, words: r.words, at: new Date().toISOString() };
    if (prev >= 0) index[prev] = rec;
    else index.push(rec);
  }
}
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2), "utf8");
