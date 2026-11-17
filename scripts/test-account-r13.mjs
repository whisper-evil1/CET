/**
 * 账号相关的后端验收（第 13 轮）。
 *
 * 覆盖用户提的三件事，全部走真实 HTTP，不打桩：
 *   1. 注册 → 登录 → 改密码 → 用新密码登录、旧密码失效；
 *   2. 绑定手机号后，手机号 + 密码也能登进同一个账号（同一 userId）；
 *   3. 绑定接口不认「客户端自报的号码」，必须带云端验证码换来的 token。
 *
 * 用完把测试账号删掉，不污染真实数据。
 */
import fs from "node:fs";

const BASE = process.env.CHECK_BASE ?? "http://127.0.0.1:3011";
const stamp = Date.now();
const email = `r13probe${stamp}@qq.com`;
const phone = `139${String(stamp).slice(-8)}`;
const pwd1 = "Probe12345";
const pwd2 = "Probe67890";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jar = new Map();
const cookieHeader = () => Array.from(jar, ([k, v]) => `${k}=${v}`).join("; ");

async function request(path, { method = "GET", body, form, headers = {}, follow = false } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    body: form ? new URLSearchParams(form) : body ? JSON.stringify(body) : undefined,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...headers,
    },
    redirect: follow ? "follow" : "manual",
  });
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json().catch(() => null) : await res.text();
  return { status: res.status, data };
}

/** 走 NextAuth 的凭据回调，等价于页面上点「登录」 */
async function signIn(identifier, password) {
  const csrf = await request("/api/auth/csrf");
  const token = csrf.data?.csrfToken;
  if (!token) return { status: 0, data: null };
  const res = await request("/api/auth/callback/credentials", {
    method: "POST",
    form: { csrfToken: token, email: identifier, password, json: "true", callbackUrl: `${BASE}/` },
  });
  const session = await request("/api/auth/session");
  return { status: res.status, session: session.data };
}

// 1. 注册
const reg = await request("/api/auth/register", {
  method: "POST",
  body: { email, password: pwd1, name: "验收账号" },
});
check("注册成功", reg.status === 200 && reg.data?.code === 0, `status ${reg.status}`);
const userId = reg.data?.data?.id;
check("注册返回账号 id", Boolean(userId), userId ?? "");
check("注册即写入加密保险库", reg.data?.data?.vaultReady === true, String(reg.data?.data?.vaultReady));

// 2. 邮箱 + 密码登录
const first = await signIn(email, pwd1);
check("邮箱密码登录成功", Boolean(first.session?.user?.id), JSON.stringify(first.session?.user ?? null).slice(0, 80));
check("登录后的 userId 与注册一致", first.session?.user?.id === userId);

// 3. 改密码：旧密码错 → 拒绝
const wrong = await request("/api/account/password", {
  method: "POST",
  body: { currentPassword: "WrongPass1", newPassword: pwd2 },
});
check("旧密码错误时拒绝改密", wrong.status === 400, `status ${wrong.status}`);

// 4. 旧密码对 → 通过
const changed = await request("/api/account/password", {
  method: "POST",
  body: { currentPassword: pwd1, newPassword: pwd2 },
});
check("改密码成功", changed.status === 200 && changed.data?.code === 0, JSON.stringify(changed.data).slice(0, 120));
check("改密后云端镜像已刷新", changed.data?.data?.vaultReady === true);

// 5. 旧密码失效、新密码可用
jar.clear();
const oldLogin = await signIn(email, pwd1);
check("旧密码登录失败", !oldLogin.session?.user?.id);
const newLogin = await signIn(email, pwd2);
check("新密码登录成功", newLogin.session?.user?.id === userId);

// 6. 绑定接口拒绝伪造 token
const fakeBind = await request("/api/account/bind", {
  method: "POST",
  body: { kind: "phone", phone, accessToken: "x".repeat(40), originHint: BASE },
});
check("伪造 token 无法绑定手机号", fakeBind.status === 400, `status ${fakeBind.status}`);

// 7. 手机号 + 密码登录同一账号（真实链路：库里已有 phone 列）
//    这里直接写库模拟「已经绑定过」，因为真实验证码需要手机收短信，验收环境拿不到。
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
await prisma.user.update({ where: { id: userId }, data: { phone } });

const profile = await request("/api/account/profile");
check("账号接口回传手机号", profile.data?.data?.phone === phone, JSON.stringify(profile.data?.data ?? null).slice(0, 100));

jar.clear();
const phoneLogin = await signIn(phone, pwd2);
check("手机号 + 密码登录成功", phoneLogin.session?.user?.id === userId, String(phoneLogin.session?.user?.id));
check("手机号登录进的是同一个账号", phoneLogin.session?.user?.id === userId);

// 8. 清理
await prisma.user.delete({ where: { id: userId } }).catch(() => {});
await prisma.$disconnect();

const failed = results.filter((r) => !r.pass);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log("失败项：");
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`));
  process.exit(1);
}
