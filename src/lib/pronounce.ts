/**
 * 单词 / 句子发音。
 *
 * 为什么不能只依赖 Web Speech API：
 * 在不少安卓内置浏览器里（百度、迅雷、部分厂商 WebView），要么根本没有
 * speechSynthesis 对象，要么对象在但没有可用的语音引擎 —— 调 speak() 既不抛错也不出声，
 * 用户看到的现象就是「点了播放没反应」。原实现遇到这种情况直接 return，连提示都没有。
 *
 * 所以顺序反过来：
 *   1. 先播音频文件（只要内核能播 <audio> 就能响，与语音引擎无关）
 *   2. 音频取不到，再退回 speechSynthesis
 *   3. 两边都不行，返回 failed，由调用方给出可见提示
 */

export type SpeakChannel = "audio" | "tts" | "failed";

/** 口音：美式 / 英式，只影响有道音源，备源与语音合成都按美式走 */
export type Accent = "us" | "uk";

/** 单个音频源的最长等待；超时视为该源失败，换下一个 */
const SOURCE_TIMEOUT_MS = 6000;
/** 语音合成的兜底超时（极少数内核 onend 不触发） */
const TTS_TIMEOUT_MS = 15000;

let currentAudio: HTMLAudioElement | null = null;

/** 打断当前正在播放的内容（切词、关闭浮层、开始下一句时调用） */
export function stopSpeaking(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      /* 某些内核在 src 清空时抛错，忽略即可 */
    }
    currentAudio = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 同上 */
    }
  }
}

/** 候选音频源，按可用性排序。都不是自家服务，任一失效会自动换下一个 */
function audioSources(text: string, lang: "en" | "zh", accent: Accent = "us"): string[] {
  const t = encodeURIComponent(text);
  if (lang === "zh") {
    return [`https://fanyi.baidu.com/gettts?lan=zh&text=${t}&spd=5&source=web`];
  }
  // 有道 type=1 美式、type=2 英式
  const youdaoType = accent === "us" ? 1 : 2;
  return [
    // 有道词典发音：单词音频，响应快、覆盖全
    `https://dict.youdao.com/dictvoice?audio=${t}&type=${youdaoType}`,
    // 百度翻译 TTS：备源
    `https://fanyi.baidu.com/gettts?lan=en&text=${t}&spd=3&source=web`,
  ];
}

/**
 * 播一个音频 URL，播完 resolve true；加载失败 / 播放被拒 / 超时 resolve false。
 * 不用 onended 之外的事件判定成功，避免把「刚开始播」当成「播完了」。
 */
function playAudioUrl(url: string, rate: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const audio = new Audio();

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        currentAudio = audio;
        currentAudio.onended = () => {
          if (currentAudio === audio) currentAudio = null;
        };
      } else {
        try {
          audio.pause();
        } catch {
          /* 忽略 */
        }
      }
      resolve(ok);
    };

    // 卡在 readyState=0 时既不 error 也不 ended，必须有兜底
    const timer = setTimeout(() => finish(false), SOURCE_TIMEOUT_MS);

    audio.preload = "auto";
    audio.playbackRate = rate;
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);

    try {
      audio.src = url;
      const played = audio.play();
      // 自动播放被拒绝（非用户手势场景）也走失败分支，交回给调用方
      if (played && typeof played.then === "function") {
        played.catch(() => finish(false));
      }
    } catch {
      finish(false);
    }
  });
}

/** 用语音合成朗读，resolve 表示是否真的念完了 */
function speakViaTts(text: string, lang: "en" | "zh", rate: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve(false);
      return;
    }
    const synth = window.speechSynthesis;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), TTS_TIMEOUT_MS);

    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === "zh" ? "zh-CN" : "en-US";
      utter.rate = rate;
      utter.onend = () => finish(true);
      utter.onerror = () => finish(false);
      synth.speak(utter);
    } catch {
      finish(false);
    }
  });
}

/**
 * 朗读一段文本，播完（或失败）后 resolve。
 *
 * @param text 要读的内容
 * @param lang en 读英文、zh 读中文
 * @param rate 语速，1 为正常
 * @param accent 口音，仅英文有道音源生效
 */
export async function speakText(
  text: string,
  lang: "en" | "zh" = "en",
  rate = 1,
  accent: Accent = "us",
): Promise<SpeakChannel> {
  const content = text.trim();
  if (!content) return "failed";

  stopSpeaking();

  for (const url of audioSources(content, lang, accent)) {
    if (await playAudioUrl(url, rate)) return "audio";
  }

  if (await speakViaTts(content, lang, rate)) return "tts";

  return "failed";
}

/** 当前环境是否具备任何一种发声能力（用于按钮文案与降级提示） */
export function canPronounce(): boolean {
  if (typeof window === "undefined") return false;
  const hasAudio = typeof window.Audio === "function";
  const hasTts = "speechSynthesis" in window;
  return hasAudio || hasTts;
}
