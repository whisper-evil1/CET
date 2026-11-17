/**
 * 朗读队列的回归测试（不需要真浏览器）。
 *
 * 要证明的两件事，正是用户反馈的那个 bug：
 *   1. play() 之后**整段每一句**都会被念到，不是只念第一句就停；
 *   2. 系统引擎不触发 onend 时，兜底计时器仍会把队列推到底。
 *
 * 跑法：npx tsx scripts/test-speech-queue.ts
 */

type Utter = {
  text: string;
  lang: string;
  rate: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

const spoken: string[] = [];
let autoEnd = true;

class FakeUtterance implements Utter {
  text: string;
  lang = "";
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const synth = {
  paused: false,
  speaking: false,
  pending: false,
  onvoiceschanged: null as null | (() => void),
  getVoices: () => [{ name: "Google US English", lang: "en-US" }],
  cancel() {
    this.speaking = false;
    this.pending = false;
  },
  pause() {
    this.paused = true;
  },
  resume() {
    this.paused = false;
  },
  speak(utter: Utter) {
    spoken.push(utter.text);
    this.speaking = true;
    setTimeout(() => utter.onstart?.(), 0);
    if (!autoEnd) return;
    setTimeout(() => {
      this.speaking = false;
      utter.onend?.();
    }, 12);
  },
};

// 最小 window 垫片：speech.ts 只用到这几个成员
const fakeWindow = {
  speechSynthesis: synth,
  SpeechSynthesisUtterance: FakeUtterance,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;
(globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;


let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` —— ${detail}` : ""}`);
  if (!ok) failed += 1;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { speech, getSnapshot } = await import("../src/lib/speech");


const lines = [
  { id: 1, text: "A university library in the north of England has decided to keep its reading rooms open." },
  { id: 2, text: "The pilot scheme began three weeks ago and has attracted two thousand visits." },
  { id: 3, text: "Most of the night visitors are postgraduate students working on long projects." },
  { id: 4, text: "The university will review the cost of lighting, heating and security in January." },
  { id: 5, text: "Students have asked for one change: a small kitchen." },
];

spoken.length = 0;
autoEnd = true;
speech.init();
speech.play("p-all", lines, 0);
await wait(1000);

check(
  "整段五句全部念到（不是只念第一句）",
  spoken.length === lines.length,
  `实际 ${spoken.length} 句：${spoken.map((s) => s.slice(0, 12)).join(" / ")}`,
);
check(
  "顺序与原文一致",
  spoken.every((text, i) => text === lines[i]!.text),
  spoken.map((s, i) => `${i + 1}${s === lines[i]!.text ? "✓" : "✗"}`).join(" "),
);
check("读完自动停止并标记完成", getSnapshot().playing === false && getSnapshot().doneLines === lines.length);

// 断点续读：从第 3 句开始，只念后三句
spoken.length = 0;
speech.play("p-from", lines, 2);
await wait(400);
check("从指定句续读只念剩余句子", spoken.length === 3 && spoken[0] === lines[2]!.text, `${spoken.length} 句`);

// onend 不触发：靠兜底计时器推进（单句估算 ≥2.5s）
spoken.length = 0;
autoEnd = false;
speech.play("p-dead", [
  { id: 1, text: "Listen carefully." },
  { id: 2, text: "One more line." },
], 0);
await wait(4200);
check("引擎不回调 onend 时仍会推进到下一句", spoken.length >= 2, `已念 ${spoken.length} 句`);
speech.stop();
autoEnd = true;

// 停止后不再有新的句子被念
spoken.length = 0;
speech.play("p-stop", lines, 0);
await wait(30);
speech.stop();
const countAtStop = spoken.length;
await wait(300);
check("stop() 之后不再继续念", spoken.length === countAtStop, `停在 ${countAtStop} 句`);

  console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
