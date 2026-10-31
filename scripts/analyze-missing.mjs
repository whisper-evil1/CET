import fs from "node:fs";

const src = fs.readFileSync("prisma/seed.ts", "utf8");
const paras = [...src.matchAll(/text:\s*`([^`]+)`/g)].map((m) => m[1]);
const articleParas = paras.filter((p) => p.length > 60);

const words = [];
for (const p of articleParas) {
  for (const m of p.toLowerCase().matchAll(/\b[a-z][a-z'-]*\b/g)) words.push(m[0]);
}
const freq = {};
for (const w of words) freq[w] = (freq[w] || 0) + 1;

const builtin = new Set(
  [...fs.readFileSync("src/data/builtin-dict.ts", "utf8").matchAll(/^\s+([a-z'-]+):/gm)].map((m) => m[1]),
);

function cands(w) {
  const s = new Set([w]);
  const add = (x) => { if (x.length > 2) s.add(x); };
  if (w.endsWith("ies")) add(w.slice(0, -3) + "y");
  if (w.endsWith("es")) add(w.slice(0, -2));
  if (w.endsWith("s")) add(w.slice(0, -1));
  if (w.endsWith("ied")) add(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) { add(w.slice(0, -2)); add(w.slice(0, -1)); }
  if (w.endsWith("ing")) { add(w.slice(0, -3)); add(w.slice(0, -3) + "e"); }
  if (w.endsWith("ly")) add(w.slice(0, -2));
  if (w.endsWith("er")) add(w.slice(0, -2));
  if (w.endsWith("est")) add(w.slice(0, -3));
  return [...s];
}

const stop = new Set([
  "the","a","an","is","are","was","were","to","of","in","on","for","and","or","but",
  "that","this","these","those","it","they","them","their","there","than","so","as","at","by",
  "be","been","being","have","has","had","do","does","did","from","with","not","no","its","his",
  "her","our","your","my","we","you","i","he","she","if","when","while","about","into","over",
  "between","through","during","before","after","because","although","though","since","until",
  "more","most","less","least","very","too","also","only","just","such","one","two","first",
  "second","other","another","same","different","new","many","much","few","several","all","both",
  "each","every","any","some","what","which","who","whom","whose","why","how","where","can","could",
  "should","would","may","might","will","shall","must","out","up","down","off","again","then","once",
]);

const miss = [];
for (const w of Object.keys(freq).sort((a, b) => freq[b] - freq[a])) {
  if (stop.has(w) || w.length < 3) continue;
  if (builtin.has(w)) continue;
  const hit = cands(w).some((c) => builtin.has(c));
  if (!hit) miss.push(`${w} (${freq[w]})`);
}
console.log("文章正文未命中释义的实词（前60）:");
console.log(miss.slice(0, 60).join(", "));
console.log("---总数:", miss.length);
