import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { audioEncodeArgs, ffmpegBin, pickEncoders, videoEncodeArgs } from "./video-probe";

/**
 * 把英文字幕封装进原视频，输出带字幕轨的 MP4。
 *
 * 只做「封装」，不改画面内容、不换音轨、不生成英文配音：
 * - 第一优先：-c:v copy / -c:a copy，只加mov_text字幕轨，秒级完成且无损；
 * - 若原片编码不兼容 MP4（如 VP9/Opus），退回 libx264 + aac 重编码。
 *
 * 字幕是软字幕（播放器可开关）。平台若不支持内嵌字幕轨，仍需另导 .srt。
 * 视频与字幕都写在临时目录，返回字节后立刻删除，不落库、不留存。
 */

const execFileAsync = promisify(execFile);
const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);

function stamp(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function buildSrt(lines: string[], durationSec: number): string {
  const each = durationSec / lines.length;
  return lines
    .map((line, i) => {
      const start = i * each;
      const end = Math.min(durationSec, (i + 1) * each);
      return `${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${line.trim()}`;
    })
    .join("\n\n");
}

export type MuxResult = {
  buffer: Buffer;
  mode: "copy" | "reencode";
};

export async function muxEnglishSubtitles(
  name: string,
  video: Buffer,
  lines: string[],
  durationSec: number,
): Promise<MuxResult> {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean).slice(0, 60);
  if (cleaned.length === 0) throw new Error("没有可封装的字幕行");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("视频时长无效");

  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`不支持的视频格式：${ext || "未知"}`);

  const bin = ffmpegBin();
  const dir = await mkdtemp(join(tmpdir(), "cet-mux-"));
  const inputPath = join(dir, `input${ext}`);
  const srtPath = join(dir, "en.srt");
  const outPath = join(dir, "with-en-subs.mp4");

  try {
    await writeFile(inputPath, video);
    await writeFile(srtPath, buildSrt(cleaned, durationSec), "utf8");

    const base = [
      "-hide_banner", "-loglevel", "error",
      "-i", inputPath, "-i", srtPath,
      "-map", "0:v:0", "-map", "0:a?", "-map", "1:0",
      "-metadata:s:s:0", "language=eng",
      "-movflags", "+faststart",
    ];

    let mode: MuxResult["mode"] = "copy";
    try {
      await execFileAsync(
        bin,
        [...base, "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-y", outPath],
        { timeout: 180_000 },
      );
    } catch {
      // 源编码不兼容 MP4 时重编码；仍失败则把 ffmpeg 的错误抛给路由提示用户
      mode = "reencode";
      const pick = await pickEncoders();
      await execFileAsync(
        bin,
        [
          ...base,
          ...videoEncodeArgs(pick, "23"),
          ...audioEncodeArgs(pick),
          "-c:s", "mov_text", "-y", outPath,
        ],
        { timeout: 300_000 },
      );
    }

    return { buffer: await readFile(outPath), mode };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type BurnResult = {
  buffer: Buffer;
  mode: "burn";
};

/**
 * 把英文字幕真正烧进画面，输出可直接发布的 MP4。
 *
 * 短视频平台上传后往往不保留 mov_text 字幕轨，因此默认走这条路：
 * libass subtitles 滤镜渲染 SRT → libx264 重编码画面 → aac 音轨。
 * 用 cwd + 相对文件名传 SRT，避开 Windows 路径里的空格与反斜杠转义。
 */
export async function burnEnglishSubtitles(
  name: string,
  video: Buffer,
  lines: string[],
  durationSec: number,
  height = 360,
): Promise<BurnResult> {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean).slice(0, 60);
  if (cleaned.length === 0) throw new Error("没有可烧录的字幕行");
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("视频时长无效");

  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`不支持的视频格式：${ext || "未知"}`);

  const bin = ffmpegBin();
  const pick = await pickEncoders();
  const dir = await mkdtemp(join(tmpdir(), "cet-burn-"));
  const inputPath = join(dir, `input${ext}`);
  const srtPath = join(dir, "en.srt");
  const outPath = join(dir, "burned.mp4");

  // libass 的 FontSize 不随视频高度线性放大：实测 height/18 在 1080p 算出 60，
  // 字幕会占满半屏、严重遮挡画面。固定 20–22 在 360p/720p/1080p 都合适。
  // height 仅作轻微修正：高分辨率略大一点，但封顶 22。
  const fontSize = height >= 900 ? 22 : 20;
  const style = [
    "FontName=Arial",
    `FontSize=${fontSize}`,
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BorderStyle=1",
    "Outline=2",
    "Shadow=1",
    "Alignment=2",
    "MarginV=36",
  ].join(",");

  try {
    await writeFile(inputPath, video);
    await writeFile(srtPath, buildSrt(cleaned, durationSec), "utf8");

    await execFileAsync(
      bin,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", inputPath,
        "-vf", `subtitles=en.srt:force_style='${style}'`,
        ...videoEncodeArgs(pick, "22"),
        ...audioEncodeArgs(pick),
        "-movflags", "+faststart",
        "-y", outPath,
      ],
      { cwd: dir, timeout: 300_000 },
    );

    return { buffer: await readFile(outPath), mode: "burn" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
