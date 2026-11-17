/**
 * 真题解析站（懒笔记）取页 + 正文抽取的公共部分。
 *
 * 只用 curl 拿静态 HTML 再剥标签：这些页面是静态渲染，原文逐字保真，
 * 不经过任何模型转述 —— 这是「真题就是真题」的前提。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const BASE = "https://english-exam.lazynote.cn";
export const SRC_DIR = path.join(process.cwd(), "_sources", "lazynote-full");

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

export function htmlToText(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|iframe|svg)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|blockquote|pre)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decode(s);
  s = s.replace(/\r/g, "\n");
  // 真题站用 U+2002/U+2003 等排版空格撑开「26」两端的填空位，统一成普通空格，
  // 否则后面的空格识别（26______）匹配不上。
  s = s.replace(/[\u2000-\u200b\u202f\u205f\u00a0\u3000]/g, " ");
  s = s.replace(/[ \t]+/g, " ");
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();
}

/** 落盘缓存：同一套卷反复调脚本时不重复打站点 */
export async function loadLines(cacheKey, url, { refresh = false, minChars = 800 } = {}) {
  fs.mkdirSync(SRC_DIR, { recursive: true });
  const file = path.join(SRC_DIR, `${cacheKey}.txt`);
  if (!refresh && fs.existsSync(file)) {
    const cached = fs.readFileSync(file, "utf8");
    if (cached.length >= minChars) return cached.split("\n");
  }
  const buf = execFileSync("curl", ["-sL", "-m", "45", "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8", url], {
    maxBuffer: 24 * 1024 * 1024,
  });
  const html = buf.toString("utf8");
  const text = htmlToText(html);
  if (text.length < minChars) throw new Error(`页面过小（${text.length} 字），可能 404：${url}`);
  fs.writeFileSync(file, text, "utf8");
  return text.split("\n");
}

/** cet4-2025-12-s1 → { level: "cet4", slug: "2025-12-1" } */
export function parseId(id) {
  const m = /^(cet[46])-(\d{4})-(\d{2})-s(\d)$/.exec(id);
  if (!m) return null;
  return { level: m[1], slug: `${m[2]}-${m[3]}-${m[4]}` };
}

/** 各题型解析页的路径（与站点栏目一一对应） */
export const PARTS = {
  full: (slug) => `paper/${slug}/`,
  writing: (slug) => `sections/${slug}/part1/`,
  secA: (slug) => `sections/${slug}/part3-section-a/`,
  secB: (slug) => `sections/${slug}/part3-section-b/`,
  secC1: (slug) => `sections/${slug}/part3-section-c-1/`,
  secC2: (slug) => `sections/${slug}/part3-section-c-2/`,
  translation: (slug) => `sections/${slug}/part-iv/`,
};

/** 找某一行的下标：支持精确/前缀/正则 */
export function findLine(lines, matcher, from = 0) {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof matcher === "string") {
      if (line === matcher) return i;
    } else if (matcher instanceof RegExp) {
      if (matcher.test(line)) return i;
    } else if (typeof matcher === "function") {
      if (matcher(line)) return i;
    }
  }
  return -1;
}

export function sliceLines(lines, startMatcher, endMatcher, from = 0) {
  const start = findLine(lines, startMatcher, from);
  if (start < 0) return [];
  const end = endMatcher ? findLine(lines, endMatcher, start + 1) : lines.length;
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}
