/**
 * 直接探测云 LLM 各模型的流式响应速度，找出「不卡在思考中」的模型。
 * 用法：node scripts/probe-cloud-llm.mjs
 */
const BASE = "https://cet-reading-82947.app.workbuddy.host";
const KEY = "wbpk_OygaSgZtVbaToy3nF2JfCs_fTRCb0qfheEAaCDwGYQZ4NzYfKmxuihC";

const MODELS = ["deepseek-v4-flash", "kimi-k2.5", "kimi-k3-1", "minimax-m2.5", "hy3", "hy4-preview", "glm-5.3-flash"];
const PROMPT = "用一句话说明四六级阅读里错误选项最常见的偷换手法。";

async function probe(model) {
  const started = Date.now();
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`${BASE}/.cloud/llm/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-wb-webapp-access-key": KEY,
        origin: BASE,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: PROMPT }],
        stream: true,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { model, status: res.status, firstTokenMs: null, contentChars: 0, note: text.slice(0, 160) };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let firstTokenMs = null;
    let content = "";
    let reasoningChars = 0;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta ?? {};
          if (delta.reasoning_content) reasoningChars += String(delta.reasoning_content).length;
          const c = delta.content ?? json.choices?.[0]?.message?.content ?? "";
          if (c) {
            if (firstTokenMs === null) firstTokenMs = Date.now() - started;
            content += c;
          }
        } catch {
          /* 心跳行忽略 */
        }
      }
      if (content.length > 400) break;
    }

    return {
      model,
      status: res.status,
      firstTokenMs,
      contentChars: content.length,
      reasoningChars,
      sample: content.slice(0, 60),
    };
  } catch (error) {
    return { model, status: "error", error: (error).name === "AbortError" ? "30s 超时" : (error).message };
  } finally {
    clearTimeout(hardTimer);
  }
}

for (const model of MODELS) {
  const r = await probe(model);
  const head = `${model.padEnd(22)} status=${String(r.status).padEnd(5)}`;
  if (r.error || r.firstTokenMs === null) {
    console.log(`${head} ❌ 无正文输出${r.reasoningChars ? `（思考 ${r.reasoningChars} 字）` : ""} ${r.note ?? r.error ?? ""}`);
  } else {
    console.log(
      `${head} 首字 ${String(r.firstTokenMs).padStart(6)}ms 正文 ${String(r.contentChars).padStart(4)} 字${
        r.reasoningChars ? ` 思考 ${r.reasoningChars} 字` : ""
      } —— ${r.sample}`,
    );
  }
}
