"use client";

/**
 * 听力播放器内核（浏览器侧）。
 *
 * 关键点：**音频元素不挂在 React 树里**。
 *
 * 以前播放状态由组件持有，切题、切栏、换段落都会让组件卸载，
 * 卸载时的 cleanup 就顺手把音频停了 —— 用户看到的是「一翻到题目，声音就没了」。
 * 现在 <audio> 是模块级单例，挂在 document 上，React 只读它的状态、只调用它的方法。
 * 这样切题、切栏、翻段都不会把声音掐断。
 *
 * 但「不掐断」只适用于仍在听力板块内（左栏播放器 ↔ 右栏题目）。一旦切到阅读、
 * 写作等其他板块，声音必须停 —— 人已经在做别的题，耳机里还在念听力原文，
 * 这是干扰，不是功能。所以对外只留两个动作：
 *   pauseForLeaving()      离开听力板块：暂停，保住进度
 *   resumeAfterReturn(key) 回到听力板块：若刚才就是被切走才停的，接着放
 * 注意区分「用户自己按的暂停」：那种情况切回来不该擅自出声，所以用旗标记来源。
 */

export type AudioState = {
  /** 当前承载的段落键，形如 "cet4-2025-12-s1#0" */
  key: string | null;
  playing: boolean;
  loading: boolean;
  /** 是否已经可以拖动（有 duration） */
  ready: boolean;
  time: number;
  duration: number;
  rate: number;
  error: string | null;
};

const INITIAL: AudioState = {
  key: null,
  playing: false,
  loading: false,
  ready: false,
  time: 0,
  duration: 0,
  rate: 1,
  error: null,
};

let state: AudioState = INITIAL;
const listeners = new Set<() => void>();
let el: HTMLAudioElement | null = null;

/**
 * 这一次暂停是不是「离开听力板块」造成的。
 *
 * 存在的意义是区分声音的两种停法：
 *   - 用户自己按了暂停 → 切回来时不该擅自出声；
 *   - 因为切去做别的题而停 → 切回来要接着放。
 * 只看 playing 分不出来，所以必须记一笔来源。
 */
let pausedForLeaving = false;

