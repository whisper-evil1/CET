/**
 * 一条串行的人声队列。
 *
 * 要解决的问题：背单词时「连击鼓励语」和「下一个单词的读音」是两条独立的音频，
 * 各自调 speakText 播放，于是必然叠在一起 ——
 *
 *   t=0     答对，排一句鼓励语（延迟 300ms 开口）
 *   t=300   鼓励语开始说，时长 1 秒以上
 *   t=700   反馈结束，切到下一题，自动读新单词 → 把鼓励语掐断，或者两条一起响
 *
 * 听感上就是「鼓励的声音和下一个单词重复」。
 *
 * 办法很简单：让所有「自动发出的人声」进同一条链，前一条播完才轮到下一条。
 * speakText 本身就是「播完才 resolve」（playAudioUrl 在 onended 才结束），
 * 所以串起来之后天然不会重叠。
 *
 * 注意：用户手动点喇叭不该排队 —— 他点就是要立刻听到，那条路仍然直连 speakText。
 */
export type VoiceQueue = {
  /** 排队；前面的说完才轮到它。任务抛错不会卡住后面的 */
  enqueue: (task: () => Promise<void>) => void;
  /** 清空排队（换局、退出时用）。已经在说的那条会自己结束 */
  reset: () => void;
};

export function createVoiceQueue(): VoiceQueue {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      chain = chain.then(task).catch(() => {
        /* 单条失败不能毒化整条链 */
      });
    },
    reset() {
      chain = Promise.resolve();
    },
  };
}

/** 等一会儿（队列内部用来给鼓励语留一点起手时间） */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
