import crypto from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { withApi } from "@/lib/api-helpers";
import {
  audioCacheDir,
  cachedAudio,
  ensureCacheDir,
  splitForTts,
  ttsVoice,
} from "@/lib/listening-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 故事音频通常 2～8 秒合成完，给足余量 */
export const maxDuration = 60;

/**
 * POST /api/tts —— 把任意文本合成一个 MP3（整篇故事一次性下发）。
 *
 * 为什么不用浏览器语音合成：
 *   speechSynthesis 在安卓锁屏/切后台时会被系统杀掉，「熄屏继续听」根本保不住。
 *   服务端合成真 MP3 + 前端 <audio> 播放，锁屏后系统媒体通道继续放，
 *   配合 Media Session 还能在锁屏界面控制播放。
 *
 * 请求：{ runs: [{ text, lang: "en" | "zh" }] }（1–80 段，交替朗读）
 * 返回：audio/mpeg。同一份 runs 只合成一次（磁盘缓存按内容哈希）。
 *
 * 朗读语速/插入停顿由前端 playbackRate 与片段切分负责，这里只管把字读对。
 */

const zhVoice = process.env.CET_TTS_ZH_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";

const runSchema = z.object({
  text: z.string().min(1).max(500),
  lang: z.enum(["en", "zh"]),
});

const bodySchema = z.object({
  runs: z.array(runSchema).min(1).max(80),
});

/** 同内容永远同一个缓存文件（把 runs 与两个音色一起哈希） */
function cacheFileFor(runs: z.infer<typeof bodySchema>["runs"]): string {
  const key = crypto
    .createHash("sha1")
    .update(`${ttsVoice}|${zhVoice}|${JSON.stringify(runs)}`)
    .digest("hex");
  return `${audioCacheDir()}/${key}.mp3`;
}

function serveFile(file: string): Response {
  const stat = fs.statSync(file);
  return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(stat.size),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=604800, immutable",
    },
  });
}

export const POST = withApi(async (request: Request) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ code: 400, message: "参数不对：需要 1–80 段文本", data: null }, { status: 400 });
  }

  const runs = parsed.data.runs;
  const totalChars = runs.reduce((sum, run) => sum + run.text.length, 0);
  if (totalChars > 8000) {
    return Response.json({ code: 400, message: "文本太长（超过 8000 字符）", data: null }, { status: 400 });
  }

  const file = cacheFileFor(runs);
  const hit = cachedAudio(file);
  if (hit) return serveFile(hit);

  if (process.env.CET_TTS_DISABLED === "1") {
    return Response.json({ code: 503, message: "服务端合成已关闭", data: null }, { status: 503 });
  }

  /*
   * 动态加载合成库：这个包依赖 ws，装不上或版本不匹配时，
   * 静态 import 会让整个路由（甚至构建）直接挂掉。
   */
  type Tts = import("msedge-tts").MsEdgeTTS;
  let MsEdgeTTS: typeof import("msedge-tts").MsEdgeTTS;
  let OUTPUT_FORMAT: typeof import("msedge-tts").OUTPUT_FORMAT;
  try {
    const mod = await import("msedge-tts");
    MsEdgeTTS = mod.MsEdgeTTS;
    OUTPUT_FORMAT = mod.OUTPUT_FORMAT;
  } catch (error) {
    console.warn("[tts] 语音合成不可用：", error instanceof Error ? error.message : error);
    return Response.json({ code: 503, message: "合成语音不可用", data: null }, { status: 503 });
  }

  ensureCacheDir();
  const tmpFile = `${file}.${process.pid}.${Date.now()}.part`;
  const sink = fs.createWriteStream(tmpFile);

  /** 每种语言一个合成实例：en 故事正文 / zh 释义，各自音色 */
  const engines = new Map<string, Tts>();
  const engineFor = async (lang: "en" | "zh"): Promise<Tts> => {
    const cached = engines.get(lang);
    if (cached) return cached;
    const engine = new MsEdgeTTS();
    await engine.setMetadata(
      lang === "zh" ? zhVoice : ttsVoice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3,
      { voiceLocale: lang === "zh" ? "zh-CN" : "en-US" },
    );
    engines.set(lang, engine);
    return engine;
  };

  try {
    for (const run of runs) {
      const engine = await engineFor(run.lang);
      for (const chunk of splitForTts(run.text)) {
        const { audioStream } = engine.toStream(chunk);
        for await (const data of audioStream) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
          sink.write(buf);
        }
      }
    }
    sink.end();
    await new Promise<void>((resolve) => {
      sink.on("finish", () => resolve());
      sink.on("error", () => resolve());
    });
    for (const engine of engines.values()) {
      try {
        engine.close();
      } catch {
        /* 已关了 */
      }
    }
    if (cachedAudio(tmpFile)) {
      // 必须先等 rename 落盘再 stat，否则并发/慢盘下会 stat 不到目标文件而报 ENOENT
      await new Promise<void>((resolve) => {
        fs.rename(tmpFile, file, () => resolve());
      });
      const done = cachedAudio(file);
      if (done) return serveFile(done);
      // rename 没成功但临时文件是完整音频：直接用临时文件回，缓存下次再补
      const tmp = cachedAudio(tmpFile);
      if (tmp) return serveFile(tmp);
      return Response.json({ code: 503, message: "合成失败", data: null }, { status: 503 });
    }
    fs.rm(tmpFile, { force: true }, () => {});
    return Response.json({ code: 503, message: "合成失败", data: null }, { status: 503 });
  } catch (error) {
    sink.destroy();
    fs.rm(tmpFile, { force: true }, () => {});
    for (const engine of engines.values()) {
      try {
        engine.close();
      } catch {
        /* 忽略 */
      }
    }
    console.warn("[tts] 合成出错：", error instanceof Error ? error.message : error);
    return Response.json({ code: 503, message: "合成失败", data: null }, { status: 503 });
  }
});
