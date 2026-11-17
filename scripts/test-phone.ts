/**
 * 手机号归一的回归测试。
 *
 * 这一组用例全部来自真实故障：云端把用户输入的 `13800138000`
 * 转成 `+86 13800138000` 再回传，服务端拿它和 11 位做字符串比较，
 * 结果「明明填的是同一个号，却提示不一致」。
 *
 * 跑法：npx tsx scripts/test-phone.ts
 */
import { PHONE_RE, isPhone, maskPhone, normalizePhone, samePhone, phoneEmail } from "../src/lib/phone";

let pass = 0;
let fail = 0;

function eq(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
}

/* ---- 各种写法都要收敛成 11 位 ---- */
eq("标准 11 位", normalizePhone("13800138000"), "13800138000");
eq("云端的 +86 空格写法", normalizePhone("+86 13800138000"), "13800138000");
eq("+86 无空格", normalizePhone("+8613800138000"), "13800138000");
eq("0086 前缀", normalizePhone("008613800138000"), "13800138000");
eq("86 前缀 13 位", normalizePhone("8613800138000"), "13800138000");
eq("带短横", normalizePhone("138-0013-8000"), "13800138000");
eq("带括号空格", normalizePhone("(+86) 138 0013 8000"), "13800138000");
eq("首尾空白", normalizePhone("  13800138000  "), "13800138000");

/* ---- 认不出来的不瞎猜 ---- */
eq("空值", normalizePhone(""), "");
eq("null", normalizePhone(null), "");
eq("非手机号归零", normalizePhone("hello"), "");
eq("境外号码不硬猜", normalizePhone("+1 202 555 0143"), "");

/* ---- 比较 ---- */
eq("同一号码两种写法算相等", samePhone("+86 13800138000", "13800138000"), true);
eq("不同号码算不等", samePhone("+86 13800138000", "13900139000"), false);
eq("空值不相等", samePhone("", "13800138000"), false);

/* ---- 派生 ---- */
eq("合成邮箱用 11 位", phoneEmail("+86 13800138000"), "13800138000@phone.local");
eq("掩码", maskPhone("+86 13800138000"), "138 **** 8000");
eq("校验：11 位通过", isPhone("13800138000"), true);
eq("校验：带国家码不通过（入库前必须先归一）", isPhone("+86 13800138000"), false);
eq("PHONE_RE 可用", PHONE_RE.test("19912345678"), true);

console.log(`\n==== 手机号归一 ${pass}/${pass + fail} ====`);
process.exit(fail === 0 ? 0 : 1);
