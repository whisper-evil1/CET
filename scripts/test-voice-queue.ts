/**
 * 人声队列的回归测试：同一时刻只能有一个"人在说话"。
 *
 * 复现的就是真实故障：答对后排一句鼓励语，700ms 后切词又自动读新单词，
 * 两条音频各自播放，听起来是"鼓励声和下一个单词重复"。
 *
 * 跑法：npx tsx scripts/test-voice-queue.ts
 */
import { createVoiceQueue, sleep } from "../src/lib/voice-queue";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  ok ? (pass += 1) : (fail += 1);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** 模拟一次"发声"：占住通道 duration 毫秒，期间别的东西不该同时响 */
function makeChannel() {
  const log: { who: string; action: "start" | "end"; at: number }[] = [];
  let busy = 0;
  let maxConcurrent = 0;
  const t0 = Date.now();

  const speak = async (who: string, duration: number) => {
    busy += 1;
    maxConcurrent = Math.max(maxConcurrent, busy);
    log.push({ who, action: "start", at: Date.now() - t0 });
    await sleep(duration);
    log.push({ who, action: "end", at: Date.now() - t0 });
    busy -= 1;
  };

  return { speak, log, maxConcurrent: () => maxConcurrent };
}

async function main() {
  /* ---- 场景 1：鼓励语 + 立刻换词（原故障） ---- */
  {
    const ch = makeChannel();
    const voice = createVoiceQueue();

    // t=0 答对，鼓励语排进去（先等 300ms 再开口，说 400ms）
    voice.enqueue(async () => {
      await sleep(300);
      await ch.speak("praise", 400);
    });
    // t=200 已经切到下一个词，自动读（读 350ms）
    await sleep(200);
    voice.enqueue(() => ch.speak("word-2", 350));
    await sleep(1400);

    check("鼓励语与单词不重叠", ch.maxConcurrent() === 1, `最大并发 ${ch.maxConcurrent()}`);
    const order = ch.log.filter((e) => e.action === "start").map((e) => e.who);
    check("先鼓励语后单词", order.join(">") === "praise>word-2", order.join(">"));

    const praiseEnd = ch.log.find((e) => e.who === "praise" && e.action === "end")!.at;
    const wordStart = ch.log.find((e) => e.who === "word-2" && e.action === "start")!.at;
    check("单词在鼓励语结束后才开始", wordStart >= praiseEnd, `${wordStart}ms >= ${praiseEnd}ms`);
  }

  /* ---- 场景 2：连续三次排队，严格串行 ---- */
  {
    const ch = makeChannel();
    const voice = createVoiceQueue();
    voice.enqueue(() => ch.speak("a", 120));
    voice.enqueue(() => ch.speak("b", 120));
    voice.enqueue(() => ch.speak("c", 120));
    await sleep(700);

    check("三条任务严格串行", ch.maxConcurrent() === 1, `最大并发 ${ch.maxConcurrent()}`);
    const order = ch.log.filter((e) => e.action === "start").map((e) => e.who);
    check("顺序不乱", order.join("") === "abc", order.join(""));
  }

  /* ---- 场景 3：中间一条抛错，后面的仍然照常 ---- */
  {
    const ch = makeChannel();
    const voice = createVoiceQueue();
    voice.enqueue(async () => {
      throw new Error("模拟播放失败");
    });
    voice.enqueue(() => ch.speak("after-error", 80));
    await sleep(300);
    const played = ch.log.some((e) => e.who === "after-error" && e.action === "start");
    check("一条失败不卡住后面的", played);
  }

  /* ---- 场景 4：reset 之后不再堆积 ---- */
  {
    const ch = makeChannel();
    const voice = createVoiceQueue();
    voice.enqueue(() => ch.speak("old", 100));
    voice.reset();
    voice.enqueue(() => ch.speak("new", 100));
    await sleep(400);
    const started = ch.log.filter((e) => e.action === "start").length;
    check("reset 后仍能继续排队", started >= 1, `实际启动 ${started} 条`);
  }

  console.log(`\n==== 人声队列 ${pass}/${pass + fail} ====`);
    process.exit(fail === 0 ? 0 : 1);

}

void main();
