/**
 * 手机号的「规范化」只有一个真相来源。
 *
 * 为什么必须单独拎出来：同一个号码在不同层有不同写法 ——
 *
 *   - 用户在输入框里打的是     `13800138000`
 *   - 云 SDK 发短信前会转成    `+86 13800138000`（注意中间那个空格）
 *   - TCB 用户对象的 phone_number 就是这个带国家码的样子
 *   - 有的客户端还会传         `0086 138…` / `86138…`
 *
 * 之前绑定手机号报「验证码与绑定的不一致」，就是拿 `"+86 13800138000"` 和
 * `"13800138000"` 做字符串比较 —— 人眼看是一致的，代码看是不等的。
 * 所以凡是「来源不是用户输入」的手机号，进来先过一遍 normalizePhone。
 *
 * 库里统一存 11 位本地号码（不带国家码、不带空格），因为：
 *   - 唯一的用户是中国大陆号码（PHONE_RE 已经限死 1[3-9] 开头 11 位）；
 *   - 存一种写法，唯一索引才有意义，否则同一个号能注册两次。
 */

export const PHONE_RE = /^1[3-9]\d{9}$/;

export const isPhone = (value: string) => PHONE_RE.test((value ?? "").trim());

/**
 * 把各种写法的中国大陆手机号收敛成 11 位。
 *
 * `+86 13800138000` / `008613800138000` / `8613800138000` / `138-0013-8000`
 * 全部 → `13800138000`。
 *
 * 收敛后仍不是 11 位本地号码的，返回空串 —— 表示「这不是一个手机号」，
 * 由调用方用 isPhone() 判断。不去猜别的国家的号码，也不把垃圾串当号码存库。
 */
export function normalizePhone(input: string | null | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  // 只留数字：空格、+、短横、括号全去掉
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("0086")) digits = digits.slice(4);
  else if (digits.length === 13 && digits.startsWith("86")) digits = digits.slice(2);
  else if (digits.length === 15 && digits.startsWith("86")) digits = digits.slice(2);

  // 保险：多留了几位（比如带分机）时，取尾部 11 位
  if (digits.length > 11 && PHONE_RE.test(digits.slice(-11))) return digits.slice(-11);

  return PHONE_RE.test(digits) ? digits : "";
}

/** 两个写法不同的手机号是不是同一个号 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  return Boolean(left) && left === right;
}

/** 合成邮箱：只有手机号、还没有真邮箱时用来占位（保持 email 唯一非空） */
export const phoneEmail = (phone: string) => `${normalizePhone(phone)}@phone.local`;

/** 展示用掩码：139 **** 1234 */
export function maskPhone(phone: string | null | undefined): string | null {
  const value = normalizePhone(phone);
  if (!isPhone(value)) return null;
  return `${value.slice(0, 3)} **** ${value.slice(-4)}`;
}
