import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
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
    // 系统自带的 ffmpeg 优先。线上实测 ffmpeg-static 的 postinstall 在沙箱里
    // 经常下不全，留下一个 0 字节但权限 755 的文件——它执行时退出码 0、
    // 没有任何输出、也不产出文件，比「不存在」更难查。
    ...(process.platform === "win32"
      ? []
      : ["/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/snap/bin/ffmpeg"]),
    join(root, "node_modules", "ffmpeg-static", name),
    join(root, "..", "node_modules", "ffmpeg-static", name),
    join(root, "node_modules", ".bin", name),
  ].filter((p): p is string => Boolean(p));

  // ffmpeg-static 用 __dirname 定位二进制；webpack 打包后 __dirname 落在 .next 里，
  // 会得到不存在的路径。这里按项目真实目录显式查找，不经打包器静态解析。
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    // 真 ffmpeg 至少几十 MB；小于 1MB 的一律当残缺文件跳过
    try {
      if (statSync(candidate).size <= 1024 * 1024) continue;
    } catch {
      continue;
    }
    return candidate;
  }

  throw new Error("服务端未找到可用的 ffmpeg，请确认已安装 ffmpeg-static 或设置 FFMPEG_BIN");
}

function isAllowedExt(name: string): boolean {
  return ALLOWED_EXT.has(extname(name).toLowerCase());
}

/**
 * 编码器探测：容器里的 ffmpeg 不一定编得了 H.264。
 *
 * 实测线上系统的 /usr/local/bin/ffmpeg 解码正常、但没有 libx264
 * （精简构建为避开 GPL），烧字幕导出会直接报 Unknown encoder 'libx264'。
 * 这里把可用编码器探一次并按优先级挑，缺 libx264 时退到 openh264 / mpeg4，
 * 保证「能导出」这件事不依赖某个特定构建。
 */
export type EncoderPick = { video: string; audio: string };

let encoderCache: EncoderPick | null = null;

const VIDEO_PREFERENCE = ["libx264", "libopenh264", "mpeg4"];
const AUDIO_PREFERENCE = ["aac", "libmp3lame", "mp2"];

