import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import {
  audioCachePath,
  cachedAudio,
  ensureCacheDir,
  loadListeningTarget,
  splitForTts,
  ttsVoice,
} from "@/lib/listening-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** 合成一段两分钟音频通常 1～3 秒，给足余量 */
export const maxDuration = 60;

/**
 * GET /api/listening/audio?paper=<id>&p=<段落序号>
 *
 * 返回 audio/mpeg。已合成过的段落直接读磁盘（支持 Range，可拖进度条），
 * 没合成过的边合成边下发，首字节通常在 1 秒内到达。
 *
 * 失败时返回 JSON 与 503，前端据此降级到浏览器朗读（Chrome/Edge 可用），
 * 而不是给用户一个永远转圈的播放器。
 */
function mp3Response(stream: ReadableStream<Uint8Array>, cacheable: boolean) {
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      // 首次合成是流式的不定长；已被 CDN 缓存的走下面静态分支
      "cache-control": cacheable ? "public, max-age=604800, immutable" : "no-store",
      "x-audio-voice": ttsVoice,
    },
  });
}

function serveLocal(req: NextRequest, file: string) {
  const stat = fs.statSync(file);
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start >= stat.size) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${stat.size}` } });
      }
      const safeEnd = Math.min(end, stat.size - 1);
      const stream = fs.createReadStream(file, { start, end: safeEnd });
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(safeEnd - start + 1),
          "content-range": `bytes ${start}-${safeEnd}/${stat.size}`,
          "accept-ranges": "bytes",
          "cache-control": "public, max-age=604800, immutable",
        },
      });
    }
  }

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

export async function GET(req: NextRequest) {
  const paperId = req.nextUrl.searchParams.get("paper")?.trim();
  const index = Number(req.nextUrl.searchParams.get("p") ?? "0");
  if (!paperId || !Number.isInteger(index) || index < 0 || index > 20) {
    return Response.json({ error: "参数不对" }, { status: 400 });
  }

  const target = await loadListeningTarget(paperId, index);
  if (!target) return Response.json({ error: "没有这段听力" }, { status: 404 });

  const file = audioCachePath(target.text);
  const hit = cachedAudio(file);
  if (hit) return serveLocal(req, hit);

  if (process.env.CET_TTS_DISABLED === "1") {
    return Response.json({ error: "服务端合成已关闭" }, { status: 503 });
  }

  // 边合成边下发：先把分片合成结果收集到临时文件，完整后 rename 成正式缓存
  ensureCacheDir();
  const tmpFile = `${file}.${process.pid}.${Date.now()}.part`;
  const sink = fs.createWriteStream(tmpFile);

  /*
   * 动态加载合成库：这个包依赖 ws，装不上或版本不匹配时，
   * 静态 import 会让整个路由（甚至构建）直接挂掉。
   * 动态引一次、失败就 503，至少保住站点的其他部分。
   */
  let tts: import("msedge-tts").MsEdgeTTS;
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    tts = new MsEdgeTTS();
    await tts.setMetadata(ttsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      voiceLocale: "en-US",
    });
  } catch (error) {
    sink.destroy();
    fs.rm(tmpFile, { force: true }, () => {});
    console.warn("[listening-audio] 语音合成不可用：", error instanceof Error ? error.message : error);
    return Response.json({ error: "合成语音不可用" }, { status: 503 });
  }

  let closed = false;

  const chunks = splitForTts(target.text);
  let producer: Readable | null = null;

  const fail = () => {
    if (closed) return;
    closed = true;
    try {
      tts.close();
    } catch {
      /* 已经关了 */
    }
  };

  // 串行合成各分片，拼成一条流
  async function* produce() {
    try {
      for (const chunk of chunks) {
        const { audioStream } = tts.toStream(chunk);
        producer = audioStream;
        for await (const data of audioStream) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
          sink.write(buf);
          yield new Uint8Array(buf);
        }
      }
      sink.end();
      await new Promise<void>((resolve) => {
        sink.on("finish", () => resolve());
        sink.on("error", () => resolve());
      });
      fs.rename(tmpFile, file, () => {});
    } catch {
      sink.destroy();
      fs.rm(tmpFile, { force: true }, () => {});
      throw new Error("tts_failed");
    } finally {
      fail();
    }
  }

  const iterator = produce();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        controller.error(new Error("tts_failed"));
      }
    },
    cancel() {
      producer?.destroy();
      fail();
    },
  });

  return mp3Response(stream, false);
}
