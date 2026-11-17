"use client";

/**
 * 语音朗读引擎（做题与闯关共用一套）。
 *
 * 为什么不用音频文件：
 *   四六级真题录音受版权保护，官方只在授权站点以「仅供个人学习」分发，
 *   打包进公开站点属于传播；而每套 25 题全配 mp3 又会让包体膨胀几十 MB。
 *   这里用系统语音合成现场朗读听力原文：零文件、零版权风险、任何一套卷都能立即出声。
 *
 * 为什么按「行」而不是整段朗读：
 *   speechSynthesis 没有可靠的回调告诉我们读到第几个词，只能一句一个 utterance 串起来，
 *   这样才能做到逐句高亮、随时暂停、从某一句重播，也能在句间留出停顿，
 *   听感更接近考试录音的节奏，而不是一口气念完。
 *
 * v3 修的是「只读出第一句就停」：
 *   1. Chrome 里 `cancel()` 之后立刻 `speak()` 会把新 utterance 吞掉 —— 先 cancel，隔一拍再开口；
 *   2. `onend` 偶尔不触发（长句、切标签、系统语音引擎忙），只靠它串下一句就会停在第一句 ——
 *      每句都挂一个「按字数估算」的兜底计时器，到点没收到 onend 也继续往下读；
 *   3. Chrome 连续朗读约 15 秒会自己 pause —— 一个心跳定时器发现 `synth.paused`
 *      且用户没按暂停，就自动 resume；
 *   4. `synth.speaking` 变 false 但队列没读完，视为「哑火」，直接推进到下一句。
 *
 * 这三道保险都不改变外部接口：组件仍然只管 play / pause / resume / stop / setRate。
 */

export type SpeechLine = { id: number; text: string; start?: number; end?: number };

type Snapshot = {
  supported: boolean;
  /** 正在朗读的段落 id；null 表示没在播 */
  passageId: string | null;
  playing: boolean;
  paused: boolean;
  /** 当前读到第几句（0 基） */
  lineIndex: number;
  rate: number;
  /** 这一轮已经读过几句，用于进度条 */
  doneLines: number;
  totalLines: number;
  error: string | null;
};

const initial: Snapshot = {
  supported: false,
  passageId: null,
  playing: false,
  paused: false,
  lineIndex: -1,
  rate: 1,
  doneLines: 0,
  totalLines: 0,
  error: null,
};

let snapshot: Snapshot = { ...initial };
const listeners = new Set<() => void>();

function emit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  return snapshot;
}

const canSpeak = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** 优先选英式/美式女声；不同系统名字差别很大，按常见名字排序而不是硬编码一个 */
const VOICE_HINTS = [
  "Google UK English Female",
  "Google US English",
  "Microsoft Aria",
  "Microsoft Jenny",
  "Samantha",
  "Daniel",
  "Karen",
  "Moira",
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const hint of VOICE_HINTS) {
    const hit = voices.find((v) => v.name.toLowerCase().includes(hint.toLowerCase()));
    if (hit) return hit;
  }
  return voices.find((v) => /^en[-_]/i.test(v.lang)) ?? null;
}

/* ---------------- 播放队列状态 ---------------- */

let currentLines: SpeechLine[] = [];
let talkToken = 0;
let cursor = -1;
/** 句间停顿：考试录音在新闻/对话之间有换气口 */
const GAP_MS = 110;
let gapTimer: number | null = null;
let guardTimer: number | null = null;
let heartbeat: number | null = null;

function clearTimers() {
  if (gapTimer !== null) {
    window.clearTimeout(gapTimer);
    gapTimer = null;
  }
  if (guardTimer !== null) {
    window.clearTimeout(guardTimer);
    guardTimer = null;
  }
  if (heartbeat !== null) {
    window.clearInterval(heartbeat);
    heartbeat = null;
  }
}

/**
 * 真题原文的对话行带说话人标签（"W: …" / "M: …"），照读会念成「W 冒号」。
 * 朗读前剥掉标签，只读台词；页面上的文字仍保留标签，方便看谁在说。
 */
function stripSpeaker(text: string) {
  return text.replace(/^\s*(?:W|M|Man|Woman|Narrator)\s*[:：]\s*/i, "").trim();
}

/** 按字数估一句要读多久：英文约 2.6 词/秒，留 2.5 秒余量 */
function estimateMs(text: string, rate: number) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2500, (words / (2.6 * rate)) * 1000 + 2500);
}

function finishQueue() {
  clearTimers();
  emit({ playing: false, paused: false, lineIndex: -1, doneLines: currentLines.length });
}

/** 排下一句：先留换气口，再开口 */
function scheduleNext(nextIndex: number, token = talkToken, delay = GAP_MS) {
  if (gapTimer !== null) window.clearTimeout(gapTimer);
  gapTimer = window.setTimeout(() => {
    gapTimer = null;
    if (token !== talkToken) return;
    speakLine(nextIndex, token);
  }, delay);
}

