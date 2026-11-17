// 「英文配音成片」端到端验收：真实合成英文语音 + 换音轨 + 烧字幕，产 MP4。
//
// 背景：线上曾 100% 失败 —— route 调 `scripts/tts-dub.py`，容器里没有 pip 的
// edge-tts，直接 ModuleNotFoundError: No module named 'edge_tts'。
// 现在配音改走 Node 的 msedge-tts（与听力音频同一条链路）。本脚本盯的就是
// 「这条路真的能出片」：接口 200、返回体是 MP4、带音频流、时长接近原片。
//
// 用法：
//   本地：BASE=http://127.0.0.1:3100 node scripts/verify-video-dub.mjs
//   线上：BASE=https://xxx SC=xxx node scripts/verify-video-dub.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const BASE = (process.env.BASE || "http://127.0.0.1:3100").replace(/\/$/, "");
const SC = process.env.SC || "";
const FFMPEG =
  process.env.FFMPEG_BIN || path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const OUT_DIR = path.join(process.cwd(), "_shots");
const SRC = path.join(OUT_DIR, "_dub-src.mp4");
const OUT = path.join(OUT_DIR, "_dub-out.mp4");
const withShare = (p) => (SC ? `${p}${p.includes("?") ? "&" : "?"}sharecode=${SC}` : p);

const LINES = [
  "Many people think hotpot is just about spice, but Chengdu locals care about aroma.",
  "We fry the base: beef tallow, chili bean paste, Sichuan peppercorns, ginger and garlic.",
  "Slow fire, forty minutes, and the fragrance really comes out.",
  "The order matters too: tripe seven dips, eight lifts, duck intestine ten seconds.",
  "Beef goes in last, so the broth stays clear.",
  "So when you visit Chengdu, sit down, eat a meal, and taste a steaming-hot life.",
];
const DURATION = 18;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
};

