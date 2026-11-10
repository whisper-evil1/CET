#!/usr/bin/env node
/**
 * 页面级巡检：接口全绿不等于页面能看。
 * 这里逐个 GET 主要路由，检查「真的是页面」——状态码、内容类型、体积、关键标记，
 * 以及有没有落进错误边界（"Application error" / "服务器开小差" / 空白壳）。
 *
 * 用法：
 *   node scripts/e2e-pages.mjs
 *   BASE=https://xxx.host SHARE=XXXX node scripts/e2e-pages.mjs
 */

const BASE = (process.env.BASE ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const SHARE = process.env.SHARE ?? "";
const APP_ORIGIN = process.env.APP_ORIGIN ?? "";

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

function absorb(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (!k) continue;
    if (!v || /max-age=0/i.test(line)) jar.delete(k);
    else jar.set(k, v);
  }
}

async function req(path, init = {}) {
  const headers = { ...(APP_ORIGIN ? { origin: APP_ORIGIN, referer: APP_ORIGIN + "/" } : {}), ...(init.headers ?? {}) };
  const c = cookieHeader();
  if (c) headers.cookie = c;
  const res = await fetch(path.startsWith("http") ? path : BASE + path, { ...init, headers, redirect: "manual" });
  absorb(res);
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    location: res.headers.get("location") ?? "",
    text: await res.text(),
  };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  OK  " : " FAIL "} ${name}${detail ? "  ⟶  " + detail : ""}`);
}

/**
 * 页面失败的特征串。
 * 注意不能拿 "This page could not be found" 当判据 —— Next.js 会把 not-found 模板
 * 内联进 RSC flight 数据里做客户端导航兜底，正常页面里也含这段字符串。
 * 真正 404 由状态码判定，这里只看「落进错误边界」的特征。
 */
const FAIL_MARKERS = ["Application error", "服务器开小差了", "missing required error components", "Internal Server Error"];

/** 判断一次页面请求的结果；3xx 只允许跳同站，且不能跳登录页（除非本来就在验未登录） */
async function judge(name, path, { allowRedirect = false, expectLoginRedirect = false, expect = null } = {}) {
  let r = await req(path);

  if (r.status >= 300 && r.status < 400) {
    const to = r.location;
    const sameSite = to.startsWith("/") || to.startsWith(BASE);
    if (expectLoginRedirect && /\/login/.test(to)) {
      check(name, true, `HTTP ${r.status} → ${to}（未登录跳登录页，正确）`);
      return;
    }
    if (!sameSite || !allowRedirect) {
      check(name, false, `HTTP ${r.status} → ${to || "(无 location)"}，非预期跳转`);
      return;
    }
    // 同站重定向是应用自身设计（例如 /cet4 → /?level=CET4），跟进去再判
    r = await req(to);
  }

  if (r.status !== 200) {
    check(name, false, `HTTP ${r.status}`);
    return;
  }

  const failed = FAIL_MARKERS.find((m) => r.text.includes(m));
  if (failed) {
    check(name, false, `命中失败标记「${failed}」`);
    return;
  }

  const title = r.text.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const hasChrome = /左文右题|CET/.test(r.text);
  const sizeOk = r.text.length > 3000;
  const typeOk = /text\/html/.test(r.type);
  // expect：这条路由独有的正文标记。没有它就变成「只要不报错就算过」，
  // 七个页面全是同一个外壳也能混过去。
  const expectOk = expect ? expect.test(r.text) : true;
  check(
    name,
    Boolean(title) && hasChrome && sizeOk && typeOk && expectOk,
    `${(r.text.length / 1024).toFixed(0)}KB · title=「${title}」${expect && !expectOk ? ` · 缺正文标记 ${expect}` : ""}`,
  );
}

async function login() {
  const email = `page${Date.now().toString(36)}@qq.com`;
  const password = "Test1234";
  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, name: "页面巡检" }),
  });
  let useEmail = email;
  let usePassword = password;
  if (reg.status === 429) {
    useEmail = "demo@cet.local";
    usePassword = "demo1234";
  }

  const csrf = await req("/api/auth/csrf");
  const token = JSON.parse(csrf.text).csrfToken;
  await req("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken: token, email: useEmail, password: usePassword, callbackUrl: BASE + "/", json: "true" }).toString(),
  });
  const sess = await req("/api/auth/session");
  return { email: useEmail, user: JSON.parse(sess.text)?.user ?? null };
}

