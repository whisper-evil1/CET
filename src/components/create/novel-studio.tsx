"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { withSharecode } from "@/lib/share-code";
import { generateNovel, MODE_LABEL, warmUpCloud, type GenMode } from "@/lib/creation-client";
import { clearDraft, hasPending, loadDraft, markPending, saveDraft } from "@/lib/create-draft";
import {
  DEFAULT_NOVEL_OPTIONS,
  MAX_SOURCE_CHARS,
  NOVEL_AUDIENCE_LABEL,
  NOVEL_STYLE_LABEL,
  novelToMarkdown,
  splitParagraphs,
  type NovelAudience,
  type NovelOptions,
  type NovelOutput,
  type NovelStyle,
} from "@/lib/creation";

/**
 * 小说英译改编工作台。
 *
 * 双栏对照是核心：左边永远是中文原段，右边是英文改编。这样「改没改丢信息」
 * 一眼能看出来 —— 只给一整段英文译文的工作台，读者无从校对。
 */

const SAMPLE = `我冒了严寒，回到相隔二千余里，别了二十余年的故乡去。
时候既然是深冬；渐近故乡时，天气又阴晦了，冷风吹进船舱中，呜呜的响，从篷隙向外一望，苍黄的天底下，远近横着几个萧索的荒村，没有一些活气。我的心禁不住悲凉起来了。
啊！这不是我二十年来时时记得的故乡？
我所记得的故乡全不如此。我的故乡好得多了。但要我记起他的美丽，说出他的佳处来，却又没有影像，没有言辞了。`;

type SavedWork = {
  id: string;
  kind: string;
  title: string;
  sourceText: string;
  output: NovelOutput | null;
  meta: NovelOptions | null;
  createdAt: string;
};