function emit(patch: Partial<AudioState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

function element(): HTMLAudioElement {
  if (el) return el;
  const audio = document.createElement("audio");
  audio.preload = "auto";
  // 加个标记：页面里可能还有别的 <audio>（词卡发音等），
  // 排查和自动化验收时得能一眼认出院里这个单例是哪只。
  audio.dataset.cetAudio = "listening";
  // 播放速度变化不改音高，否则 1.25× 的男声会变成卡通音
  audio.preservesPitch = true;
  audio.setAttribute("playsinline", "");

  audio.addEventListener("playing", () => emit({ playing: true, loading: false, error: null }));
  audio.addEventListener("play", () => emit({ playing: true, loading: false }));
  audio.addEventListener("pause", () => emit({ playing: false }));
  audio.addEventListener("waiting", () => emit({ loading: true }));
  audio.addEventListener("canplay", () => emit({ loading: false, ready: true, duration: audio.duration || state.duration }));
  audio.addEventListener("loadedmetadata", () =>
    emit({ ready: true, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }),
  );
  audio.addEventListener("timeupdate", () => emit({ time: audio.currentTime }));
  audio.addEventListener("ended", () => emit({ playing: false, time: audio.duration || state.time }));
  audio.addEventListener("error", () => {
    // 网络断了、合成服务挂了都会走到这里；把状态交给界面，由它给「重试 / 本机朗读」两个出口
    emit({
      playing: false,
      loading: false,
      error: "音频加载失败，网络恢复后点重试即可（已合成的段落不会重复消耗）。",
    });
  });

  document.body.appendChild(audio);
  el = audio;
  return audio;
}

export function subscribeAudio(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getAudioState = () => state;

export function audioSrc(key: string) {
  const [paper, index] = key.split("#");
  return `/api/listening/audio?paper=${encodeURIComponent(paper)}&p=${encodeURIComponent(index ?? "0")}`;
}

/** 载入某一段并播放；同一段重复调用只是继续播，不会从头开始 */
export function loadAndPlay(key: string) {
  const audio = element();
  if (state.key !== key) {
    emit({ key, time: 0, duration: 0, ready: false, error: null, loading: true });
    audio.src = audioSrc(key);
    audio.load();
  }
  audio.playbackRate = state.rate;
  void audio.play().catch(() => {
    /*
     * 自动播放被浏览器拦下（iOS/Safari 常见）不是错误，只是需要一次用户手势。
     * 这里不能标红，否则用户会以为坏了；按钮会停在「▶」等他点。
     */
    emit({ playing: false, loading: false });
  });
}

/**
 * 换段时跟随。
 *
 * 只有「同一套卷内的段落切换」才自动跟：用户已经听过这段，翻到下一段就该接着听；
 * 换到别的卷、或者还没开始听，都不该突然出声。
 * 跟随会保留播放/暂停状态 —— 用户主动暂停了，翻段也只换音频不自动播。
 */
export function followPassage(key: string) {
  const audio = element();
  if (state.key === key) return;

  const samePaper = state.key !== null && state.key.split("#")[0] === key.split("#")[0];
  if (!samePaper) return;

  const wasPlaying = state.playing;
  emit({ key, time: 0, duration: 0, ready: false, error: null, loading: wasPlaying });
  audio.src = audioSrc(key);
  audio.load();
  if (wasPlaying) void audio.play().catch(() => emit({ playing: false, loading: false }));
}

export function toggle(key: string) {
  const audio = element();
  if (state.key !== key) {
    loadAndPlay(key);
    return;
  }
  if (audio.paused) {
    void audio.play().catch(() => emit({ playing: false }));
  } else {
    audio.pause();
  }
}

export function seek(seconds: number) {
  const audio = element();
  if (!Number.isFinite(seconds)) return;
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  emit({ time: audio.currentTime });
}

export function setRate(rate: number) {
  const audio = element();
  audio.playbackRate = rate;
  emit({ rate });
}

/**
 * 跳到某一段的指定秒数并播放 —— 听力原文「点哪句听哪句」用这个。
 *
 * 不能直接 seek()：原文列表可能指向**还没载入的那一段**（用户展开原文时
 * 音频还停在别的段），此时 audio 的 src 还是旧段的，直接设 currentTime
 * 会定位到旧音频上，随后换 src 又把位置清成 0，表现是「点了没反应」。
 * 所以换段时先换源，等 loadedmetadata 再定位 —— 那时候 duration 已经就绪，
 * 浏览器也不会再把 currentTime 冲掉。
 */
export function playAt(key: string, seconds: number) {
  const audio = element();
  const target = Math.max(0, seconds);

  if (state.key !== key) {
    pausedForLeaving = false;
    emit({ key, time: target, duration: 0, ready: false, error: null, loading: true });
    const onceReady = () => {
      audio.removeEventListener("loadedmetadata", onceReady);
      audio.currentTime = target;
      void audio.play().catch(() => {
        /* 自动播放被拦：停在目标位置等用户按播放，不算错误 */
        emit({ playing: false, loading: false });
      });
    };
    audio.addEventListener("loadedmetadata", onceReady);
    audio.src = audioSrc(key);
    audio.load();
    return;
  }

  audio.currentTime = Math.min(target, audio.duration || target);
  emit({ time: audio.currentTime });
  void audio.play().catch(() => emit({ playing: false }));
}

export function restart(key: string) {
  const audio = element();
  if (state.key !== key) {
    loadAndPlay(key);
    return;
  }
  audio.currentTime = 0;
  void audio.play().catch(() => emit({ playing: false }));
}

export function retry(key: string) {
  const audio = element();
  audio.src = `${audioSrc(key)}&r=${Date.now()}`;
  emit({ error: null, loading: true, time: 0, duration: 0 });
  audio.load();
  void audio.play().catch(() => emit({ playing: false, loading: false }));
}

/** 主动停（只有用户明确点「停止」或离开练习页才调用） */
export function stopAudio() {
  const audio = element();
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  pausedForLeaving = false;
  emit({ ...INITIAL });
}

/** 离开听力板块：暂停并保住进度。本来就没在播就什么都不做（别改掉用户手动的暂停状态）。 */
export function pauseForLeaving() {
  const audio = element();
  // 看元素真实状态而不是 state.playing：刚点播放时 play() 是异步的，
  // 状态还没来得及翻成 playing 就被切走的话，只看状态会漏停。
  if (audio.paused) return;
  pausedForLeaving = true;
  audio.pause();
}

/**
 * 回到听力板块：接着放。
 *
 * 只认「刚才被切走才停的」这一种，且必须是同一段 ——
 * 换到另一套卷的听力不该突然出声，那是另一段录音。
 */
export function resumeAfterReturn(key: string) {
  if (!pausedForLeaving) return;
  pausedForLeaving = false;
  if (state.key !== key) return;
  void element()
    .play()
    .catch(() => emit({ playing: false }));
}

export function isPlayingKey(key: string) {
  return state.key === key && state.playing;
}

export const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