export async function pickEncoders(): Promise<EncoderPick> {
  if (encoderCache) return encoderCache;
  const bin = ffmpegBin();
  let text = "";
  try {
    const done = await execFileAsync(bin, ["-hide_banner", "-encoders"], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    text = done.stdout ?? "";
  } catch (error) {
    // 有些构建把 -encoders 打到 stderr，或返回非 0；能拿到文本就够用
    text = (error as { stdout?: string }).stdout ?? "";
  }
  const has = (name: string) => new RegExp(`(^|\\s)${name}(\\s|$)`, "m").test(text);

  encoderCache = {
    video: VIDEO_PREFERENCE.find(has) ?? "",
    audio: AUDIO_PREFERENCE.find(has) ?? "",
  };
  return encoderCache;
}

/** 视频编码参数；crf 只对 x264 系有意义，其余按码率/质量档给 */
export function videoEncodeArgs(pick: EncoderPick, crf = "22"): string[] {
  if (pick.video === "libx264") {
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p"];
  }
  if (pick.video === "libopenh264") {
    return ["-c:v", "libopenh264", "-b:v", "2000k", "-pix_fmt", "yuv420p"];
  }
  if (pick.video === "mpeg4") {
    return ["-c:v", "mpeg4", "-q:v", "4", "-pix_fmt", "yuv420p"];
  }
  // 一个都没有：交给 ffmpeg 自己挑默认编码器，总比直接失败强
  return ["-pix_fmt", "yuv420p"];
}

export function audioEncodeArgs(pick: EncoderPick): string[] {
  if (!pick.audio) return [];
  return ["-c:a", pick.audio, "-b:a", "128k"];
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
 * 元数据里没有时长时的兜底：真解码一遍，从进度行的 time= 累加出总长。
 *
 * 有些封装（部分 webm/mkv、被剪辑工具导出的 mp4）头里写的是 `Duration: N/A`，
 * 正则匹配得上却解析不出数字。这类文件本身没坏，能解码就能算时长，
 * 不该被判成「不是有效的视频」把用户挡回去。
 */
async function measureByDecode(
  bin: string,
  inputPath: string,
  fallbackStderr: string,
): Promise<{ durationSec: number; width: number; height: number }> {
  let stderr = "";
  try {
    const done = await execFileAsync(
      bin,
      ["-hide_banner", "-nostdin", "-i", inputPath, "-f", "null", "-"],
      { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
    );
    stderr = done.stderr ?? "";
  } catch (error) {
    const err = error as { stderr?: string; code?: string | number; killed?: boolean };
    stderr = err.stderr ?? "";
    if (err.killed) throw new Error("视频读取超时，请换个小一点的文件试试");
    if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
      throw new Error(`服务端 ffmpeg 无法执行（${err.code}），正在自动修复，请稍后重试`);
    }
    // 解码中途失败也要把已经解出来的部分算数：能解多少算多长
  }

  let durationSec = 0;
  const re = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    durationSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  if (durationSec <= 0) {
    const raw = stderr.replace(/\s+/g, " ").trim().slice(-240);
    const head = fallbackStderr.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(
      `读不到视频时长（解码输出 ${stderr.length}B：${raw || "空"}；探测输出：${head || "空"}）`,
    );
  }

  const { width, height } = parseMeta(stderr);
  const fromHead = parseMeta(fallbackStderr);
  return {
    durationSec,
    width: width || fromHead.width,
    height: height || fromHead.height,
  };
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
    // ffmpeg 只给 -i 不给输出文件时，通常以退出码 1 结束，元数据全在 stderr；
    // 但部分静态构建会返回 0。两条路径都必须取 stderr——以前只从 catch 里取，
    // 退出码为 0 时 stderr 会一直是空串，于是把「读到了」误判成「读不到」。
    let stderr = "";
    let killReason = "";
    try {
      const done = await execFileAsync(bin, ["-hide_banner", "-nostdin", "-i", inputPath], {
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      stderr = done.stderr ?? "";
    } catch (error) {
      const err = error as {
        stderr?: string;
        code?: string | number;
        message?: string;
        killed?: boolean;
      };
      stderr = err.stderr ?? "";
      if (err.killed) throw new Error("视频读取超时，请换个小一点的文件试试");
      if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
        // 服务端跑不起来和用户文件无关，别让人反复换文件试
        throw new Error(`服务端 ffmpeg 无法执行（${err.code}），正在自动修复，请稍后重试`);
      }
      killReason = stderr.trim().split("\n").filter(Boolean).pop() ?? (err.message || "").slice(0, 90);
    }

    // 2. 时长：先看头信息；头里没有（Duration: N/A 之类）就真解码数一遍
    let meta = parseMeta(stderr);
    if (meta.durationSec <= 0) {
      if (!/Duration:|Input #/.test(stderr)) {
        // ffmpeg 连容器都没认出来。输出字节数必须报出来：0B 说明二进制根本没跑
        // 起来（或 stderr 没被捕获），非 0 才是文件本身解不动——两种情况的
        // 处置完全不同，不能在用户面前糊成一句话。
        const raw = stderr.replace(/\s+/g, " ").trim().slice(0, 160);
        throw new Error(
          `不是有效的视频文件（ffmpeg 输出 ${stderr.length}B：${raw || killReason || "空"}）`,
        );
      }
      meta = await measureByDecode(bin, inputPath, stderr);
    }
    if (meta.durationSec > VIDEO_MAX_SECONDS) {
      throw new Error(`视频超过 ${VIDEO_MAX_SECONDS / 60} 分钟，请剪短后再上传`);
    }

    // 2. 均匀抽帧：在 10%/40%/70%/90% 时间点各取一帧，缩放到宽 480 的 jpg
    const points = [0.1, 0.4, 0.7, 0.9].slice(0, Math.max(1, Math.min(6, frameCount)));
    const frames: string[] = [];
    for (const ratio of points) {
      const at = Math.max(0.1, Math.min(meta.durationSec - 0.1, meta.durationSec * ratio));
      const outPath = join(dir, `frame_${ratio}.jpg`);
      // 抽帧只是预览增强：某一帧取不到（时间点越界、编码解不动）就跳过，
      // 不该因为少一张缩略图让整个上传失败。
      try {
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
      } catch {
        /* 跳过这一帧 */
      }
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