async function ensureSource() {
  if (fs.existsSync(SRC)) return;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await execFileAsync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=25`,
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", String(DURATION),
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      SRC,
    ],
    { timeout: 120_000 },
  );
}

async function probe(file) {
  let stderr = "";
  try {
    const done = await execFileAsync(FFMPEG, ["-hide_banner", "-nostdin", "-i", file], {
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    stderr = done.stderr ?? "";
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  return { seconds, hasAudio: /Stream #\d+:\d+.*Audio:/.test(stderr), hasVideo: /Stream #\d+:\d+.*Video:/.test(stderr) };
}

/** 数「说出来的段数」：一段连续非静音 = 一句配音。空音轨或全静音会得到 0。 */
async function speechSegments(file) {
  let stderr = "";
  try {
    const done = await execFileAsync(
      FFMPEG,
      ["-hide_banner", "-nostdin", "-i", file, "-vn", "-af", "silencedetect=noise=-35dB:d=0.15", "-f", "null", "-"],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    stderr = done.stderr ?? "";
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  return (stderr.match(/silence_end:/g) || []).length;
}

/** 平均音量（dB）。原片是 440Hz 正弦，替换成语音后音量分布完全不同，用它确认音轨真的换了。 */
async function meanVolume(file) {
  let stderr = "";
  try {
    const done = await execFileAsync(
      FFMPEG,
      ["-hide_banner", "-nostdin", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    stderr = done.stderr ?? "";
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  const m = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  return m ? Number(m[1]) : NaN;
}

/* 会话走 NextAuth 的 credentials 接口拿，不依赖浏览器点按钮：
   线上登录页水合慢，脚本点「演示账号」经常点空，登录失败会让整轮验收白跑。 */
const jar = new Map();
const absorbCookies = (res) => {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function login() {
  let csrf = "";
  for (let i = 0; i < 4 && !csrf; i += 1) {
    const res = await fetch(BASE + withShare("/api/auth/csrf"), { headers: { "user-agent": UA } });
    absorbCookies(res);
    try {
      csrf = JSON.parse(await res.text()).csrfToken ?? "";
    } catch {
      await sleep(2000);
    }
  }
  if (!csrf) return false;

  const res = await fetch(BASE + withShare("/api/auth/callback/credentials"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(), "user-agent": UA },
    body: new URLSearchParams({
      email: process.env.EMAIL || "demo@cet.local",
      password: process.env.PASSWORD || "demo1234",
      csrfToken: csrf,
      callbackUrl: withShare("/"),
      json: "true",
    }),
  });
  absorbCookies(res);
  return [...jar.keys()].some((k) => /session-token/.test(k));
}

try {
  await ensureSource();
  const src = await probe(SRC);
  console.log(`\n源片：${path.basename(SRC)} ${src.seconds.toFixed(1)}s / 视频=${src.hasVideo} 音频=${src.hasAudio}\n`);

  console.log("【1】登录拿会话");
  const ok = await login();
  check("演示账号登录成功", ok, BASE);
  if (!ok) throw new Error("登录失败，后续接口调用无从验证");

  const post = async (mode, lines = LINES) => {
    const form = new FormData();
    form.set("video", new Blob([fs.readFileSync(SRC)], { type: "video/mp4" }), "dub-src.mp4");
    form.set("lines", JSON.stringify(lines));
    form.set("durationSec", String(src.seconds || DURATION));
    form.set("height", "360");
    form.set("mode", mode);
    form.set("title", `配音验收-${mode}`);
    const started = Date.now();
    const res = await fetch(`${BASE}/api/create/export-video-file?sharecode=${SC}`, {
      method: "POST",
      headers: { cookie: cookieHeader(), "user-agent": UA },
      body: form,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, ms: Date.now() - started };
  };

  console.log("\n【2】mode=dub 英文配音");
  const dub = await post("dub");
  const dubText = dub.res.headers.get("content-type")?.includes("video/mp4") ? "" : dub.buf.toString("utf8").slice(0, 240);
  check("返回 200", dub.res.status === 200, `status=${dub.res.status} ${dubText}`);
  check("Content-Type 是 video/mp4", /video\/mp4/.test(dub.res.headers.get("content-type") || ""));
  check("X-Subtitle-Mode = dub", dub.res.headers.get("x-subtitle-mode") === "dub");
  check("产物 > 100KB（不是空壳）", dub.buf.length > 100 * 1024, `${(dub.buf.length / 1024).toFixed(0)}KB`);
  check("不再报 edge_tts 缺失", !/edge_tts|ModuleNotFoundError|tts-dub\.py/i.test(dub.buf.toString("utf8")));

  let dubProbe = { seconds: 0, hasAudio: false, hasVideo: false };
  if (dub.res.status === 200) {
    fs.writeFileSync(OUT, dub.buf);
    dubProbe = await probe(OUT);
    check("成片有视频流", dubProbe.hasVideo);
    check("成片有音频流（配音真的合进去了）", dubProbe.hasAudio);
    check(
      "成片时长贴合原片（±1.5s）",
      Math.abs(dubProbe.seconds - (src.seconds || DURATION)) <= 1.5,
      `${dubProbe.seconds.toFixed(1)}s vs ${(src.seconds || DURATION).toFixed(1)}s`,
    );
    const audioOnly = await execFileAsync(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-i", OUT, "-vn", "-f", "null", "-"],
      { timeout: 120_000 },
    ).then(() => true).catch(() => false);
    check("音轨可完整解码", audioOnly);

    const segs = await speechSegments(OUT);
    check("能检出 ≥5 段人声（配音真的铺了 6 句）", segs >= 5, `${segs} 段`);
    const vol = await meanVolume(OUT);
    check("平均音量正常（不是静音轨）", Number.isFinite(vol) && vol > -40, `${vol} dB`);
    console.log(`     耗时 ${(dub.ms / 1000).toFixed(1)}s → ${OUT}`);
  }

  console.log("\n【3】长字幕压缩（语音总长 > 视频时长时用 atempo 塞进去）");
  const longLines = [
    ...LINES,
    "Every table has its own rhythm, and the host keeps topping up the broth.",
    "The dipping sauce is sesame oil, garlic and coriander, nothing more.",
    "By the end of the night the street outside is still loud and still hungry.",
    "That is the Chengdu way: eat slowly, talk loudly, leave late.",
    "And when you wake up tomorrow, you will want it again.",
    "So come hungry, come late, and bring friends who like spicy food.",
  ];
  const dense = await post("dub", longLines);
  check("长字幕 dub 返回 200", dense.res.status === 200, `status=${dense.res.status}`);
  if (dense.res.status === 200) {
    const densePath = path.join(OUT_DIR, "_dub-dense.mp4");
    fs.writeFileSync(densePath, dense.buf);
    const denseProbe = await probe(densePath);
    check(
      "长字幕成片不超原片时长",
      denseProbe.seconds <= (src.seconds || DURATION) + 1,
      `${denseProbe.seconds.toFixed(1)}s`,
    );
    check("长字幕成片仍有音频流", denseProbe.hasAudio);
  }

  console.log("\n【4】mode=burn 对照（字幕视频不回归）");
  const burn = await post("burn");
  // 同一账号 10 分钟内导出次数有上限；撞上了说明限流生效，不是功能坏
  if (burn.res.status === 429) {
    console.log(`  ~ 跳过：触发导出限流 429（限流本身生效，功能未验证）`);
  } else {
    check("burn 返回 200", burn.res.status === 200, `status=${burn.res.status}`);
    check("burn X-Subtitle-Mode = burn", burn.res.headers.get("x-subtitle-mode") === "burn");
  }

  console.log("\n【5】参数校验");
  const empty = await fetch(`${BASE}/api/create/export-video-file?sharecode=${SC}`, {
    method: "POST",
    headers: { cookie: cookieHeader(), "user-agent": UA },
    body: (() => {
      const f = new FormData();
      f.set("video", new Blob([fs.readFileSync(SRC)], { type: "video/mp4" }), "dub-src.mp4");
      f.set("lines", "[]");
      f.set("durationSec", "18");
      f.set("mode", "dub");
      return f;
    })(),
  });
  if (empty.status === 429) {
    console.log("  ~ 跳过：导出限流 429");
  } else {
    check("空字幕被拒（400）", empty.status === 400, `status=${empty.status}`);
  }
} catch (error) {
  fail += 1;
  console.log(`\n  ✗ 脚本异常：${error instanceof Error ? error.message : error}`);
} finally {
  /* 无浏览器可关 */
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
