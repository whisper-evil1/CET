/**
 * 登录小工具（供 e2e 脚本共用）。
 *
 * 为什么必须抽出来：这里的失败模式全都来自时序，而且每个脚本各写一遍就会各漏一遍。
 *
 * 1. **hydration 抢输入**：登录页是客户端组件，React 接管时会把 SSR 出来的 DOM 输入框
 *    重置成自己的空 state。如果在这之前用 page.type 输入，值会被清空，表单以空值提交，
 *    页面报「邮箱或密码不对」——看起来像密码错了，实际是脚本太快。
 *    对策：输入后**校验输入框里的值**，不对就重来。
 * 2. **提交导航抢后续操作**：上一次提交成功后页面开始跳转，而循环还在准备下一次输入，
 *    page.type 会抛 "Execution context was destroyed"。对策：所有页面操作都包在
 *    try 里，抛错时先看 URL，已经离开 /login 就算成功。
 */

const clearInputs = () => {
  for (const sel of ['input[type="email"]', 'input[type="password"]']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
};

const emailValue = (expected) =>
  document.querySelector('input[type="email"]')?.value === expected;

const clickSubmit = () => {
  const b = document.querySelector('button[type="submit"]');
  if (!b) return false;
  b.click();
  return true;
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 跳过「正在启动」占位页。
 *
 * 部署环境的 server.cjs 是「先 listen、再后台编译启动 Next」，冷启动期间所有请求
 * 都会拿到一个每 3 秒自刷新的占位页（正文含「正在启动」）。此时页面里根本没有输入框，
 * 若直接开始登录，只会得到「无输入框」然后失败——看起来像登录坏了，其实是容器刚被唤醒。
 */
async function waitForRealPage(page, sleep, maxMs = 150_000) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    let splashing = false;
    try {
      splashing = await page.evaluate(() => (document.body?.innerText || "").includes("正在启动"));
    } catch {
      splashing = true; // 页面正在导航，等下一轮
    }
    if (!splashing) return true;
    await sleep(3000);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      /* 忽略，下一轮继续 */
    }
  }
  return false;
}

/**
 * 通过登录页 UI 登录。
 * @returns {Promise<{ ok: boolean, attempts: number, url: string }>}
 */
export async function loginViaUi(page, account, options = {}) {
  const { attempts = 3, waitMs = 700, sleep = defaultSleep } = options;
  const onLoginPage = () => {
    try {
      return page.url().includes("/login");
    } catch {
      return false;
    }
  };

  await waitForRealPage(page, sleep);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!onLoginPage()) return { ok: true, attempts: attempt - 1, url: safeUrl(page) };

    let submitted = false;
    try {
      await sleep(waitMs);
      await page.evaluate(clearInputs);
      await page.type('input[type="email"]', account.email, { delay: 12 });
      await page.type('input[type="password"]', account.pwd, { delay: 12 });
      const filled = await page.evaluate(emailValue, account.email);
      if (!filled) continue; // 被 hydration 清掉了
      submitted = await page.evaluate(clickSubmit);
      if (!submitted) continue;
    } catch {
      // 页面在输入过程中导航了：可能上一次提交刚刚成功
      if (!onLoginPage()) return { ok: true, attempts: attempt, url: safeUrl(page) };
      continue;
    }

    for (let i = 0; i < 80; i++) {
      if (!onLoginPage()) return { ok: true, attempts: attempt, url: safeUrl(page) };
      await sleep(250);
    }
  }

  return { ok: !onLoginPage(), attempts, url: safeUrl(page) };
}

function safeUrl(page) {
  try {
    return page.url();
  } catch {
    return "(页面已关闭)";
  }
}
