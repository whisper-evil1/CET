import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { ffmpegBin } from "./video-probe";

/**
 * 英文配音成片：把英文字幕逐句合成语音，替换中文原声，并按真实语音时长烧录字幕。
 *
 * 依赖：Python + edge-tts（免费微软在线音色）。未安装时抛错，路由回退到「只烧字幕」版本。
 * 步骤：
 *   1. Python 脚本逐句合成 mp3 + timing.json（每句 start_ms/dur_ms）
 *   2. ffmpeg 用 adelay 把每句放到 start_ms，amix 合成一条英文音轨
 *   3. ffmpeg 换音轨 + libass 烧字幕 → MP4
 *
 * 这是「英文字幕驱动配音」：音字精确对齐，但不等于翻译了原视频里说的话。
 * 原视频中文口播只是被替换掉，画面里的中文界面仍无法自动本地化。
 */
const execFileAsync = promisify(execFile);
const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);

type Timing = { index: number; text: string; start_ms: number; dur_ms: number };

function stamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

function pythonBin(): string {
  return process.env.PYTHON_BIN || "python";
}

export type DubResult = { buffer: Buffer; mode: "dub" };

export async function dubEnglishVideo(
  name: string,
  video: Buffer,
  lines: string[],
  durationSec: number,
  height = 360,
  voice = "en-US-AriaNeural",
): Promise<DubResult> {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean).slice(0, 30);
  if (cleaned.length === 0) throw new Error("没有可配音的字幕行");

  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error(`不支持的视频格式：${ext || "未知"}`);

  const bin = ffmpegBin();
  const dir = await mkdtemp(join(tmpdir(), "cet-dub-"));
  const inputPath = join(dir, `input${ext}`);
  const srtPath = join(dir, "en.srt");
  const outPath = join(dir, "dubbed.mp4");
  const script = join(process.cwd(), "scripts", "tts-dub.py");

  try {
    await writeFile(inputPath, video);

    // 1. 逐句合成语音 + 精确时间码
    await execFileAsync(
      pythonBin(),
      [script, JSON.stringify(cleaned), dir, voice, String(Math.round(durationSec * 1000))],
      { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const timing: Timing[] = JSON.parse(await readFile(join(dir, "timing.json"), "utf8"));
    if (!Array.isArray(timing) || timing.length !== cleaned.length) {
      throw new Error("配音时间码生成失败");
    }

    // 2. SRT 用配音的真实时间码（逐句对齐）
    const srt = timing
      .map((t, i) => `${i + 1}\n${stamp(t.start_ms)} --> ${stamp(t.start_ms + t.dur_ms)}\n${t.text}`)
      .join("\n\n");
    await writeFile(srtPath, srt, "utf8");

    const fontSize = height >= 900 ? 22 : 20;
    const style = [
      "FontName=Arial", `FontSize=${fontSize}`,
      "PrimaryColour=&H00FFFFFF", "OutlineColour=&H00000000",
      "BorderStyle=1", "Outline=2", "Shadow=1", "Alignment=2", "MarginV=36",
    ].join(",");

    // 3. adelay 把每句语音放到对应时间点，amix 合成英文音轨；同时烧字幕
    const args: string[] = ["-hide_banner", "-loglevel", "error", "-i", inputPath];
    timing.forEach((t) => args.push("-i", join(dir, `seg_${t.index}.mp3`)));

    const audioLabels = timing
      .map((t, i) => `[${i + 1}:a]adelay=${t.start_ms}|${t.start_ms}[a${i}]`)
      .join(";");
    const mixInputs = timing.map((_, i) => `[a${i}]`).join("");
    const filter = [
      audioLabels,
      `${mixInputs}amix=inputs=${timing.length}:duration=longest:normalize=0[enaudio]`,
      `[0:v]subtitles=en.srt:force_style='${style}'[v]`,
    ].join(";");

    args.push(
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[enaudio]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-t", String(durationSec),
      "-movflags", "+faststart",
      "-y", outPath,
    );

    await execFileAsync(bin, args, { cwd: dir, timeout: 600_000 });
    return { buffer: await readFile(outPath), mode: "dub" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
