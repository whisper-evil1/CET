/**
 * 创作平台的核心逻辑（纯函数，浏览器与服务端共用）。
 *
 * 两条产出线：
 *   1. 小说英译改编 —— 中文叙事文本 → 面向英语读者的改编稿（段级对照 + 专名表 + 改编说明）
 *   2. 短视频出海   —— 中文口播稿 → YouTube Shorts / TikTok 的英文发布包
 *      （标题 / 钩子 / 秒级分镜 / 字幕 / 话题标签 / 封面文案）
 *
 * 约定：
 * - 本文件会进浏览器包，禁用 ES2021+ 语法（无 .at() / replaceAll / Object.hasOwn）；
 * - 模型输出一律走 parse* 校验，字段缺了就用兜底值，绝不把半截 JSON 直接丢给 UI；
 * - 模型不可用时 offline* 产出一份「可执行的创作任务单」，
 *   明确标注未调用模型，不伪造英文译文。
 */

export type CreationKind = "novel" | "video";

export const CREATION_KIND_LABEL: Record<CreationKind, string> = {
  novel: "小说英译改编",
  video: "短视频出海",
};

/* ---------------- 选项 ---------------- */

export type NovelStyle = "literary" | "plain" | "teen";
export type NovelAudience = "general" | "teen" | "academic";

export type NovelOptions = {
  style: NovelStyle;
  audience: NovelAudience;
  /** 人名/地名保留拼音并首次出现加注，还是直接意译 */
  keepNames: boolean;
  /** 最多改编几段（防止一次塞进超长文本） */
  paragraphs: number;
};

export const NOVEL_STYLE_LABEL: Record<NovelStyle, string> = {
  literary: "文学化（保留叙述腔调）",
  plain: "简明英语（B1 可读）",
  teen: "青少年向（口语节奏）",
};

export const NOVEL_AUDIENCE_LABEL: Record<NovelAudience, string> = {
  general: "普通读者",
  teen: "青少年读者",
  academic: "课堂/研究读者",
};

export const DEFAULT_NOVEL_OPTIONS: NovelOptions = {
  style: "literary",
  audience: "general",
  keepNames: true,
  paragraphs: 6,
};

export type VideoPlatform = "youtube" | "tiktok";
export type VideoTone = "warm" | "punchy" | "documentary";

export type VideoOptions = {
  platform: VideoPlatform;
  /** 目标时长（秒），决定分镜条数 */
  seconds: 30 | 60;
  tone: VideoTone;
};

export const VIDEO_PLATFORM_LABEL: Record<VideoPlatform, string> = {
  youtube: "YouTube Shorts",
  tiktok: "TikTok",
};

export const VIDEO_TONE_LABEL: Record<VideoTone, string> = {
  warm: "温和讲述",
  punchy: "快节奏强钩子",
  documentary: "纪录片旁白",
};

export const DEFAULT_VIDEO_OPTIONS: VideoOptions = {
  platform: "youtube",
  seconds: 30,
  tone: "warm",
};

/* ---------------- 输出结构 ---------------- */

export type NovelParagraph = {
  /** 中文原段 */
  zh: string;
  /** 英文改编；空串表示未生成（离线骨架） */
  en: string;
};

export type NovelOutput = {
  title: string;
  subtitle: string;
  paragraphs: NovelParagraph[];
  glossary: { term: string; gloss: string }[];
  notes: string[];
  wordCount: number;
};

export type VideoScene = {
  /** 时间码，如 "0-3s" */
  sec: string;
  visual: string;
  voiceover: string;
  caption: string;
};

export type VideoOutput = {
  platform: VideoPlatform;
  title: string;
  hooks: string[];
  scenes: VideoScene[];
  hashtags: string[];
  coverText: string;
  description: string;
};

/* ---------------- 文本预处理 ---------------- */

export const MAX_SOURCE_CHARS = 6000;

