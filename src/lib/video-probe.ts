import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

/**
 * 视频探测与关键帧抽取（仅服务端）。
 *
 * 用 ffmpeg-static 自带的二进制，通过 execFile 传参数数组调用——
 * 不经 shell、不拼命令字符串，规避路径空格与注入风险。
 * 临时文件用完即删，视频原件不落库、不留存。
 *
 * 本轮只做：读时长/分辨率 + 抽 N 张关键帧（base64 缩略图供预览）。
 * 不做 ASR、不做英文配音（当前云 SDK 无语音能力）。
 */
const execFileAsync = promisify(execFile);

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100MB
export const VIDEO_MAX_SECONDS = 180; // 3 分钟（短视频范围）

const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);

export type VideoMeta = {
  durationSec: number;
  width: number;
  height: number;
  format: string;
  frames: string[]; // data URL 缩略图
};

export function ffmpegBin(): string {
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const root = process.cwd();
  const candidates = [
    process.env.FFMPEG_BIN,
    join(root, "node_modules", "ffmpeg-static", name),
    join(root, "..", "node_modules", "ffmpeg-static", name),
    join(root, "node_modules", ".bin", name),
  ].filter((p): p is string => Boolean(p));

  // ffmpeg-static 用 __dirname 定位二进制；webpack 打包后 __dirname 落在 .next 里，
  // 会得到不存在的路径。这里按项目真实目录显式查找，不经打包器静态解析。
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error("服务端未找到 ffmpeg，请确认已安装 ffmpeg-static 或设置 FFMPEG_BIN");
}

function isAllowedExt(name: string): boolean {
  return ALLOWED_EXT.has(extname(name).toLowerCase());
}

/** 从 ffmpeg -i 的 stderr 里解析时长与分辨率（ffmpeg 把元数据输出到 stderr） */
function parseMeta(stderr: string): { durationSec: number; width: number; height: number } {
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durMatch
    ? Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
    : 0;
  const resMatch = stderr.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const width = resMatch ? Number(resMatch[1]) : 0;
  const height = resMatch ? Number(resMatch[2]) : 0;
  return { durationSec, width, height };
}

/**
 * 探测视频并抽取关键帧。
 * @param name 原始文件名（仅用于校验扩展名）
 * @param buffer 视频字节
 * @param frameCount 抽几帧（1-6）
 */
export async function probeVideo(
  name: string,
  buffer: Buffer,
  frameCount = 4,
): Promise<VideoMeta> {
  if (!isAllowedExt(name)) {
    throw new Error(`不支持的视频格式：${extname(name) || "未知"}`);
  }
  const bin = ffmpegBin();
  const dir = await mkdtemp(join(tmpdir(), "cet-vid-"));
  const inputPath = join(dir, `input${extname(name).toLowerCase()}`);
  try {
    await writeFile(inputPath, buffer);

    // 1. 读元数据（失败即视为非有效视频）
    let stderr = "";
    try {
      await execFileAsync(bin, ["-hide_banner", "-i", inputPath], { timeout: 15_000 });
    } catch (error) {
      const err = error as { stderr?: string };
      stderr = err.stderr ?? "";
      if (!/Duration:/.test(stderr)) throw new Error("不是有效的视频文件");
    }
    const meta = parseMeta(stderr);
    if (meta.durationSec <= 0) throw new Error("读不到视频时长，请换个文件试试");
    if (meta.durationSec > VIDEO_MAX_SECONDS) {
      throw new Error(`视频超过 ${VIDEO_MAX_SECONDS / 60} 分钟，请剪短后再上传`);
    }

    // 2. 均匀抽帧：在 10%/40%/70%/90% 时间点各取一帧，缩放到宽 480 的 jpg
    const points = [0.1, 0.4, 0.7, 0.9].slice(0, Math.max(1, Math.min(6, frameCount)));
    const frames: string[] = [];
    for (const ratio of points) {
      const at = Math.max(0.1, Math.min(meta.durationSec - 0.1, meta.durationSec * ratio));
      const outPath = join(dir, `frame_${ratio}.jpg`);
      await execFileAsync(
        bin,
        [
          "-hide_banner", "-loglevel", "error", "-ss", at.toFixed(2),
          "-i", inputPath, "-frames:v", "1", "-vf", "scale=480:-2",
          "-q:v", "5", "-y", outPath,
        ],
        { timeout: 20_000 },
      );
      const buf = await readFile(outPath);
      frames.push(`data:image/jpeg;base64,${buf.toString("base64")}`);
    }

    return {
      durationSec: Math.round(meta.durationSec * 10) / 10,
      width: meta.width,
      height: meta.height,
      format: extname(name).toLowerCase().replace(".", ""),
      frames,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
