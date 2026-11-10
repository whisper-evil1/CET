"use client";

import { useState } from "react";
import { postJson } from "@/lib/api-client";
import type { Definition, ImportResult } from "@/lib/types";

type Props = { onImported: () => void };

type IncomingWord = { word: string; definitions?: Definition[] };

const SAMPLE = `abandon\t放弃，抛弃
ambiguous  adj. 模糊的；歧义的
take into account 把…考虑在内
sustain, 维持；支撑`;

/** 文件上限 2 MB：再大就是整本书了，前端先挡一层，别让浏览器卡死 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 外部词表导入。
 *
 * 两种输入：
 *   1. 文本框直接粘贴（最常用，手机上也能用）
 *   2. 选文件（txt / csv / json），用 FileReader 读成文本再走同一条路
 *      —— 不用 file.text()，那个 API 在 Safari 13 上还没有。
 *
 * JSON 文件若本身是数组，按结构化词条提交；否则一律当纯文本逐行解析。
 */
export function ImportView({ onImported }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [structured, setStructured] = useState<IncomingWord[] | null>(null);

  const reset = () => {
    setResult(null);
    setError("");
  };

  const parseJsonArray = (raw: string): IncomingWord[] | null => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
    try {
      const data = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(data)
        ? data
        : data && typeof data === "object" && Array.isArray((data as { words?: unknown }).words)
          ? ((data as { words: unknown[] }).words as unknown[])
          : null;
      if (!list) return null;

      const words: IncomingWord[] = [];
      for (const item of list) {
        if (typeof item === "string") {
          words.push({ word: item });
        } else if (item && typeof item === "object") {
          const record = item as { word?: unknown; definitions?: unknown; zh?: unknown; translation?: unknown };
          if (typeof record.word !== "string") continue;
          const definitions: Definition[] = [];
          if (Array.isArray(record.definitions)) {
            for (const def of record.definitions) {
              if (def && typeof def === "object") {
                const d = def as { pos?: unknown; zh?: unknown };
                if (typeof d.zh === "string" && d.zh.trim()) {
                  definitions.push({
                    pos: typeof d.pos === "string" ? d.pos : "",
                    zh: d.zh.trim(),
                  });
                }
              }
            }
          } else if (typeof record.zh === "string" && record.zh.trim()) {
            definitions.push({ pos: "", zh: record.zh.trim() });
          } else if (typeof record.translation === "string" && record.translation.trim()) {
            definitions.push({ pos: "", zh: record.translation.trim() });
          }
          words.push(definitions.length > 0 ? { word: record.word, definitions } : { word: record.word });
        }
      }
      return words.length > 0 ? words : null;
    } catch {
      return null;
    }
  };

  const handleFile = (file: File | null | undefined) => {
    if (!file) return;
    reset();
    if (file.size > MAX_FILE_BYTES) {
      setError("文件超过 2 MB，请拆分后再导入");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const words = parseJsonArray(raw);
      if (words) {
        setStructured(words);
        setText(`（JSON 数组：${words.length} 个词）`);
      } else {
        setStructured(null);
        setText(raw);
      }
    };
    reader.onerror = () => setError("文件读取失败，换个文件试试");
    reader.readAsText(file);
  };

  const submit = async () => {
    if (busy) return;
    reset();
    const payload = structured && structured.length > 0 ? { words: structured } : { text };
    if (!structured && !text.trim()) {
      setError("先粘贴一些单词，或选一个文件");
      return;
    }
    setBusy(true);
    try {
      const data = await postJson<ImportResult>("/api/vocab/import", payload);
      setResult(data);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-4">
      <p className="text-[11.5px] leading-[1.75] text-ink-mute">
        一行一个词，词和释义之间用空格、逗号、Tab 或竖线隔开都行。
        只写单词也可以——释义会自动从本地词库补齐（1.5 万条，不联网）。
        一次最多 800 个词。
      </p>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (structured) setStructured(null);
          setFileName("");
        }}
        rows={9}
        spellCheck={false}
        placeholder={"abandon\t放弃\nambiguous  adj. 模糊的\ntake into account 把…考虑在内"}
        className="mt-3 w-full resize-y rounded-[10px] border border-line bg-surface px-3.5 py-3 font-mono text-[13px] leading-[1.7] text-ink outline-none transition-colors placeholder:text-ink-mute/50 focus:border-accent"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="min-h-[38px] cursor-pointer rounded-full border border-line px-3 text-[12px] leading-[38px] text-ink-soft transition-colors hover:border-accent hover:text-accent">
          选择文件（txt / csv / json）
          <input
            type="file"
            accept=".txt,.csv,.json,text/plain,application/json"
            className="hidden"
            onChange={(e) => handleFile(e.target.files && e.target.files[0])}
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setText(SAMPLE);
            setStructured(null);
            setFileName("");
            reset();
          }}
          className="min-h-[38px] rounded-full px-3 text-[12px] text-ink-mute underline-offset-2 transition-colors hover:text-ink hover:underline"
        >
          填入示例
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="ml-auto min-h-[40px] rounded-[10px] bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "导入中…" : "导入到生词本"}
        </button>
      </div>

      {fileName && (
        <p className="mt-2 text-[11.5px] text-ink-mute">
          已读取：{fileName}
          {structured ? `（识别为 JSON，${structured.length} 个词）` : ""}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-[8px] border border-wrong/40 bg-wrong-soft px-3 py-2 text-[12px] text-wrong">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 rounded-[10px] border border-line bg-surface px-3.5 py-3">
          <p className="text-[13px] text-ink">
            解析 {result.total} 个词 · 新增{" "}
            <span className="text-accent">{result.added}</span> · 补全 {result.updated} · 已存在{" "}
            {result.skipped}
          </p>
          {result.unresolved.length > 0 && (
            <p className="mt-1.5 text-[11.5px] leading-[1.7] text-ink-mute">
              其中 {result.unresolved.length} 个词本地词库没有释义，已先入库，进生词本时会继续补：
              {result.unresolved.slice(0, 8).join("、")}
            </p>
          )}
          {result.rejected.length > 0 && (
            <p className="mt-1.5 text-[11.5px] leading-[1.7] text-ink-mute">
              这几行没读懂，已跳过：
              {result.rejected.map((line) => `「${line.slice(0, 24)}」`).join(" ")}
            </p>
          )}
          <p className="mt-2 text-[11.5px] text-ink-mute">
            去「生词本」看看——默认按优先级排队，先背最该背的。
          </p>
        </div>
      )}
    </div>
  );
}