/** 按空行/换行切段，去掉空行与前后的空白 */
export function splitParagraphs(input: string, limit = 12): string[] {
  return input
    .split(/\n{1,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, limit);
}

/** 中文按字计、英文按词计，给 UI 一个「这段多长」的直观数 */
export function estimateChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

export function countEnWords(text: string): number {
  const matched = text.match(/[A-Za-z][A-Za-z'-]*/g);
  return matched ? matched.length : 0;
}

/** 《书名》《篇名》这类专名：给专名表打底，也让模型知道不能乱改 */
export function extractTitles(text: string): string[] {
  const found: string[] = [];
  const re = /《([^》]{1,30})》/g;
  let hit = re.exec(text);
  while (hit) {
    const name = hit[1].trim();
    if (name && found.indexOf(name) < 0) found.push(name);
    hit = re.exec(text);
  }
  return found;
}

/* ---------------- 提示词 ---------------- */

const STYLE_RULE: Record<NovelStyle, string> = {
  literary:
    "保持原文的叙述腔调与意象，允许长句和修辞；用英语文学常见句法，不要逐字直译，也不要改写成摘要。",
  plain:
    "用 CEFR B1 的简明英语：短句为主，每句不超过 25 词，生僻词第一次出现就给同位语解释。",
  teen: "用青少年能读的口语节奏：多用直接引语和短句，避免文言腔，允许适度幽默。",
};

const AUDIENCE_RULE: Record<NovelAudience, string> = {
  general: "读者没有中国文化背景，遇到节令、称谓、俗语要自然融入语境，不堆注释。",
  teen: "读者是 12-18 岁，文化背景知识要更具体，可直接用从句解释。",
  academic: "读者关注文本本身，术语与专名要一致，可保留少量拼音并附简短说明。",
};

export function buildNovelPrompt(
  zh: string,
  options: NovelOptions,
): { system: string; user: string } {
  const paragraphs = splitParagraphs(zh, options.paragraphs);
  const numbered = paragraphs
    .map((p, i) => `【段 ${i + 1}】${p}`)
    .join("\n");
  const titles = extractTitles(zh);

  const system = [
    "你是一位中文文学英译与改编编辑，长期为英语读者改编中国小说。",
    "任务：把用户给的中文段落改写成面向英语读者的英文版本，要求可读、可信、不丢失情节与人物关系。",
    `文体要求：${STYLE_RULE[options.style]}`,
    `读者设定：${AUDIENCE_RULE[options.audience]}`,
    options.keepNames
      ? "人名地名处理：首次出现用拼音，紧跟括号给出身份或称谓，例如 “Shen Congwen (a young teacher)”；之后只用拼音。"
      : "人名地名处理：按英语习惯意译或替换为功能等价的英文称呼，保持全书一致。",
    titles.length > 0 ? `文中书名/篇名：${titles.join("、")}，英文名要保持统一。` : "",
    "只输出 JSON，不要任何解释文字、不要 Markdown 代码块围栏。JSON 结构：",
    '{"title":"英文标题","subtitle":"中文原名或一句话说明","paragraphs":[{"zh":"第1段中文原文","en":"第1段英文改编"}],"glossary":[{"term":"专名或文化词","gloss":"英文解释，≤20词"}],"notes":["改编处理说明，2-4条"]}',
    "paragraphs 的数量必须和输入段数一致，顺序一致；zh 原样回填，不要改写中文。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return { system, user: `以下是待改编的中文原文，共 ${paragraphs.length} 段：\n${numbered}` };
}

export function buildVideoPrompt(
  zh: string,
  options: VideoOptions,
): { system: string; user: string } {
  const isTikTok = options.platform === "tiktok";
  const sceneCount = options.seconds <= 30 ? 5 : 8;
  const step = Math.max(3, Math.round(options.seconds / sceneCount));

  const platformRule = isTikTok
    ? "平台：TikTok。前三秒必须给出强钩子；字幕短、口语化、可用流行表达但不能低俗；话题标签 4-6 个，混 1-2 个大流量标签。"
    : "平台：YouTube Shorts。前三秒给钩子；标题要含搜索关键词（利于 Shorts 检索）；描述里放 2-3 句摘要 + 话题标签 3-5 个。";

  const system = [
    "你是一位帮中国创作者做海外短视频的编导，负责把中文口播稿改写成英文发布包。",
    platformRule,
    `语气：${VIDEO_TONE_LABEL[options.tone]}。`,
    `时长：${options.seconds} 秒，分成 ${sceneCount} 个镜头，每镜约 ${step} 秒，时间码要连续覆盖 0 到 ${options.seconds}s。`,
    "英文必须是可直接念出来的口播句子（不要书面长句），字幕与口播可以相同但要更短。",
    "只输出 JSON，不要解释、不要代码块围栏。JSON 结构：",
    '{"title":"英文标题（≤60 字符）","hooks":["3 个开场钩子，各 ≤15 词"],"scenes":[{"sec":"0-6s","visual":"画面描述","voiceover":"英文口播","caption":"英文字幕，≤60 字符"}],"hashtags":["#Tag"],"coverText":"封面文案，≤24 字符","description":"发布描述 2-3 句"}',
    "hashtags 不要带空格；title 超过 60 字符就换更短的表达。",
  ].join("\n");

  return { system, user: `以下是中文口播稿：\n${zh}` };
}

/* ---------------- 模型输出解析 ---------------- */

/** 从模型回复里抠出第一段 JSON；模型偶尔会套 ```json 围栏或前后说话 */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  if (start < 0) return null;
  // 从最后一个 } 往回缩，容忍尾部多余字符
  let end = body.lastIndexOf("}");
  while (end > start) {
    const slice = body.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      end = body.lastIndexOf("}", end - 1);
    }
  }
  return null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseNovelOutput(raw: string, sourceText: string): NovelOutput | null {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const sourceParas = splitParagraphs(sourceText, 24);
  const rawParas = Array.isArray(obj.paragraphs) ? obj.paragraphs : [];

  const paragraphs: NovelParagraph[] = [];
  for (let i = 0; i < rawParas.length; i++) {
    const item = rawParas[i];
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const zh = asString(p.zh) || sourceParas[i] || "";
    const en = asString(p.en);
    if (!zh && !en) continue;
    paragraphs.push({ zh, en });
  }
  if (paragraphs.length === 0) {
    // 模型只给了整段英文、没分段：退回「原文 + 整段译文」两栏
    const wholeEn = asString(obj.text) || asString(obj.content);
    if (!wholeEn) return null;
    return {
      title: asString(obj.title, "Untitled"),
      subtitle: asString(obj.subtitle),
      paragraphs: [{ zh: sourceParas.join("\n"), en: wholeEn }],
      glossary: [],
      notes: asStringArray(obj.notes),
      wordCount: countEnWords(wholeEn),
    };
  }

  const glossary: { term: string; gloss: string }[] = [];
  if (Array.isArray(obj.glossary)) {
    for (const item of obj.glossary) {
      if (!item || typeof item !== "object") continue;
      const g = item as Record<string, unknown>;
      const term = asString(g.term);
      const gloss = asString(g.gloss) || asString(g.meaning) || asString(g.explain);
      if (term && gloss) glossary.push({ term, gloss });
      if (glossary.length >= 12) break;
    }
  }

  const enAll = paragraphs.map((p) => p.en).join(" ");
  return {
    title: asString(obj.title, "Untitled"),
    subtitle: asString(obj.subtitle),
    paragraphs,
    glossary,
    notes: asStringArray(obj.notes),
    wordCount: countEnWords(enAll),
  };
}

export function parseVideoOutput(
  raw: string,
  options: VideoOptions,
): VideoOutput | null {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const scenes: VideoScene[] = [];
  const rawScenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  for (const item of rawScenes) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const sec = asString(s.sec) || asString(s.time) || asString(s.timing);
    const voiceover = asString(s.voiceover) || asString(s.voice) || asString(s.line);
    const visual = asString(s.visual) || asString(s.shot) || asString(s.screen);
    const caption = asString(s.caption) || asString(s.subtitle) || voiceover;
    if (!sec && !voiceover) continue;
    scenes.push({ sec, visual, voiceover, caption });
    if (scenes.length >= 12) break;
  }

  const title = asString(obj.title);
  if (!title && scenes.length === 0) return null;

  const hashtags = asStringArray(obj.hashtags, 8).map((tag) =>
    tag.charAt(0) === "#" ? tag : `#${tag}`,
  );

  return {
    platform: options.platform,
    title: title || "Untitled Short",
    hooks: asStringArray(obj.hooks, 4),
    scenes,
    hashtags,
    coverText: asString(obj.coverText) || asString(obj.cover),
    description: asString(obj.description) || asString(obj.desc),
  };
}

/* ---------------- 离线骨架（模型不可用时） ---------------- */

/**
 * 不伪造英文。给出的是「可以直接照着写」的任务单：
 * 每段该讲什么、哪些词必须统一、英文句式给模板、平台硬规则逐条列出。
 */
export function offlineNovel(sourceText: string, options: NovelOptions): NovelOutput {
  const paragraphs = splitParagraphs(sourceText, options.paragraphs);
  const titles = extractTitles(sourceText);
  const glossary = titles.map((t) => ({
    term: t,
    gloss: "标题：首次出现给出英文译名，其后保持一致",
  }));

  return {
    title: "（离线骨架 · 未调用模型）",
    subtitle: titles.length > 0 ? titles.join("、") : `共 ${paragraphs.length} 段`,
    paragraphs: paragraphs.map((zh) => ({ zh, en: "" })),
    glossary,
    notes: [
      `文体：${NOVEL_STYLE_LABEL[options.style]}；读者：${NOVEL_AUDIENCE_LABEL[options.audience]}。`,
      options.keepNames
        ? "人名地名：首次出现用拼音 + 括号身份，其后只用拼音。"
        : "人名地名：改为功能等价的英文称呼，全书一致。",
      "逐段落笔顺序：先确定每段的信息点 → 再定英文主句 → 最后补衔接词，不要边译边改结构。",
      "模型未连通，这里只给结构骨架；连通后同一份原文会直接产出英文改编稿。",
    ],
    wordCount: 0,
  };
}

export function offlineVideo(sourceText: string, options: VideoOptions): VideoOutput {
  const lines = splitParagraphs(sourceText, 12);
  const sceneCount = options.seconds <= 30 ? 5 : 8;
  const step = Math.max(3, Math.round(options.seconds / sceneCount));
  const scenes: VideoScene[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const from = i * step;
    const to = i === sceneCount - 1 ? options.seconds : (i + 1) * step;
    scenes.push({
      sec: `${from}-${to}s`,
      visual: i === 0 ? "开场钩子镜：给最强的画面或数字" : `第 ${i + 1} 镜：对应原文第 ${Math.min(i + 1, lines.length)} 段`,
      voiceover: "",
      caption: "",
    });
  }

  return {
    platform: options.platform,
    title: "（离线骨架 · 未调用模型）",
    hooks: [
      "开场钩子 1：先说结论或反差，不要自我介绍。",
      "开场钩子 2：用具体数字/时间/地点制造信息量。",
      "开场钩子 3：抛一个只有看完才回答的问题。",
    ],
    scenes,
    hashtags:
      options.platform === "tiktok"
        ? ["#China", "#ChineseCulture", "#LearnOnTikTok"]
        : ["#China", "#Shorts", "#Culture"],
    coverText: "封面文案：≤24 字符，写结果不写过程",
    description:
      "发布描述：2-3 句讲清「这条片讲了什么 + 为什么值得看完」，末尾放话题标签。模型未连通，这里是结构骨架。",
  };
}

/* ---------------- 校验 ---------------- */

/** 平台硬规则检查，UI 直接显示成「待修项」 */
export function auditVideoOutput(output: VideoOutput): string[] {
  const issues: string[] = [];
  if (output.title.length > 60) issues.push(`标题 ${output.title.length} 字符，超过 60`);
  if (output.hooks.length < 3) issues.push("开场钩子少于 3 条");
  if (output.scenes.length === 0) issues.push("还没有分镜");
  const emptyVo = output.scenes.filter((s) => !s.voiceover).length;
  if (emptyVo > 0) issues.push(`${emptyVo} 个镜头没写英文口播`);
  if (output.hashtags.length === 0) issues.push("没有话题标签");
  if (output.hashtags.some((t) => /\s/.test(t))) issues.push("话题标签里有空格");
  return issues;
}

/** 导出成 Markdown：小说双栏对照、视频分镜表 */
export function novelToMarkdown(output: NovelOutput, meta: NovelOptions): string {
  const lines: string[] = [];
  lines.push(`# ${output.title}`);
  if (output.subtitle) lines.push(`> ${output.subtitle}`);
  lines.push("");
  lines.push(
    `风格：${NOVEL_STYLE_LABEL[meta.style]} · 读者：${NOVEL_AUDIENCE_LABEL[meta.audience]} · 英文词数：${output.wordCount}`,
  );
  lines.push("");
  output.paragraphs.forEach((p, i) => {
    lines.push(`## 第 ${i + 1} 段`);
    lines.push(p.zh);
    lines.push("");
    lines.push(p.en || "（未生成英文）");
    lines.push("");
  });
  if (output.glossary.length > 0) {
    lines.push("## 专名表");
    output.glossary.forEach((g) => lines.push(`- **${g.term}** — ${g.gloss}`));
    lines.push("");
  }
  if (output.notes.length > 0) {
    lines.push("## 改编说明");
    output.notes.forEach((n) => lines.push(`- ${n}`));
  }
  return lines.join("\n");
}

export function videoToMarkdown(output: VideoOutput): string {
  const lines: string[] = [];
  lines.push(`# ${output.title}`);
  lines.push("");
  lines.push(`平台：${VIDEO_PLATFORM_LABEL[output.platform]}`);
  lines.push("");
  lines.push("## 开场钩子");
  output.hooks.forEach((h) => lines.push(`- ${h}`));
  lines.push("");
  lines.push("## 分镜");
  lines.push("| 时间 | 画面 | 英文口播 | 字幕 |");
  lines.push("|---|---|---|---|");
  output.scenes.forEach((s) => {
    lines.push(`| ${s.sec} | ${s.visual} | ${s.voiceover} | ${s.caption} |`);
  });
  lines.push("");
  lines.push(`## 话题标签`);
  lines.push(output.hashtags.join(" "));
  lines.push("");
  lines.push(`## 封面文案`);
  lines.push(output.coverText);
  lines.push("");
  lines.push(`## 发布描述`);
  lines.push(output.description);
  return lines.join("\n");
}