function speakLine(index: number, token: number) {
  if (token !== talkToken) return;
  if (index >= currentLines.length) {
    finishQueue();
    return;
  }

  const line = currentLines[index];
  const text = stripSpeaker((line?.text ?? "").replace(/\s+/g, " "));
  if (!text) {
    scheduleNext(index + 1, token, 0);
    return;
  }

  cursor = index;
  emit({ playing: true, paused: false, lineIndex: index, doneLines: index });

  const synth = window.speechSynthesis;
  const voice = pickVoice();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = voice?.lang ?? "en-US";
  if (voice) utter.voice = voice;
  utter.rate = snapshot.rate;
  utter.pitch = 1;

  let settled = false;
  const settle = (advance: boolean) => {
    if (settled || token !== talkToken) return;
    settled = true;
    if (guardTimer !== null) {
      window.clearTimeout(guardTimer);
      guardTimer = null;
    }
    if (!advance) return;
    emit({ doneLines: index + 1 });
    scheduleNext(index + 1, token);
  };

  utter.onstart = () => {
    if (token !== talkToken) return;
    emit({ playing: true, paused: false, lineIndex: index, doneLines: index });
  };
  utter.onend = () => settle(true);
  utter.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") {
      // stop()/换段造成的正常中断：不推进，也不算错误
      settled = true;
      return;
    }
    // 引擎报错也别把整段卡死：记一次提示，继续读下一句
    emit({ error: "浏览器朗读失败，可换 Chrome / Edge 再试" });
    settle(true);
  };

  // 兜底：onend 不触发时按估算时长强制推进，否则整段会停在第一句
  guardTimer = window.setTimeout(() => {
    guardTimer = null;
    if (token !== talkToken || settled) return;
    settled = true;
    try {
      synth.cancel();
    } catch {
      /* 忽略 */
    }
    emit({ doneLines: index + 1 });
    // cancel 之后需要让引擎喘一口气，否则下一句会被吞
    scheduleNext(index + 1, token, 180);
  }, estimateMs(text, snapshot.rate));

  try {
    synth.speak(utter);
  } catch {
    settled = true;
    emit({ error: "浏览器朗读失败，可换 Chrome / Edge 再试" });
    scheduleNext(index + 1, token, 180);
  }
}

/** 心跳：Chrome 连读约 15 秒会自己暂停；哑火（speaking=false 但队列没完）也要能自愈 */
function startHeartbeat(token: number) {
  if (heartbeat !== null) window.clearInterval(heartbeat);
  heartbeat = window.setInterval(() => {
    if (token !== talkToken) return;
    if (!snapshot.playing || snapshot.paused) return;
    const synth = window.speechSynthesis;
    if (synth.paused) {
      try {
        synth.resume();
      } catch {
        /* 忽略 */
      }
      return;
    }
    // 既没 speaking 也没 pending，而兜底计时器还在跑：说明这一句提前死了
    if (!synth.speaking && !synth.pending && guardTimer !== null) {
      window.clearTimeout(guardTimer);
      guardTimer = null;
      scheduleNext(cursor + 1, token, 220);
    }
  }, 3000);
}

export const speech = {
  init() {
    if (!canSpeak()) {
      emit({ supported: false });
      return;
    }
    emit({ supported: true });
    // 部分浏览器首次 getVoices() 为空，等 voiceschanged 再取一次
    window.speechSynthesis.onvoiceschanged = () => pickVoice();
  },

  play(passageId: string, lines: SpeechLine[], from = 0) {
    currentLines = lines.filter((l) => l.text?.trim());
    if (!currentLines.length) return;
    const start = Math.max(0, Math.min(from, currentLines.length - 1));
    clearTimers();
    const token = ++talkToken;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
    emit({
      supported: true,
      passageId,
      playing: true,
      paused: false,
      lineIndex: start,
      doneLines: start,
      totalLines: currentLines.length,
      error: null,
    });
    startHeartbeat(token);
    // cancel 之后隔一拍再开口：Chrome 在同一 tick 里 speak 会被吞掉
    scheduleNext(start, token, 90);
  },

  /** 从第几句重新开始（点原文某一句时用） */
  playFrom(index: number) {
    if (!currentLines.length) return;
    this.play(snapshot.passageId ?? "resume", currentLines, index);
  },

  pause() {
    if (!canSpeak() || !snapshot.playing) return;
    window.speechSynthesis.pause();
    emit({ paused: true });
  },

  resume() {
    if (!canSpeak()) return;
    // 部分内核 pause 后再 resume 不生效，重新排一次当前句更稳
    window.speechSynthesis.resume();
    emit({ paused: false });
  },

  stop() {
    if (!canSpeak()) return;
    talkToken += 1;
    cursor = -1;
    clearTimers();
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
    emit({ playing: false, paused: false, lineIndex: -1, passageId: null, doneLines: 0 });
  },

  setRate(rate: number) {
    const clamped = Math.min(1.4, Math.max(0.7, rate));
    const { passageId, lineIndex, playing } = snapshot;
    emit({ rate: clamped });
    if (!playing || !passageId) return;
    // 变速要重读当前句：SpeechSynthesisUtterance 的 rate 不能中途改
    const restart = Math.max(0, lineIndex);
    clearTimers();
    const token = ++talkToken;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
    startHeartbeat(token);
    scheduleNext(restart, token, 120);
  },
};
