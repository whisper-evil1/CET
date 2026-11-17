import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { audioEncodeArgs, ffmpegBin, pickEncoders, videoEncodeArgs } from "./video-probe";

/**
 * 英文配音成片：把英文字幕逐句合成语音，替换中文原声，并按真实语音时长烧录字幕。
 *
 * 合成走 Node 里的 `msedge-tts`（微软 Edge 朗读接口，免费在线音色），
 * 和听力音频、故事朗读用的是同一条链路 —— 线上只装了 Node，没有 Python。
 * 早先版本调用 `scripts/tts-dub.py` + pip 的 edge-tts，容器里没有这个包，
 * 于是「英文配音成片」在线上必定抛 ModuleNotFoundError；现在这条依赖已经去掉。
 *
 * 步骤：
 *   1. 逐句合成 mp3（失败重试，重试前重建连接）
 *   2. 一次 ffmpeg 探测拿到每句真实时长 → 算出 time code
 *   3. adelay 把每句放到对应时间点，amix 合成一条英文音轨
 *   4. 换音轨 + libass 烧字幕 → MP4（subtitles 滤镜不可用时退成软字幕轨，仍出片）
 *
 * 时间码策略与旧脚本一致：把 N 句按「各自语音时长」铺满整条视频，长句分更长窗口，
 * 停顿均匀分摊；语音总长超过视频时用 atempo 轻微加速（≤2×）塞进去，不截断句子。
 *
 * 这是「英文字幕驱动配音」：音字精确对齐，但不等于翻译了原视频里说的话。
 * 原视频中文口播只是被替换掉，画面里的中文界面仍无法自动本地化。
 */
const execFileAsync = promisify(execFile);
const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"]);

/** 合成阶段的总预算，留出余量给后面的重编码（路由 maxDuration 是 600s） */
const SYNTH_BUDGET_MS = 5 * 60_000;

type Timing = { index: number; text: string; start_ms: number; dur_ms: number; tempo: number };

function stamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`;
}

type TtsModule = typeof import("msedge-tts");
type TtsEngine = InstanceType<TtsModule["MsEdgeTTS"]>;

let ttsModule: TtsModule | null = null;

/** 动态加载：这个包依赖 ws，装不上或版本不匹配时静态 import 会拖垮整个路由 */
async function loadTts(): Promise<TtsModule> {
  if (ttsModule) return ttsModule;
  ttsModule = await import("msedge-tts");
  return ttsModule;
}

async function makeEngine(voice: string): Promise<TtsEngine> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await loadTts();
  const engine = new MsEdgeTTS({ connectionTimeoutMs: 15_000, synthesisTimeoutMs: 60_000 });
  await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    voiceLocale: "en-US",
  });
  return engine;
}

async function synthOne(engine: TtsEngine, text: string, file: string): Promise<void> {
  const { audioStream } = engine.toStream(text);
  await pipeline(audioStream, createWriteStream(file));
  const info = await stat(file);
  // 一句正常语音至少几十 KB；几百字节基本是空音频（接口限流/断流时的产物）
  if (info.size < 1024) throw new Error(`语音片段为空（${info.size}B）`);
}

/** 把 stderr 里的 Duration 按输入顺序取出来（毫秒） */
function parseDurations(stderr: string): number[] {
  const out: number[] = [];
  const re = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    out.push(Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000));
  }
  return out;
}

/**
 * 一次 ffmpeg 调用量出所有片段的真实时长。
 * mp3 头部时长偶尔和实际解码长度差几十毫秒，这里以解码结果为准；
 * 批量解析失败时再逐个补测，不让一句的怪文件废掉整条配音。
 */
async function measureAll(bin: string, files: string[]): Promise<number[]> {
  const args = ["-hide_banner", "-nostdin"];
  files.forEach((f) => args.push("-i", f));
  args.push("-f", "null", "-");

  let stderr = "";
  try {
    const done = await execFileAsync(bin, args, { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    stderr = done.stderr ?? "";
  } catch (error) {
    stderr = (error as { stderr?: string }).stderr ?? "";
  }

  const batch = parseDurations(stderr);
  if (batch.length === files.length && batch.every((d) => d > 0)) return batch;

  const out: number[] = [];
  for (const f of files) {
    let s = "";
    try {
      const done = await execFileAsync(bin, ["-hide_banner", "-nostdin", "-i", f, "-f", "null", "-"], {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      s = done.stderr ?? "";
    } catch (error) {
      s = (error as { stderr?: string }).stderr ?? "";
    }
    const one = parseDurations(s);
    const value = one.length ? one[one.length - 1] : 0;
    if (value <= 0) throw new Error("配音片段时长读取失败");
    out.push(value);
  }
  return out;
}

/**
 * 时间码：把 N 句按语音长度铺满视频。
 * 语音总长超过可用时长时，统一用 atempo 加速（封顶 2×），让最后一句也留在片子里。
 */
function buildTiming(texts: string[], speech: number[], durationMs: number): Timing[] {
  const n = texts.length;
  const totalSpeech = speech.reduce((a, b) => a + b, 0);
  const usable = durationMs > 0 ? durationMs * 0.98 : 0;
  const tempo = usable > 0 && totalSpeech > usable ? Math.min(2, totalSpeech / usable) : 1;

  if (usable > 0 && totalSpeech / tempo < usable) {
    const played = totalSpeech / tempo;
    const gap = (usable - played) / (n + 1);
    let cursor = gap;
    return texts.map((text, i) => {
      const dur = speech[i] / tempo;
      const item: Timing = {
        index: i,
        text,
        start_ms: Math.round(cursor),
        dur_ms: Math.round(dur),
        tempo,
      };
      cursor += dur + gap;
      return item;
    });
  }

  let cursor = 0;
  return texts.map((text, i) => {
    const dur = speech[i] / tempo;
    const item: Timing = {
      index: i,
      text,
      start_ms: Math.round(cursor),
      dur_ms: Math.round(dur),
      tempo,
    };
    cursor += dur;
    return item;
  });
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
  const pick = await pickEncoders();
  const dir = await mkdtemp(join(tmpdir(), "cet-dub-"));
  const inputPath = join(dir, `input${ext}`);
  const srtPath = join(dir, "en.srt");
  const outPath = join(dir, "dubbed.mp4");
  const startedAt = Date.now();

  let engine: TtsEngine | null = null;
  try {
    await writeFile(inputPath, video);

    // 1. 逐句合成。同一连接串行合成；单句失败就重建连接再试，仍失败才报错。
    const segFiles = cleaned.map((_, i) => join(dir, `seg_${i}.mp3`));
    for (let i = 0; i < cleaned.length; i += 1) {
      if (Date.now() - startedAt > SYNTH_BUDGET_MS) {
        throw new Error("配音合成超时，请减少字幕条数或换更短的视频");
      }
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          engine ??= await makeEngine(voice);
          await synthOne(engine, cleaned[i], segFiles[i]);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          try {
            engine?.close();
          } catch {
            /* 已关闭 */
          }
          engine = null;
        }
      }
      if (lastError) {
        const reason = lastError instanceof Error ? lastError.message : "未知错误";
        throw new Error(`第 ${i + 1} 句语音合成失败：${reason}`);
      }
    }

    // 2. 真实时长 → 时间码 → SRT（字幕跟着配音走）
    const speech = await measureAll(bin, segFiles);
    const timing = buildTiming(cleaned, speech, Math.round(durationSec * 1000));

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

    // 3. adelay 定位每句，amix 合成英文音轨；同时烧字幕
    const args: string[] = ["-hide_banner", "-loglevel", "error", "-i", inputPath];
    timing.forEach((t) => args.push("-i", join(dir, `seg_${t.index}.mp3`)));

    const audioLabels = timing
      .map((t, i) => {
        const tempo = t.tempo > 1.001 ? `atempo=${t.tempo.toFixed(3)},` : "";
        return `[${i + 1}:a]${tempo}aresample=48000,adelay=${t.start_ms}|${t.start_ms}[a${i}]`;
      })
      .join(";");
    const mixInputs = timing.map((_, i) => `[a${i}]`).join("");
    const filter = [
      audioLabels,
      `${mixInputs}amix=inputs=${timing.length}:duration=longest:normalize=0[enaudio]`,
      `[0:v]subtitles=en.srt:force_style='${style}'[v]`,
    ].join(";");

    const encode = [
      ...videoEncodeArgs(pick, "22"),
      ...audioEncodeArgs(pick),
      "-t", String(durationSec),
      "-movflags", "+faststart",
      "-y", outPath,
    ];

    try {
      await execFileAsync(bin, [...args, "-filter_complex", filter, "-map", "[v]", "-map", "[enaudio]", ...encode], {
        cwd: dir,
        timeout: 600_000,
      });
    } catch (first) {
      /*
       * 有些精简版 ffmpeg 没编 libass（subtitles 滤镜缺失），画面烧不了字幕。
       * 这时不该整条配音作废：换成 mov_text 软字幕轨 + 英文音轨，片子和声音仍然可用，
       * 用户在播放器里能开关字幕。仍失败才把原始错误抛上去。
       */
      console.warn(
        "[video-dub] 烧字幕失败，改走软字幕：",
        first instanceof Error ? first.message.slice(-200) : first,
      );
      const softFilter = [
        audioLabels,
        `${mixInputs}amix=inputs=${timing.length}:duration=longest:normalize=0[enaudio]`,
      ].join(";");
      await execFileAsync(
        bin,
        [
          "-hide_banner", "-loglevel", "error",
          ...args,
          "-i", srtPath,
          "-filter_complex", softFilter,
          "-map", "0:v:0", "-map", "[enaudio]", "-map", `${timing.length + 1}:0`,
          "-metadata:s:s:0", "language=eng",
          "-c:s", "mov_text",
          ...encode,
        ],
        { cwd: dir, timeout: 600_000 },
      );
    }

    return { buffer: await readFile(outPath), mode: "dub" };
  } finally {
    try {
      engine?.close();
    } catch {
      /* 已关闭 */
    }
    await rm(dir, { recursive: true, force: true });
  }
}
