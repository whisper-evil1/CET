#!/usr/bin/env python3
"""
[已弃用] 旧的 Python 配音脚本 —— 线上不再调用。

英文配音已改为服务端 Node 直连 msedge-tts（见 src/lib/video-dub.ts），
原因：线上容器只装了 Node，没有 pip 的 edge-tts，调用本脚本必定
ModuleNotFoundError: No module named 'edge_tts'，「英文配音成片」100% 失败。
本文件仅作为离线调试备用，保留以备排查音色/时间码问题，不再被任何代码引用。

英文字幕逐句配音 + 精确时间码生成。

输入（命令行参数）：
  1) lines_json  —— JSON 字符串数组，每条一句英文字幕
  2) out_dir     —— 输出目录（绝对路径）
  3) voice       —— edge-tts 音色名，默认 en-US-AriaNeural
  4) duration_ms —— 视频总时长（毫秒），用于把配音铺满整条视频

输出：
  - seg_0.mp3, seg_1.mp3 ... 逐句语音
  - timing.json —— [{index, text, start_ms, dur_ms, speech_ms}, ...]

时间码策略：把 N 句均匀分布在视频时长上，每句在自己的窗口里居中播放。
这样配音和字幕对齐，画面保持原速；窗口比语音长时自然留出停顿。
"""
import asyncio
import json
import os
import sys

import edge_tts


def parse_args():
    lines = json.loads(sys.argv[1])
    out_dir = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else "en-US-AriaNeural"
    duration_ms = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    return lines, out_dir, voice, duration_ms


async def synth_one(text, path, voice):
    """合成一句，返回该句语音里最后一句话的持续时长（微秒）。"""
    comm = edge_tts.Communicate(text, voice, boundary="SentenceBoundary")
    total = 0
    with open(path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] in ("SentenceBoundary", "WordBoundary"):
                total = max(total, chunk["offset"] + chunk["duration"])
    return total


async def main():
    lines, out_dir, voice, duration_ms = parse_args()
    os.makedirs(out_dir, exist_ok=True)

    speech = []
    for i, text in enumerate(lines):
        path = os.path.join(out_dir, f"seg_{i}.mp3")
        ticks = await synth_one(text, path, voice)
        # edge-tts 的 offset/duration 单位是 100ns（tick），1 毫秒 = 10000 tick
        speech.append(ticks / 10000.0)

    # 若给了视频时长，按「语音时长比例」把句子铺满整条视频：
    # 长句分到更长窗口，停顿按各句长度成比例分配，比均分自然。
    # 若语音总长已超过视频时长，则压缩间隔到最小，不切掉句子。
    n = len(lines)
    total_speech = sum(speech)
    timing = []
    cursor = 0.0
    if duration_ms > 0 and n > 0 and total_speech < duration_ms:
        gap = (duration_ms - total_speech) / (n + 1)
        for i, text in enumerate(lines):
            ms = speech[i]
            start = gap * (i + 1) + sum(speech[:i])
            timing.append({
                "index": i, "text": text,
                "start_ms": round(start), "dur_ms": round(ms),
            })
    else:
        for i, text in enumerate(lines):
            ms = speech[i]
            timing.append({
                "index": i, "text": text,
                "start_ms": round(cursor), "dur_ms": round(ms),
            })
            cursor += ms

    with open(os.path.join(out_dir, "timing.json"), "w", encoding="utf-8") as f:
        json.dump(timing, f, ensure_ascii=False, indent=2)

    print("TTS_OK", n)


asyncio.run(main())