export function NovelStudio({ workId }: { workId?: string }) {
  const [source, setSource] = useState("");
  const [options, setOptions] = useState<NovelOptions>(DEFAULT_NOVEL_OPTIONS);
  const [output, setOutput] = useState<NovelOutput | null>(null);
  const [mode, setMode] = useState<GenMode | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedTip, setSavedTip] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingestNote, setIngestNote] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);

  const loadSaved = useCallback(async (id: string) => {
    try {
      const list = await apiFetch<SavedWork[]>("/api/create?kind=novel");
      const hit = (list ?? []).find((item) => item.id === id);
      if (!hit) return;
      setSource(hit.sourceText);
      if (hit.meta) setOptions({ ...DEFAULT_NOVEL_OPTIONS, ...hit.meta });
      if (hit.output) {
        setOutput(hit.output);
        setMode("server");
      }
      setSavedTip(`已载入作品「${hit.title}」`);
    } catch {
      /* 载入失败不阻塞新建 */
    }
  }, []);

  useEffect(() => {
    warmUpCloud();
    if (workId) {
      void loadSaved(workId);
      return;
    }
    // 新建工作台：从草稿恢复上次未保存的输入，并检查是否有中断的生成任务
    const draft = loadDraft<NovelOptions>("novel");
    if (draft) {
      setSource(draft.source);
      if (draft.options) setOptions((prev) => ({ ...prev, ...draft.options }));
    }
    setInterrupted(hasPending("novel"));
  }, [workId, loadSaved]);

  // 输入 / 参数变化后防抖写入草稿：切走页面、关标签再回来，内容还在
  useEffect(() => {
    if (workId) return;
    if (!source.trim()) return;
    const timer = window.setTimeout(() => saveDraft("novel", source, options), 400);
    return () => window.clearTimeout(timer);
  }, [source, options, workId]);

  /** 上传 PDF/Word/txt/zip → 服务端抽文本 → 填入编辑框供校对 */
  const ingest = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setIngestNote("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await apiFetch<{
        text: string;
        files: string[];
        skipped: string[];
        truncated: boolean;
      }>("/api/create/ingest", { method: "POST", body: form });
      const next = data.text.slice(0, MAX_SOURCE_CHARS);
      setSource((prev) => (prev.trim() ? `${prev}\n\n${next}` : next));
      const bits = [`已读取 ${data.files.length} 个文件`];
      if (data.skipped.length) bits.push(`跳过 ${data.skipped.length} 项不支持文件`);
      if (data.truncated || data.text.length > MAX_SOURCE_CHARS) bits.push("文本过长已截断，请检查");
      bits.push("请在左侧校对后再生成");
      setIngestNote(bits.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "文件解析失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** 导出 Word：服务端 docx 库生成 .docx 下载 */
  const exportDocx = async () => {
    if (!output) return;
    setExporting(true);
    setError("");
    try {
      const response = await fetch(withSharecode("/api/create/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "docx", title: output.title, output }),
      });
      if (!response.ok) {
        const msg = await response.json().catch(() => null);
        throw new Error(msg?.message ?? `导出失败（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(output.title || "adaptation").replace(/[\\/:*?"<>|]/g, "").slice(0, 40)}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 Word 失败");
    } finally {
      setExporting(false);
    }
  };

  const chars = source.replace(/\s/g, "").length;
  const paragraphs = splitParagraphs(source, options.paragraphs).length;

  /** 保存到作品库；生成成功后自动调用，也可手动「保存」再存一次 */
  const persist = async (out: NovelOutput): Promise<void> => {
    try {
      const created = await apiFetch<{ id: string }>("/api/create", {
        method: "POST",
        body: JSON.stringify({
          kind: "novel",
          title: out.title.slice(0, 150) || "未命名改编",
          sourceText: source,
          output: JSON.stringify(out),
          meta: JSON.stringify(options),
        }),
      });
      setSavedTip(`已保存到作品库（${created.id.slice(0, 6)}…）`);
      clearDraft("novel");
    } catch (err) {
      setError(err instanceof Error ? err.message : "自动保存失败，可点「保存」重试");
    }
  };

  const run = async () => {
    if (source.trim().length < 20) {
      setError("至少写一段（20 字以上）再生成");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    setSavedTip("");
    setInterrupted(false);
    markPending("novel", true);
    try {
      const result = await generateNovel(source, options);
      setOutput(result.output);
      setMode(result.mode);
      setNote(result.note);
      // 生成成功立即入库：解决「做了一版但网页端没有记录」
      // 服务端通道会自己落库（哪怕前端已经切走），拿到 savedId 就不再重复存
      if (result.savedId) {
        setSavedTip(`已保存到作品库（${result.savedId.slice(0, 6)}…）`);
        clearDraft("novel");
      } else if (result.mode !== "offline") {
        await persist(result.output);
      }
      markPending("novel", false);
      // 窄屏是上下堆叠，结果在输入卡下面一屏之外，不滚一下用户会以为没反应
      if (typeof window !== "undefined" && window.innerWidth < 1024) {
        window.setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (err) {
      markPending("novel", false);
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!output) return;
    await persist(output);
  };

  const download = () => {
    if (!output || typeof window === "undefined") return;
    const blob = new Blob([novelToMarkdown(output, options)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(output.title || "adaptation").replace(/[\\/:*?"<>|]/g, "").slice(0, 40)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyEnglish = async () => {
    if (!output || typeof navigator === "undefined" || !navigator.clipboard) return;
    const text = output.paragraphs.map((p) => p.en).filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("浏览器不允许自动复制，请手动选中导出");
    }
  };

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* 左：输入与参数 */}
      <section className="card-soft h-fit p-4 sm:p-5">
        {interrupted && (
          <div className="mb-3 rounded-[10px] border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[11.5px] leading-[1.7] text-ink-soft">
            上次生成似乎被中断了，输入已从草稿恢复，可以重新生成。
            <button
              type="button"
              onClick={() => void run()}
              className="ml-1 text-accent underline-offset-2 hover:underline"
            >
              重新生成 →
            </button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium text-ink">中文原文</p>
          <span className="font-mono text-[11px] text-ink-mute">
            {chars}/{MAX_SOURCE_CHARS}
          </span>
        </div>

        {/* 文件上传：PDF / Word / Markdown / TXT / ZIP，解析后填入编辑框供校对 */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.zip"
          className="hidden"
          onChange={(e) => void ingest(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[11px] border border-dashed border-line bg-paper/50 px-3 py-2.5 text-[12px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <span aria-hidden>↑</span>
          {uploading ? "正在读取文件…" : "上传文件导入（PDF / Word / TXT / MD / ZIP）"}
        </button>
        {ingestNote && <p className="mt-1.5 text-[11px] leading-[1.6] text-correct">{ingestNote}</p>}

        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value.slice(0, MAX_SOURCE_CHARS))}
          rows={9}
          placeholder="粘贴一段中文小说/散文，一次建议 300–1500 字。"
          className="mt-2 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-3 text-[13.5px] leading-[1.85] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSource(SAMPLE)}
            className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            填入示例（《故乡》）
          </button>
          <button
            type="button"
            onClick={() => {
              setSource("");
              setOutput(null);
              setMode(null);
              setNote("");
              setSavedTip("");
            }}
            className="rounded-full border border-line px-3 py-1 text-[11.5px] text-ink-mute transition-colors hover:text-ink"
          >
            清空
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">文体</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(NOVEL_STYLE_LABEL) as NovelStyle[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, style: key }))}
                  className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                    options.style === key
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-soft hover:border-accent"
                  }`}
                >
                  {NOVEL_STYLE_LABEL[key].split("（")[0]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">目标读者</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(Object.keys(NOVEL_AUDIENCE_LABEL) as NovelAudience[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, audience: key }))}
                  className={`rounded-full border px-3 py-1 text-[11.5px] transition-colors ${
                    options.audience === key
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink-soft hover:border-accent"
                  }`}
                >
                  {NOVEL_AUDIENCE_LABEL[key]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-[10px] border border-line px-3 py-2">
            <div className="min-w-0">
              <p className="text-[12px] text-ink">保留拼音</p>
              <p className="mt-0.5 text-[10.5px] text-ink-mute">人名地名首次出现用拼音加注</p>
            </div>
            <button
              type="button"
              onClick={() => setOptions((o) => ({ ...o, keepNames: !o.keepNames }))}
              className={`h-6 w-11 shrink-0 rounded-full border transition-colors ${
                options.keepNames ? "border-accent bg-accent" : "border-line bg-paper-deep"
              }`}
              aria-pressed={options.keepNames}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white transition-transform ${
                  options.keepNames ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">改编段数</p>
              <span className="font-mono text-[11.5px] text-ink-soft">
                前 {options.paragraphs} 段
                <span className="ml-1 text-ink-mute">（原文共 {splitParagraphs(source, 99).length} 段）</span>
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              value={options.paragraphs}
              onChange={(e) => setOptions((o) => ({ ...o, paragraphs: Number(e.target.value) }))}
              className="mt-2 w-full accent-[#a6392b]"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="mt-4 min-h-[46px] w-full rounded-[10px] bg-ink py-3 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "生成中…（可切走，完成后自动保存）" : `生成英文改编（${paragraphs} 段）`}
        </button>

        {error && <p className="mt-2 text-[12px] text-wrong">{error}</p>}
        {note && <p className="mt-2 text-[11.5px] text-ink-mute">{note}</p>}
        {savedTip && <p className="mt-2 text-[11.5px] text-correct">{savedTip}</p>}
      </section>

      {/* 右：结果 */}
      <section className="min-w-0" ref={resultRef as React.RefObject<HTMLElement>}>
        {!output && (
          <div className="card-soft flex h-full min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <p className="font-serif text-[17px] text-ink">左边贴一段中文，右边出英文改编</p>
            <p className="mx-auto mt-2 max-w-[40ch] text-[12.5px] leading-[1.8] text-ink-mute">
              输出是段级对照：每段左边中文、右边英文，另附专名表和 2–4 条改编说明。
              可以保存到作品库，也可以导出 Markdown 继续改。
            </p>
          </div>
        )}

        {output && (
          <div className="card-soft p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words font-serif text-[21px] leading-snug text-ink">
                  {output.title}
                </h2>
                {output.subtitle && (
                  <p className="mt-1 text-[12px] text-ink-mute">{output.subtitle}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                  {mode && (
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        mode === "offline" ? "tile-amber" : "tile-jade"
                      }`}
                    >
                      {MODE_LABEL[mode]}
                    </span>
                  )}
                  <span>{output.paragraphs.length} 段</span>
                  <span>英文 {output.wordCount} 词</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="rounded-full border border-accent px-3 py-1.5 text-[11.5px] text-accent transition-colors hover:bg-accent-soft"
                >
                  预览 / 存 PDF
                </button>
                <button
                  type="button"
                  onClick={() => void copyEnglish()}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  {copied ? "已复制" : "复制英文"}
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  className="rounded-full bg-ink px-3 py-1.5 text-[11.5px] text-paper"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => void exportDocx()}
                  disabled={exporting}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {exporting ? "导出中…" : "导出 Word"}
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                >
                  导出 .md
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {output.paragraphs.map((p, i) => (
                <div
                  key={i}
                  className="grid gap-2 rounded-[11px] border border-line bg-paper/50 p-3 sm:grid-cols-2 sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] tracking-[0.16em] text-ink-mute uppercase">
                      原文 {i + 1}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.85] text-ink-soft">
                      {p.zh}
                    </p>
                  </div>
                  <div className="min-w-0 sm:border-l sm:border-line-soft sm:pl-4">
                    <p className="text-[10px] tracking-[0.16em] text-accent uppercase">English</p>
                    <p className="mt-1 whitespace-pre-wrap font-serif text-[13px] leading-[1.8] text-ink">
                      {p.en || "（未生成英文，模型未连通时只给结构骨架）"}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {output.glossary.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">专名表</p>
                <ul className="mt-2 divide-y divide-line-soft border-t border-line">
                  {output.glossary.map((g) => (
                    <li key={g.term} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                      <span className="font-serif text-[13px] text-ink">{g.term}</span>
                      <span className="text-[11.5px] text-ink-soft">{g.gloss}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {output.notes.length > 0 && (
              <div className="mt-5">
                <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">改编说明</p>
                <ul className="mt-2 space-y-1">
                  {output.notes.map((n, i) => (
                    <li key={i} className="text-[12px] leading-[1.8] text-ink-soft">
                      · {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-5 text-[11px] text-ink-mute">
              想接着改？<Link href="/create" className="text-accent underline-offset-2 hover:underline">回作品库</Link>
              ，或
              <Link href="/create/video" className="mx-1 text-accent underline-offset-2 hover:underline">把这段改成短视频</Link>
              也行。
            </p>
          </div>
        )}
      </section>

      {/* 预览弹窗：所见即所得，浏览器打印即可存为 PDF（中文渲染完美、零字体依赖） */}
      {previewOpen && output && (
        <div className="novel-preview-overlay" role="dialog" aria-modal="true" aria-label="改编稿预览">
          <div className="novel-preview-bar no-print">
            <span className="text-[12px] text-ink-soft">预览 · 排版即最终导出样式</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-full bg-ink px-4 py-1.5 text-[12px] text-paper"
              >
                打印 / 存为 PDF
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-full border border-line px-4 py-1.5 text-[12px] text-ink-soft"
              >
                关闭
              </button>
            </div>
          </div>
          <div className="novel-preview-scroll">
            <article className="novel-preview-paper">
              <h1>{output.title}</h1>
              {output.subtitle && <p className="np-subtitle">{output.subtitle}</p>}
              <p className="np-meta">
                段级对照 · {output.paragraphs.length} 段 · 英文约 {output.wordCount} 词
              </p>

              <h2>段级对照</h2>
              {output.paragraphs.map((p, i) => (
                <section key={i} className="np-para">
                  <p className="np-label">原文 {i + 1}</p>
                  <p className="np-zh">{p.zh}</p>
                  <p className="np-label np-en-label">English {i + 1}</p>
                  <p className="np-en">{p.en || "（未生成英文）"}</p>
                </section>
              ))}

              {output.glossary.length > 0 && (
                <>
                  <h2>专名表</h2>
                  <table className="np-table">
                    <tbody>
                      {output.glossary.map((g) => (
                        <tr key={g.term}>
                          <td className="np-term">{g.term}</td>
                          <td>{g.gloss}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {output.notes.length > 0 && (
                <>
                  <h2>改编说明</h2>
                  <ul className="np-notes">
                    {output.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
            </article>
          </div>
        </div>
      )}
    </div>
  );
}
