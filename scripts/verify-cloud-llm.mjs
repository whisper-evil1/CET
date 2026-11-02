/**
 * 云服务连通性验证（真实 SDK，非手写 fetch）。
 *
 * 用法：node scripts/verify-cloud-llm.mjs
 *
 * 验证三段：
 *   1. models.list() 能取到模型目录
 *   2. chat.completions.create({ stream: true }) 能真正流出正文
 *   3. 非流式入参会被 SDK 在发请求前拒掉（request_stream_required）
 *
 * 为什么要在 Node 里补 Origin 头：浏览器发跨域/同域请求时会自动带 Origin，
 * 而云服务按 Origin 精确匹配 publishableKey，Node 的 fetch 不会自动加。
 * 这里用 SDK 的 fetch 注入口补上，等于模拟真实浏览器环境。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWorkBuddyCloud } from "@tencent-ai/workbuddy-cloud-sdk";

const here = dirname(fileURLToPath(import.meta.url));
// 直接读源码里的 publicConfig，验证的就是实际会进 bundle 的那份值
const configText = readFileSync(join(here, "..", "src", "lib", "cloud-config.ts"), "utf8");
const pickValue = (key) => configText.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1] ?? "";

const endpoint = pickValue("endpoint");
const publishableKey = pickValue("publishableKey");

if (!endpoint || !publishableKey) {
  console.error("✗ src/lib/cloud-config.ts 里没读到 endpoint / publishableKey");
  process.exit(1);
}

console.log(`endpoint       = ${endpoint}`);
console.log(`publishableKey = ${publishableKey.slice(0, 18)}…（已截断，不打印全key）`);

const withOrigin = (input, init = {}) => {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("origin")) headers.set("origin", endpoint);
  return fetch(input, { ...init, headers });
};

const cloud = createWorkBuddyCloud({ endpoint, publishableKey, fetch: withOrigin });

let failed = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failed += 1;
  console.log(`  ✗ ${msg}`);
};

/* ---------------- 1. 模型目录 ---------------- */
console.log("\n[1] models.list()");
let modelId = null;
try {
  const models = await cloud.llm.models.list();
  if (!Array.isArray(models) || models.length === 0) {
    bad("模型列表为空");
  } else {
    ok(`取到 ${models.length} 个模型`);
    const usable = models.filter((m) => m.disabled !== true && !/^(auto|default)$/i.test(m.id));
    const pick = usable.find((m) => /flash/i.test(m.id)) ?? usable[0];
    modelId = pick?.id ?? null;
    ok(`选用 ${modelId}（共 ${usable.length} 个可用）`);
  }
} catch (error) {
  bad(`models.list 失败：${error?.name} ${error?.message ?? ""}`.trim());
}

/* ---------------- 2. 流式正文 ---------------- */
console.log("\n[2] chat.completions.create({ stream: true })");
if (!modelId) {
  bad("没有可用模型，跳过流式验证");
} else {
  const started = Date.now();
  let firstTokenMs = null;
  let content = "";
  let reasoning = 0;
  try {
    const stream = cloud.llm.chat.completions.create({
      model: modelId,
      messages: [
        { role: "system", content: "你是四六级阅读助教，只依据给定文章回答，不确定就直说不知道。" },
        { role: "user", content: "用一句话说明四六级阅读中错误选项最常见的偷换手法。" },
      ],
      stream: true,
      temperature: 0.3,
      stream_options: { include_usage: true },
    });

    let usage = null;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) reasoning += String(delta.reasoning_content).length;
      if (delta?.content) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        content += delta.content;
      }
      if (chunk.usage) usage = chunk.usage;
      if (content.length > 600) break;
    }

    if (!content.trim()) {
      bad(`流结束但没有正文（推理 ${reasoning} 字），疑似路由别名或空响应`);
    } else {
      ok(`首字 ${firstTokenMs}ms，正文 ${content.length} 字`);
      ok(`正文样本：${content.slice(0, 60).replace(/\s+/g, " ")}…`);
      if (usage?.total_tokens) ok(`用量 total_tokens=${usage.total_tokens}`);
    }
  } catch (error) {
    const code = error?.error?.code ?? error?.code ?? error?.name;
    bad(`流式调用失败：code=${code} message=${error?.message ?? ""}`);
    if (error?.requestId) console.log(`    requestId=${error.requestId}`);
  }
}

/* ---------------- 3. 非流式必须被拒 ---------------- */
console.log("\n[3] 非流式入参应被本地拒绝（request_stream_required）");
try {
  const iter = cloud.llm.chat.completions.create({
    model: modelId ?? "deepseek-v4-flash",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hi" },
    ],
    stream: false,
  });
  // 若返回的是异步迭代器而未抛错，说明本地校验没生效
  if (iter && typeof iter[Symbol.asyncIterator] === "function") {
    let threw = false;
    try {
      await iter[Symbol.asyncIterator]().next();
    } catch (e) {
      threw = true;
      const code = e?.error?.code ?? e?.code;
      if (code === "request_stream_required") ok("已按约定拒绝：request_stream_required");
      else bad(`拒绝了但 code 不是 request_stream_required，而是 ${code}`);
    }
    if (!threw) bad("stream:false 未被拒绝");
  } else {
    bad("stream:false 未在发请求前被拒绝");
  }
} catch (error) {
  const code = error?.error?.code ?? error?.code;
  if (code === "request_stream_required") ok("已按约定拒绝：request_stream_required");
  else bad(`拒绝原因不符：code=${code} message=${error?.message ?? ""}`);
}

console.log("");
if (failed > 0) {
  console.log(`结论：${failed} 项未通过`);
  process.exit(1);
}
console.log("结论：全部通过，云服务 LLM 链路可用");
