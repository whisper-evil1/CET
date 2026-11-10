/**
 * 邮箱格式规则（前后端共用）。
 *
 * 为什么单独抽出来：过去只有注册接口在服务端校验，前端 input[type=email] 一挡就完事，
 * 用户输错时看到的是浏览器那句英文气泡，或者提交后才被 400 打回「参数不合法：email」。
 * 加验证码之后更糟 —— 验证码已经发出去了才说邮箱不对，码白等。
 *
 * 现在把判断收成纯函数：前端失焦即时提示、点「发送验证码」前拦一道、
 * 服务端 zod 再拦一道，三处用的是同一套规则和同一句文案，不会出现
 * 「前端说没问题、后端说不行」的分裂。
 *
 * 两档严格程度，别混用：
 *   parseEmail()  只判**结构**（有没有 @、域名像不像域名）。
 *                 「密码登录」用它 —— 演示账号 demo@cet.local 这种域名不在白名单里，
 *                 但它确实存在、密码也对，用白名单拦就等于把老账号锁在门外。
 *   checkEmail()  结构 + **域名白名单**。注册、发验证码必须用它：
 *                 发不到信的域名，填了也没意义。
 *
 * 这里不 import 任何 node 模块，客户端组件可以直接用。
 */

/**
 * 允许注册的邮箱域名白名单。挡住乱填的临时邮箱/不存在的域名。
 * 想收紧成只允许 QQ 邮箱，把白名单改成 ["qq.com", "foxmail.com", "vip.qq.com"] 即可。
 */
export const ALLOWED_EMAIL_DOMAINS: readonly string[] = [
  "qq.com",
  "vip.qq.com",
  "foxmail.com",
  "163.com",
  "126.com",
  "vip.163.com",
  "sina.com",
  "sina.cn",
  "sohu.com",
  "139.com",
  "189.cn",
  "aliyun.com",
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
];

const ALLOWED = new Set(ALLOWED_EMAIL_DOMAINS);

/** 白名单的人类可读说法，提示文案里统一用它，避免和列表两处维护走样 */
export const ALLOWED_DOMAIN_HINT = "QQ、163、Gmail、Outlook、iCloud 等";

const LOCAL_PART = /^[a-z0-9._%+-]+$/i;
const DOMAIN_PART = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export type EmailIssue =
  | "empty"
  | "space"
  | "at-count"
  | "local-empty"
  | "local-chars"
  | "local-long"
  | "domain-shape"
  | "domain-chars"
  | "tld"
  | "not-allowed";

export type EmailParsed =
  | { ok: true; email: string; domain: string }
  | { ok: false; issue: EmailIssue; message: string };

function bad(issue: EmailIssue, message: string): EmailParsed {
  return { ok: false, issue, message };
}

/**
 * 只判结构。
 *
 * 成功时返回**规范化后**的邮箱（去空格 + 转小写）与域名，调用方必须用返回值
 * 去发信/落库，不要再用原始输入 —— 否则 `QQ.COM` 和 `qq.com` 会被当成两个账号。
 */
export function parseEmail(raw: string | null | undefined): EmailParsed {
  const value = (raw ?? "").trim();
  if (!value) return bad("empty", "先填一下邮箱");
  if (/\s/.test(value)) return bad("space", "邮箱里不能有空格，中间的空格去掉再试");

  const atCount = value.split("@").length - 1;
  if (atCount === 0) {
    return bad("at-count", `邮箱少了 @，应该是 ${value}@qq.com 这样的形式`);
  }
  if (atCount > 1) return bad("at-count", "邮箱里只能有一个 @，检查一下是不是多打了");

  const [localRaw, domainRaw] = value.split("@");
  const local = localRaw ?? "";
  const domain = (domainRaw ?? "").toLowerCase();

  if (!local) return bad("local-empty", "@ 前面不能是空的，要填上你的邮箱账号");
  if (!LOCAL_PART.test(local)) {
    return bad("local-chars", "@ 前面只能用字母、数字和 . _ - + 这几种符号");
  }
  if (local.length > 64) return bad("local-long", "@ 前面的账号太长了，一般不会超过 64 个字符");

  if (!domain) return bad("domain-shape", "@ 后面要写邮箱的域名，比如 qq.com");
  if (domain.includes("..")) return bad("domain-shape", "域名里有两个连续的点，检查一下");
  if (!DOMAIN_PART.test(domain)) {
    return bad("domain-chars", `域名「${domain}」写得不对，只能有字母、数字和短横线，并且要带一个点`);
  }

  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length < 2) return bad("tld", `域名结尾「.${tld}」不完整，正常应该是 .com 或 .cn 这样`);

  return { ok: true, email: `${local.toLowerCase()}@${domain}`, domain };
}

/** 结构 + 白名单。注册、发验证码用这一档 */
export function checkEmail(raw: string | null | undefined): EmailParsed {
  const parsed = parseEmail(raw);
  if (!parsed.ok) return parsed;
  if (!ALLOWED.has(parsed.domain)) {
    return bad("not-allowed", `只支持主流邮箱（${ALLOWED_DOMAIN_HINT}），${parsed.domain} 暂时收不到验证码`);
  }
  return parsed;
}

/** 只要布尔值的场景（例如按钮禁用判断）用这个，不关心具体原因 */
export function isEmailOk(raw: string | null | undefined): boolean {
  return checkEmail(raw).ok;
}