async function main() {
  console.log(`\n页面巡检：${BASE}${SHARE ? `  sharecode=${SHARE}` : ""}\n`);

  if (SHARE) {
    const boot = await req(`/?sharecode=${SHARE}`);
    check("平台 sharecode 握手", boot.status === 200, `HTTP ${boot.status}`);
  }

  // 先看未登录状态：公开页应可访问，受保护页应跳登录
  console.log("\n[未登录]");
  await judge("首页 /", "/");
  await judge("登录页 /login", "/login");
  await judge("四级列表 /cet4", "/cet4", { allowRedirect: true });
  await judge("六级列表 /cet6", "/cet6", { allowRedirect: true });
  await judge("受保护页 /profile", "/profile", { expectLoginRedirect: true });

  // v2.3 新增：闯关与创作平台未登录时也要「能看见门」，不能白屏或落错误边界。
  // 这七条是用户点名要的功能页，必须逐条验证，不能只测首页。
  await judge("闯关总览 /arcade", "/arcade", { expect: /配对四连/ });
  await judge("趣味背单词 /arcade/vocab", "/arcade/vocab", { expect: /趣味背单词/ });
  await judge("趣味阅读 /arcade/reading", "/arcade/reading", { expect: /趣味阅读闯关/ });
  await judge("趣味写作 /arcade/writing", "/arcade/writing", { expect: /趣味写作/ });
  await judge("创作平台 /create", "/create", { expect: /小说英译改编/ });
  await judge("小说英译 /create/novel", "/create/novel", { expect: /中文一段，英文一段/ });
  await judge("短视频出海 /create/video", "/create/video", { expect: /两种海外平台/ });
  // 单词数据面板要登录才有数据，未登录必须跳登录而不是 500 或空图
  await judge("单词数据面板 /vocab/stats", "/vocab/stats", { expectLoginRedirect: true });

  console.log("\n[已登录]");
  const me = await login();
  check("登录成功", Boolean(me.user), `user=${me.user?.email ?? "null"}`);

  await judge("首页 /", "/");
  await judge("四级列表 /cet4", "/cet4", { allowRedirect: true });
  await judge("试卷练习 /practice/[id]", "/practice/paper-cet4-2024-12");
  await judge("个人中心 /profile", "/profile");
  await judge("生词本 /vocab", "/vocab");
  await judge("收藏 /favorites", "/favorites");
  await judge("排行榜 /leaderboard", "/leaderboard");

  // 登录态再走一遍：这七页里有三页会挂客户端游戏组件（依赖队列/真题/批改接口），
  // 服务端渲染阶段若因取数失败抛错，只有登录态才暴露。
  await judge("闯关总览 /arcade", "/arcade", { expect: /配对四连/ });
  await judge("趣味背单词 /arcade/vocab", "/arcade/vocab", { expect: /趣味背单词/ });
  await judge("趣味阅读 /arcade/reading", "/arcade/reading", { expect: /趣味阅读闯关/ });
  await judge("趣味写作 /arcade/writing", "/arcade/writing", { expect: /趣味写作/ });
  await judge("创作平台 /create", "/create", { expect: /小说英译改编/ });
  await judge("小说英译 /create/novel", "/create/novel", { expect: /中文一段，英文一段/ });
  await judge("短视频出海 /create/video", "/create/video", { expect: /两种海外平台/ });
  // 数据面板走服务端聚合（词汇快照 + 复习流水），取数失败只会在登录态暴露
  await judge("单词数据面板 /vocab/stats", "/vocab/stats", { expect: /单词学习数据/ });

  console.log("\n[静态资源]");
  const home = await req("/");
  const cssHref = home.text.match(/href="([^"]*\.css[^"]*)"/)?.[1];
  if (!cssHref) {
    check("样式表引用", false, "HTML 里没有 CSS 链接");
  } else {
    const css = await req(cssHref);
    check(
      "样式表可加载",
      css.status === 200 && css.text.length > 5000,
      `HTTP ${css.status} ${(css.text.length / 1024).toFixed(0)}KB`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`合计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log("\n失败清单：");
    for (const f of failed) console.log(` - ${f.name}：${f.detail}`);
  }
  console.log(`${"─".repeat(60)}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("巡检异常：", e);
  process.exit(2);
});
