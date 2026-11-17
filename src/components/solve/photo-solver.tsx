"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { solveByPhoto, type PhotoSolveResult } from "@/lib/agent-client";

/**
 * 拍照搜题工作台。
 *
 * 与刷题的区别：这里不是从题库选题，而是用户遇到任何不会的题，拍照交给
 * Agent 识别 + 解答。低置信度（need_recapture / blocked）时只给补拍引导，
 * 绝不展示猜测答案——这是和预览页、UAT 验收单一致的硬约束。
 */
export function PhotoSolver() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [hint, setHint] = useState("");
  const [result, setResult] = useState<PhotoSolveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = (next: File | null) => {
    setFile(next);
    setResult(null);
    setError("");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(next ? URL.createObjectURL(next) : "");
  };

  const run = async () => {
    if (!file) {
      setError("先拍一张题目标题照再提交");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await solveByPhoto(file, hint.trim() || undefined));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 4220
          ? err.message
          : err instanceof Error
            ? err.message
            : "识别失败，请重试",
      );
    } finally {
      setBusy(false);
    }
  };

  const lowConfidence = result && (result.needRecapture || result.blocked || result.confidence === "low");

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* 左：上传与拍摄 */}
      <section className="card-soft h-fit p-4 sm:p-5">
        <p className="text-[12.5px] font-medium text-ink">题目标题照</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {!preview && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 flex min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-[11px] border border-dashed border-line bg-paper/50 px-4 text-center transition-colors hover:border-accent"
          >
            <span className="text-[28px] leading-none text-accent">＋</span>
            <span className="text-[13px] text-ink">拍照 / 选择图片</span>
            <span className="text-[11px] text-ink-mute">JPG、PNG、WebP，最大 8MB</span>
          </button>
        )}

        {preview && (
          <div className="mt-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="待识别的题目照片"
              className="max-h-[260px] w-full rounded-[11px] border border-line object-contain"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex-1 rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
              >
                换一张
              </button>
              <button
                type="button"
                onClick={() => pick(null)}
                className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink-mute transition-colors hover:text-ink"
              >
                清除
              </button>
            </div>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="photo-hint" className="text-[11px] tracking-[0.14em] text-ink-mute uppercase">
            补充说明（可选）
          </label>
          <textarea
            id="photo-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder="例如：这是第 3 题，我选了 B，想知道为什么错"
            className="mt-1.5 w-full resize-y rounded-[11px] border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-[1.75] text-ink outline-none transition-colors placeholder:text-ink-mute/60 focus:border-accent"
          />
        </div>

        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !file}
          className="mt-4 min-h-[46px] w-full rounded-[10px] bg-ink py-3 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "识别讲解中…" : "拍照解答"}
        </button>
        {error && <p className="mt-2 text-[12px] leading-[1.7] text-wrong">{error}</p>}
        <p className="mt-3 text-[10.5px] leading-[1.7] text-ink-mute">
          图片仅用于本次识别，不写入作品库、不长期留存；含个人隐私的文字会先脱敏。
        </p>
      </section>

      {/* 右：解答 */}
      <section className="min-w-0">
        {!result && !busy && (
          <div className="card-soft flex h-full min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <p className="font-serif text-[17px] text-ink">左边拍照，右边出分步讲解</p>
            <p className="mx-auto mt-2 max-w-[40ch] text-[12.5px] leading-[1.8] text-ink-mute">
              识别题干 → 分步解答 → 标出易错点。遇到模糊或裁切的题目会请你补拍，
              不会拿猜测当答案。
            </p>
          </div>
        )}

        {busy && (
          <div className="card-soft flex h-full min-h-[280px] flex-col items-center justify-center p-8 text-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent" />
            <p className="mt-4 text-[13px] text-ink-soft">正在识别题干并生成讲解…</p>
          </div>
        )}

        {result && (
          <div className="card-soft p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] tracking-[0.06em] text-ink-mute">识别结果</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] text-ink-mute">
                  {result.mode === "dify" ? "Dify 工作流" : "内置视觉"}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${lowConfidence ? "tile-amber" : "tile-jade"}`}>
                  {lowConfidence ? "需要补拍" : "已识别"}
                </span>
                <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft">
                  {result.redactCount > 0 ? `脱敏 ${result.redactCount} 项` : "无需脱敏"}
                </span>
              </div>
            </div>

            {result.question && (
              <div className="mt-4 rounded-[11px] border border-line bg-paper/50 p-3">
                <p className="text-[10px] tracking-[0.16em] text-ink-mute uppercase">题干</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[1.8] text-ink">
                  {result.question}
                </p>
                {result.questionType && (
                  <p className="mt-1.5 text-[11px] text-ink-mute">题型：{result.questionType}</p>
                )}
              </div>
            )}

            {lowConfidence ? (
              <div className="mt-4 rounded-[11px] border border-line bg-paper/60 p-4">
                <p className="text-[13px] font-medium text-ink">这张图看不太清</p>
                <p className="mt-1.5 text-[12.5px] leading-[1.8] text-ink-soft">
                  {result.note || "题干不完整或置信度偏低，为了避免讲错题，这里不给出答案。"}
                </p>
                <p className="mt-2 text-[12.5px] leading-[1.8] text-ink-soft">
                  请正对题目重新拍一张，保证题干和选项完整、光线充足，再试一次。
                </p>
              </div>
            ) : (
              <>
                {result.answer && (
                  <div className="mt-4 rounded-[11px] border border-line bg-surface p-4">
                    <p className="text-[10px] tracking-[0.16em] text-accent uppercase">答案</p>
                    <p className="mt-1.5 whitespace-pre-wrap text-[15px] font-medium leading-[1.7] text-ink">
                      {result.answer}
                    </p>
                  </div>
                )}

                {result.steps.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">解题步骤</p>
                    <ol className="mt-2 space-y-2">
                      {result.steps.map((step, i) => (
                        <li key={i} className="flex gap-2 rounded-[9px] border border-line bg-paper/50 px-3 py-2">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-[10.5px] text-accent">
                            {i + 1}
                          </span>
                          <span className="whitespace-pre-wrap text-[12.5px] leading-[1.75] text-ink-soft">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {result.pitfalls.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] tracking-[0.16em] text-ink-mute uppercase">易错点</p>
                    <ul className="mt-2 space-y-1">
                      {result.pitfalls.map((pit, i) => (
                        <li key={i} className="text-[12px] leading-[1.8] text-wrong">
                          · {pit}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
