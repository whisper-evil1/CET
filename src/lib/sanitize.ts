/**
 * 留言/昵称的纯文本净化。
 *
 * 策略：服务端"白名单式"清洗 —— 留言只允许纯文本，任何 HTML 标签、
 * 控制字符、零宽字符一律去掉；写入库的就是干净文本，前端用
 * textContent/JSX 文本节点渲染（React 默认转义），双保险防 XSS。
 *
 * 不用 DOMPurify 的原因：我们根本不需要富文本，直接拒绝 HTML 更安全，
 * 也不用为服务端引入 jsdom。
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

export function sanitizePlainText(input: string, maxLength = 500): string {
  return input
    .replace(CONTROL_CHARS, "")
    .replace(ZERO_WIDTH, "")
    // 危险标签连同内容一起丢掉（<script>alert(1)</script> 整个消失，而不是留下 alert(1)）
    .replace(/<(script|style|iframe|object|embed|template)[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    // 其余标签只去壳，保留文字
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/<[^>]*$/, "")
    // 实体化的尖括号还原成普通字符，避免被浏览器二次解释
    .replace(/&lt;|&#60;|&#x3c;/gi, " ")
    .replace(/&gt;|&#62;|&#x3e;/gi, " ")
    .replace(/javascript:/gi, "")
    .replace(/[\u0000<]/g, "")
    .replace(/\r\n/g, "\n")
    // 连续空行折叠成一个
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

/** 昵称：只留字母数字中文与常见符号，长度 1-20 */
export function sanitizeName(input: string): string {
  return input
    .replace(/[^\p{L}\p{N}_\-. ·]/gu, "")
    .trim()
    .slice(0, 20);
}

/** 判断是否含有肉眼不可见的可疑内容，用于日志排查 */
export function looksSuspicious(input: string): boolean {
  return /<script|javascript:|on\w+\s*=|data:text\/html/i.test(input);
}
