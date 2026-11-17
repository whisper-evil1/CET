/**
 * 新密码规则（前端即时提示与服务端校验共用同一份）。
 *
 * 为什么单独抽出来：注册那条路只要 6 位，改密码那条路要 8 位 + 字母 + 数字，
 * 两套规则各写在各的 route 里。用户在注册页设了个 6 位纯数字，进「我的」想改密码
 * 又被要求 8 位，会感觉被系统临时加码。文案还会分裂成两种说法。
 *
 * 这里只定「重置 / 修改密码」这一档：重置出来的密码就是以后长期用的那份，
 * 标准必须和「我的 → 修改密码」一致，不能因为入口不同而放宽。
 * 注册那一档保持 6 位不变 —— 存量账号和脚本都按 6 位来，收紧会打断它们。
 *
 * 不 import 任何 node 模块，客户端组件可以直接用。
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** 一句话说清要求，输入框下方与错误提示都用它，避免两处措辞不一致 */
export const PASSWORD_HINT = `至少 ${PASSWORD_MIN} 位，要同时有字母和数字`;

/**
 * 返回第一条不满足的原因；全部满足返回 null。
 *
 * 顺序故意从「最容易犯」到「最容易忽略」：先看长度，再看组成。
 * 这样用户输入 6 位纯数字时看到的是「至少 8 位」，而不是先被告知「要包含字母」——
 * 后者会让他补一个字母，然后又被长度挡一次，等于同一件事说两遍。
 */
export function passwordIssue(raw: string | null | undefined): string | null {
  const value = raw ?? "";
  if (!value) return "先设置一个新密码";
  if (value.length < PASSWORD_MIN) return `新密码至少 ${PASSWORD_MIN} 位`;
  if (value.length > PASSWORD_MAX) return `新密码最多 ${PASSWORD_MAX} 位`;
  if (!/[a-zA-Z]/.test(value)) return "新密码要包含字母";
  if (!/\d/.test(value)) return "新密码要包含数字";
  return null;
}

/** 只看通过与否的场景（按钮禁用判断）用这个 */
export function isPasswordOk(raw: string | null | undefined): boolean {
  return passwordIssue(raw) === null;
}
