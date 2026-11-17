import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prisma } from "./prisma";

/**
 * 听力音频（服务端）。
 *
 * 为什么不再用浏览器语音合成：
 *   Web Speech 名为标准，实为「各浏览器自己看着办」——
 *   Firefox 在多数系统上 getVoices() 返回空数组，Safari 要求每句都绑用户手势，
 *   微信内置浏览器直接没有这个接口。于是同一套页面在 Chrome 能听、换个浏览器就哑了。
 *
 * 现在改成服务端预合成真 MP3：接口返回 audio/mpeg，前端一个 <audio> 元素播放，
 * 所有浏览器（含 iOS Safari、微信、Firefox）表现一致，可拖动进度、可缓存、可 Range。
 *
 * 音频从哪来：
 *   用神经网络语音合成把**真题原文**读出来，不是考场录音（考场录音有版权，不能内置）。
 *   播放器下方照实写明这一点，不冒充官方音频。
 *
 * 存储策略：
 *   文本 → sha1 作缓存键，合成结果落在 $CET_AUDIO_DIR（默认 ~/.cet-audio）。
 *   首次播放边合成边下发（几十秒音频通常 1 秒内就能起播），完整文件落盘后，
 *   后面的播放/拖动进度条直接读本地文件，不再依赖外网。
 */

const VOICE = process.env.CET_TTS_VOICE?.trim() || "en-US-AriaNeural";
/** 单段文本上限，超长会拆成多段依次合成，避免单次请求体过大 */
const MAX_CHARS_PER_CHUNK = 2400;

export type ListeningTarget = {
  paperId: string;
  index: number;
  title: string | null;
  /** 合成用的完整文本：句间留停顿，说话人标签已剥掉 */
  text: string;
};

/**
 * 每段听力的合成文本。
 *
 * 直接拼句子有两个坑：
 *   1. 对话行带 "W:" / "M:" 标签，念出来是「W 冒号」；
 *   2. 有些句子结尾没有标点，连读会把两句黏成一句、语气也乱。
 * 所以剥标签 + 逐句补句号，句子之间多留一个空格当停顿。
 */
export function buildSpeechText(sentences: string[]): string {
  return sentences
    .map((raw) =>
      raw
        .replace(/^\s*(?:W|M|Man|Woman|Narrator|Interviewer|Speaker)\s*[:：]\s*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .map((s) => (/[.!?…"'”)]$/.test(s) ? s : `${s}.`))
    .join("  ");
}

/** 取某套卷某一段听力的合成文本；段落不存在返回 null */
export async function loadListeningTarget(
  paperId: string,
  index: number,
): Promise<ListeningTarget | null> {
  const section = await prisma.section.findFirst({
    where: { paperId, type: "listening" },
    include: { passages: { orderBy: { order: "asc" } } },
  });
  if (!section) return null;

  const passage = section.passages[index];
  if (!passage?.transcript) return null;

  let lines: Array<{ text?: string }> = [];
  try {
    const parsed = JSON.parse(passage.transcript);
    if (Array.isArray(parsed)) lines = parsed;
  } catch {
    return null;
  }

  const text = buildSpeechText(lines.map((l) => String(l?.text ?? "")));
  if (!text) return null;

  return { paperId, index, title: passage.title, text };
}

/** 缓存目录：与运行时库同处一个持久目录，跨发布保留 */
export function audioCacheDir(): string {
  const custom = process.env.CET_AUDIO_DIR?.trim();
  if (custom) return custom;
  return path.join(os.homedir(), ".cet-audio");
}

/** 文本 → 缓存文件路径（同一段文本永远同一个文件） */
export function audioCachePath(text: string): string {
  const key = crypto.createHash("sha1").update(`${VOICE}|${text}`).digest("hex");
  return path.join(audioCacheDir(), `${key}.mp3`);
}

export function ensureCacheDir() {
  fs.mkdirSync(audioCacheDir(), { recursive: true });
}

/** 完整缓存：文件存在且非空 */
export function cachedAudio(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    if (stat.isFile() && stat.size > 1024) return file;
  } catch {
    /* 不存在 */
  }
  return null;
}

/** 合成拆段：按句子边界切成不超过 MAX_CHARS_PER_CHUNK 的若干段 */
export function splitForTts(text: string): string[] {
  if (text.length <= MAX_CHARS_PER_CHUNK) return [text];
  const parts: string[] = [];
  let buf = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (buf.length + sentence.length + 1 > MAX_CHARS_PER_CHUNK && buf) {
      parts.push(buf.trim());
      buf = "";
    }
    buf += `${sentence} `;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export const ttsVoice = VOICE;
