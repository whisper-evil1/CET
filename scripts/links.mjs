#!/usr/bin/env node
/**
 * 链接抽取器：抓一个页面，把 <a href>锚文本</a> 打成 `锚文本\tURL`。
 * 用途是给真题抓取做「发现」：先从栏目页/索引页拿到文章地址，再批量落地正文。
 *
 * 用法：
 *   node scripts/links.mjs <url> [--grep 听力] [--host cet4.koolearn.com] [--out links.txt]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const argv = process.argv.slice(2);
const url = argv.find((a) => /^https?:/.test(a));
if (!url) {
  console.error("用法: node scripts/links.mjs <url> [--grep X] [--host X] [--out file]");
  process.exit(1);
}
const val = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const grep = val("--grep");
const host = val("--host");
const out = val("--out");

const buf = execFileSync(
  "curl",
  ["-sL", "-m", "45", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", url],
  { maxBuffer: 32 * 1024 * 1024 }
);
let html = buf.toString("utf8");
if (/charset=["']?(gb2312|gbk|gb18030)/i.test(html.slice(0, 2048))) {
  try {
    html = execFileSync("iconv", ["-f", "GB18030", "-t", "UTF-8"], { input: buf, maxBuffer: 32 * 1024 * 1024 }).toString("utf8");
  } catch {}
}

const rows = [];
const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
let m;
while ((m = re.exec(html))) {
  let href = m[1];
  const title = m[2].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
  if (!/^https?:/.test(href)) {
    if (href.startsWith("//")) href = `https:${href}`;
    else {
      const u = new URL(url);
      href = new URL(href, `${u.protocol}//${u.host}`).toString();
    }
  }
  if (host && !href.includes(host)) continue;
  if (grep && !(title.includes(grep) || href.includes(grep))) continue;
  if (!title) continue;
  rows.push(`${title}\t${href}`);
}
const uniq = [...new Set(rows)];
const text = uniq.join("\n");
if (out) fs.writeFileSync(out, `${text}\n`, "utf8");
console.log(text);
console.error(`[links] ${uniq.length} 条`);
