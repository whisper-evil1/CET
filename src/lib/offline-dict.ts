import fs from "node:fs";
import path from "node:path";

/**
 * 离线词库加载层：从 data/offline-dict.json 懒加载到内存 Map。
 * 数据来源：ecdict 提取的 cet4/cet6/zk/gk/ky/toefl/ielts/gre 标签词，约 1.5 万条。
 * 查词毫秒级，无网络依赖。
 */

type OfflineEntry = {
  phonetic: string;
  definitions: { pos: string; zh: string }[];
  tags?: string[];
};

type OfflineDictData = Record<string, OfflineEntry>;

let dict: OfflineDictData | null = null;
let loaded = false;

/** 懒加载：首次调用时读取 JSON 到内存，之后复用 */
function load(): OfflineDictData {
  if (loaded && dict) return dict;
  // 尝试几个可能的路径（适配不同运行环境）
  const candidates = [
    path.join(process.cwd(), "data", "offline-dict.json"),
    path.join(__dirname, "..", "..", "data", "offline-dict.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      dict = JSON.parse(raw) as OfflineDictData;
      loaded = true;
      console.log(`[offline-dict] loaded ${Object.keys(dict).length} entries from ${p}`);
      return dict;
    } catch {
      // 继续尝试下一个路径
    }
  }
  console.warn("[offline-dict] offline-dict.json not found, offline lookup disabled");
  dict = {};
  loaded = true;
  return dict;
}

/** 在离线词库中查一个词（不做词形还原，调用方负责） */
export function lookupOffline(word: string): OfflineEntry | null {
  const d = load();
  return d[word] ?? null;
}

/** 词库是否已加载且有数据 */
export function hasOfflineDict(): boolean {
  return Object.keys(load()).length > 0;
}
