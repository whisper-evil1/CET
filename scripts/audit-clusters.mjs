#!/usr/bin/env node
/**
 * 题材簇审计：用一组人工整理的题材关键词，把「同一题材被多套卷写了」的情况列清楚。
 *
 * 为什么不用纯词频相似度：同一题材换个写法（repair café / mending workshop）词频签名会掉到阈值以下，
 * 但读者一眼就看出来是同一个话题。所以这里用「关键词命中」+ 人工题材表，宁可多报也不漏报。
 *
 * 用法：node scripts/audit-clusters.mjs [--min 2]
 */
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./papers-catalog.mjs";

const DIR = path.join(process.cwd(), "data", "papers");
const ids = new Set(buildCatalog().map((e) => e.id));
const minIdx = process.argv.indexOf("--min");
const MIN = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 2;

const TOPICS = [
  { name: "修理/维修权", re: /repair caf|mending|repairing|right to repair|spare parts|toaster|broken (kettle|lamp)|维修权/i },
  { name: "二手服装", re: /second-hand|secondhand|used clothes|resale|vinted|depop|charity shop|garment/i },
  { name: "四天工作制", re: /four-day|four day week|shorter working week|compressed hours/i },
  { name: "手写与打字笔记", re: /handwriting|typing notes|take notes by hand|laptop notes|keyboard/i },
  { name: "食物浪费", re: /food waste|throw(s|ing)? away food|surplus food|use-by|best-before|landfill food/i },
  { name: "夜班列车", re: /sleeper train|night train|nightjet|overnight train/i },
  { name: "博物馆数字化", re: /museum|digitised collection|digitized collection|rijksmuseum/i },
  { name: "威尔士语/方言复兴", re: /welsh|wales|dialect|endangered language/i },
  { name: "种子库", re: /seed (bank|vault)|svalbard|seed varieties/i },
  { name: "城市树木/树冠", re: /street tree|tree canopy|urban trees|canopy cover/i },
  { name: "光污染", re: /light pollution|dark sky|night sky|artificial light/i },
  { name: "抗生素耐药", re: /antibiotic|antimicrobial resistance|mcr-1/i },
  { name: "孤独感", re: /loneliness|lonely/i },
  { name: "上课时间与睡眠", re: /school start|start times|later start|teenage sleep|adolescent sleep/i },
  { name: "城市自行车道", re: /cycle lane|bike lane|bicycle lane|cycling infrastructure/i },
  { name: "社区太阳能", re: /community solar|solar farm|rooftop solar/i },
  { name: "学徒制/职业教育", re: /apprentice|vocational|levy/i },
  { name: "混合办公/远程", re: /hybrid work|remote work|working from home/i },
  { name: "办公楼改住宅", re: /office (building|floor)s? (into|to) (homes|housing)|conversion/i },
  { name: "图书馆新角色", re: /library|libraries/i },
  { name: "注意力经济", re: /attention economy|attention is|scroll/i },
  { name: "深度阅读/专注", re: /deep reading|concentration|focus/i },
  { name: "校园/青少年手机", re: /smartphone ban|phone ban|screen time/i },
  { name: "快速时尚", re: /fast fashion|disposable fashion/i },
  { name: "海洋塑料", re: /ocean plastic|marine plastic|microplastic/i },
  { name: "快递包装", re: /parcel|packaging|cardboard/i },
  { name: "气候移民", re: /climate migrant|climate refugee/i },
  { name: "保险费率与气候", re: /insurer|insurance|premium/i },
  { name: "渔业配额", re: /quota|overfis|fishery|fisheries/i },
  { name: "氢能", re: /hydrogen|green steel/i },
  { name: "森林碳汇/野火", re: /wildfire|forest carbon|reforestation/i },
  { name: "再生农业/土壤", re: /regenerative|soil organic|no-till|cover crop/i },
  { name: "湿地与候鸟", re: /wetland|migratory bird|bird migration/i },
  { name: "疫苗信任", re: /vaccine|vaccination/i },
  { name: "药价", re: /drug price|generic drug|pharmaceutical pricing/i },
  { name: "器官捐献", re: /organ don|transplant/i },
  { name: "手语/无障碍", re: /sign language|accessibility|wheelchair|barrier-free/i },
  { name: "极地科考", re: /arctic|antarctic|ice core|polar/i },
  { name: "太空碎片", re: /space debris|orbital debris|satellite collision/i },
  { name: "数据中心", re: /data cent|server farm|cooling/i },
  { name: "AI 与教育", re: /\bAI\b|artificial intelligence|chatbot/i },
];

const passages = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const id = file.replace(/\.json$/, "");
  if (!ids.has(id)) continue;
  const json = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const reading = (json.sections ?? []).find((s) => s.type === "reading");
  (reading?.passages ?? []).forEach((p, i) => {
    const txt = (p.paragraphs ?? []).map((x) => x.text).join(" ");
    passages.push({ id, idx: i + 1, txt });
  });
  const tr = (json.sections ?? []).find((s) => s.type === "translation")?.passages?.[0]?.questions?.[0];
  if (tr) passages.push({ id, idx: "翻译", txt: `${tr.stem} ${tr.analysis}` });
}

console.log(`扫描 ${passages.length} 个篇目/题项\n`);
const hits = [];
for (const topic of TOPICS) {
  const found = passages.filter((p) => topic.re.test(p.txt));
  if (found.length >= MIN) hits.push({ topic: topic.name, found });
}
hits.sort((a, b) => b.found.length - a.found.length);
for (const h of hits) {
  console.log(`【${h.topic}】${h.found.length} 处`);
  console.log(`  ${h.found.map((f) => `${f.id}#${f.idx}`).join("  ")}`);
}
const multi = hits.filter((h) => h.found.length >= 4).length;
console.log(`\n命中 ${hits.length} 个题材，其中 ≥4 处的有 ${multi} 个`);
